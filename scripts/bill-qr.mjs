#!/usr/bin/env node
// Renders the QR for a consumer purchase bill as a PNG you can print, paste
// into a slide, or scan off a screen.
//
//   node scripts/bill-qr.mjs                       # every bill, localhost
//   node scripts/bill-qr.mjs --base https://x.app  # against a deployment
//   node scripts/bill-qr.mjs --token demo-valid-bill-token-0001
//
// The QR encodes a URL carrying an opaque token, NOT the purchase data. That is
// the whole point: the scan resolves against the live record, so a batch
// recalled after the sale turns this same printed square red without the paper
// changing. A QR with the data baked in would freeze the answer at print time,
// which is the wrong answer to give someone holding the medicine.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const base = (flag("base", process.env.BASE_URL ?? "http://localhost:3000")).replace(/\/$/, "");
const only = flag("token", null);
const outDir = flag("out", "qr");

const prisma = new PrismaClient();

async function main() {
  const bills = await prisma.consumerBill.findMany({
    where: only ? { token: only } : {},
    include: { pharmacy: true, lines: { include: { batch: true } } },
    orderBy: { soldAt: "desc" },
  });

  if (bills.length === 0) {
    console.error(
      only
        ? `No bill with token "${only}". Run: npx prisma db seed`
        : "No consumer bills found. Run: npx prisma db seed",
    );
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });

  for (const b of bills) {
    const url = `${base}/verify/bill/${encodeURIComponent(b.token)}`;
    const file = join(outDir, `${b.billNo}.png`);

    await QRCode.toFile(file, url, {
      width: 900,
      margin: 2,
      // High correction: these get printed, photographed off screens and
      // scanned at an angle. M would be smaller and would fail more often.
      errorCorrectionLevel: "H",
      color: { dark: "#0E4E42", light: "#FFFFFF" },
    });

    const statuses = [
      ...new Set(
        b.lines.map((l) => {
          const s = l.batch.registryStatus;
          if (s === "RECALLED" || s === "DESTROYED" || s === "HELD") return s;
          return l.batch.expiryDate.getTime() < Date.now() ? "EXPIRED" : "VALID";
        }),
      ),
    ];

    console.log(`${b.billNo}`);
    console.log(`  pharmacy  ${b.pharmacy.name}`);
    console.log(`  lines     ${b.lines.map((l) => `${l.batchNo} x${l.qty}`).join(", ")}`);
    console.log(`  will show ${statuses.join(" + ")}`);
    console.log(`  url       ${url}`);
    console.log(`  written   ${file}\n`);
  }

  if (base.includes("localhost")) {
    console.log(
      "NOTE: these point at localhost, so a phone on another device cannot open them.\n" +
        "      Re-run with --base https://<your-app>.vercel.app for a scannable code.",
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
