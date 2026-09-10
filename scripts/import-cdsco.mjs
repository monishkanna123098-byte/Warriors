#!/usr/bin/env node
// CDSCO reference-data importer.
//
//   node scripts/import-cdsco.mjs scripts/seed-data/nsq-alerts.csv
//   node scripts/import-cdsco.mjs scripts/seed-data/licensed-entities.csv
//   node scripts/import-cdsco.mjs <file> --table=nsq|entities
//
// CDSCO publishes no API, so ingestion is a manual or scheduled CSV import —
// the same pattern the repo already uses for seed data. There is deliberately no
// scraper here.
//
// Re-running an updated export is safe: rows are upserted, never appended.

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Minimal RFC4180-ish parser: handles quoted fields and embedded commas. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (c === "\r") continue;
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  const nonEmpty = rows.filter((r) => r.some((v) => v.trim() !== ""));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) =>
    Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])),
  );
}

const NSQ_REQUIRED = ["medicineName", "batchNo", "dateFlagged", "reason"];
const ENTITY_REQUIRED = ["name", "licenseNo", "type", "state", "status"];

function detectTable(rows, explicit) {
  if (explicit) {
    if (explicit === "nsq" || explicit === "entities") return explicit;
    throw new Error(`--table must be "nsq" or "entities", got "${explicit}"`);
  }
  if (rows.length === 0) throw new Error("CSV has no data rows; pass --table to disambiguate");
  const keys = Object.keys(rows[0]);
  if (NSQ_REQUIRED.every((k) => keys.includes(k))) return "nsq";
  if (ENTITY_REQUIRED.every((k) => keys.includes(k))) return "entities";
  throw new Error(
    `Could not detect table from header [${keys.join(", ")}].\n` +
      `Expected either [${NSQ_REQUIRED.join(", ")}] or [${ENTITY_REQUIRED.join(", ")}], or pass --table.`,
  );
}

async function importNsq(rows) {
  let created = 0;
  let updated = 0;
  for (const [i, r] of rows.entries()) {
    for (const k of NSQ_REQUIRED) {
      if (!r[k]) throw new Error(`Row ${i + 2}: missing required column "${k}"`);
    }
    const dateFlagged = new Date(r.dateFlagged);
    if (Number.isNaN(dateFlagged.getTime())) {
      throw new Error(`Row ${i + 2}: dateFlagged "${r.dateFlagged}" is not a valid date`);
    }

    // Keyed on (medicineName, batchNo), not batchNo alone: batch numbers collide
    // across manufacturers, so a bare batch number would let one maker's recall
    // overwrite another's.
    const existing = await prisma.nsqAlert.findUnique({
      where: { medicineName_batchNo: { medicineName: r.medicineName, batchNo: r.batchNo } },
    });
    await prisma.nsqAlert.upsert({
      where: { medicineName_batchNo: { medicineName: r.medicineName, batchNo: r.batchNo } },
      create: {
        medicineName: r.medicineName,
        batchNo: r.batchNo,
        dateFlagged,
        reason: r.reason,
        source: r.source || "CDSCO",
      },
      update: { dateFlagged, reason: r.reason, source: r.source || "CDSCO", importedAt: new Date() },
    });
    existing ? updated++ : created++;
  }
  return { created, updated };
}

async function importEntities(rows) {
  let created = 0;
  let updated = 0;
  for (const [i, r] of rows.entries()) {
    for (const k of ENTITY_REQUIRED) {
      if (!r[k]) throw new Error(`Row ${i + 2}: missing required column "${k}"`);
    }
    const type = r.type.trim().toUpperCase();
    if (type !== "RETAILER" && type !== "WHOLESALER") {
      throw new Error(`Row ${i + 2}: type must be RETAILER or WHOLESALER, got "${r.type}"`);
    }

    const existing = await prisma.licensedEntity.findUnique({ where: { licenseNo: r.licenseNo } });
    await prisma.licensedEntity.upsert({
      where: { licenseNo: r.licenseNo },
      create: {
        name: r.name,
        licenseNo: r.licenseNo,
        type,
        state: r.state,
        status: r.status.trim().toUpperCase(),
      },
      update: {
        name: r.name,
        type,
        state: r.state,
        status: r.status.trim().toUpperCase(),
        importedAt: new Date(),
      },
    });
    existing ? updated++ : created++;
  }
  return { created, updated };
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const explicit = args.find((a) => a.startsWith("--table="))?.split("=")[1];

  if (!file) {
    console.error("Usage: node scripts/import-cdsco.mjs <file.csv> [--table=nsq|entities]");
    process.exit(1);
  }

  const rows = parseCsv(readFileSync(file, "utf8"));
  const table = detectTable(rows, explicit);

  const result = table === "nsq" ? await importNsq(rows) : await importEntities(rows);
  const total =
    table === "nsq" ? await prisma.nsqAlert.count() : await prisma.licensedEntity.count();

  console.log(
    `${table === "nsq" ? "NsqAlert" : "LicensedEntity"}: ` +
      `${result.created} created, ${result.updated} updated from ${rows.length} CSV rows. ` +
      `Table now holds ${total} rows.`,
  );
}

main()
  .catch((e) => {
    console.error(`Import failed: ${e.message}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
