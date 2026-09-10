// The consumer-facing layer: what a person bought, and whether it is safe now.
//
// Pure functions, no DB access, same discipline as invariants.ts and billing.ts.
// This module DECIDES NOTHING about compliance. It reads facts the ledger and
// invariants already established and puts them in words a person without any
// technical or pharmaceutical background can act on.
//
// The consumer purchase bill is a DIFFERENT THING from the compliance `Bill`:
//
//   Bill          permanent regulatory record — is this stock OK or EXPIRED, and why
//   ConsumerBill  what a person actually bought, so they can check it later
//
// They are never merged and never substituted for one another.

import { checkTemporalValidity } from "./invariants";
import { RegistryStatus } from "./types";

export const ConsumerStatus = {
  VALID: "VALID",
  EXPIRED: "EXPIRED",
  RECALLED: "RECALLED",
  HELD: "HELD",
  DESTROYED: "DESTROYED",
  UNKNOWN: "UNKNOWN",
} as const;
export type ConsumerStatus = (typeof ConsumerStatus)[keyof typeof ConsumerStatus];

export interface ConsumerVerdict {
  status: ConsumerStatus;
  /** Six words at most. This is the line someone reads in a pharmacy queue. */
  headline: string;
  /** What it means, in plain language. */
  explanation: string;
  /** What to do about it. */
  action: string;
  safe: boolean;
}

/**
 * The consumer verdict for one dispensed line.
 *
 * The order mirrors the POS decision function in §5.6 deliberately: a consumer
 * scanning a pack and a pharmacist scanning the same pack must never be told
 * different things about it. If that order changes there, it changes here.
 *
 * `serverNow` is the server clock (CLAUDE.md rule 5). Nothing a phone sends
 * decides whether a medicine has expired.
 */
export function consumerVerdict(input: {
  batch: { registryStatus: RegistryStatus; expiryDate: Date; destroyedAt?: Date | null } | null;
  serverNow: Date;
}): ConsumerVerdict {
  const { batch, serverNow } = input;

  if (!batch) {
    return {
      status: ConsumerStatus.UNKNOWN,
      headline: "UNKNOWN — DO NOT CONSUME",
      explanation:
        "No trusted record was found for this medicine. That does not automatically mean it is fake, but nothing here can confirm it is genuine.",
      action: "Do not take it. Return it to the pharmacy and ask them to check the batch.",
      safe: false,
    };
  }

  if (batch.registryStatus === RegistryStatus.DESTROYED) {
    return {
      status: ConsumerStatus.DESTROYED,
      headline: "DESTROYED — DO NOT USE",
      explanation:
        "This batch is recorded as destroyed. Medicine bearing this batch number should not exist on any shelf.",
      action: "Do not take it. Report it — this is the case regulators most want to hear about.",
      safe: false,
    };
  }

  if (batch.registryStatus === RegistryStatus.RECALLED) {
    return {
      status: ConsumerStatus.RECALLED,
      headline: "RECALLED — DO NOT USE",
      explanation: "The regulator has recalled this batch.",
      action: "Stop taking it and return it to the pharmacy. If you feel unwell, speak to a doctor.",
      safe: false,
    };
  }

  if (batch.registryStatus === RegistryStatus.HELD) {
    return {
      status: ConsumerStatus.HELD,
      headline: "ON HOLD — DO NOT USE FOR NOW",
      explanation:
        "The regulator has placed this batch on hold while it is investigated. No finding has been made yet.",
      action: "Do not take it until the hold is lifted. Ask your pharmacist or doctor.",
      safe: false,
    };
  }

  // I5, unchanged and unduplicated — the same function the POS terminal uses.
  const temporal = checkTemporalValidity({ expiryDate: batch.expiryDate, serverNow });
  if (!temporal.ok) {
    return {
      status: ConsumerStatus.EXPIRED,
      headline: "EXPIRED — DO NOT USE",
      explanation: `This medicine expired on ${fmtDate(batch.expiryDate)}.`,
      action: "Do not take it. Return it to the pharmacy for safe disposal.",
      safe: false,
    };
  }

  return {
    status: ConsumerStatus.VALID,
    headline: "VALID",
    explanation: `This medicine is within its expiry date, which is ${fmtDate(batch.expiryDate)}.`,
    action: "Safe to use as directed. Check again if you keep it for a long time.",
    safe: true,
  };
}

/** dd/mm/yyyy — the format on an Indian pack, not an ISO string. */
export function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/**
 * The demo date control (Phase 15) resolved against the server clock.
 *
 * Deliberately ONE-DIRECTIONAL: a requested date earlier than the server clock is
 * ignored. The control exists to show a valid batch becoming expired as time
 * passes, and forward-only means it can only ever make a verdict STRICTER. A
 * backward-dating control would let a public URL be crafted to show expired stock
 * as VALID, which is precisely the lie the whole system exists to prevent.
 *
 * It changes nothing in the database. It is a lens on the same stored expiry date.
 */
export function resolveAsOf(requested: string | null | undefined, serverNow: Date): {
  asOf: Date;
  simulated: boolean;
  rejected: boolean;
} {
  if (!requested) return { asOf: serverNow, simulated: false, rejected: false };
  const parsed = new Date(requested);
  if (Number.isNaN(parsed.getTime())) {
    return { asOf: serverNow, simulated: false, rejected: true };
  }
  if (parsed.getTime() <= serverNow.getTime()) {
    return { asOf: serverNow, simulated: false, rejected: true };
  }
  return { asOf: parsed, simulated: true, rejected: false };
}

/** RCCP-YYYYMMDD-NNN. Human-readable, and it sorts by day. */
export function formatBillNo(now: Date, sequence: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}`;
  return `RCCP-${day}-${String(sequence).padStart(3, "0")}`;
}

/**
 * Fields a QR may resolve to. Everything absent from this list is absent on
 * purpose: no patient identity, no regulator notes, no internal risk signals,
 * no other organisation's commercial data. The QR is a bridge to the live
 * record, not a copy of the database.
 */
export const CONSUMER_SAFE_FIELDS = [
  "product",
  "manufacturer",
  "batchNo",
  "qty",
  "expiryDate",
  "purchaseDate",
  "pharmacy",
  "status",
] as const;
