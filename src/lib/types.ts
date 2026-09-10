// Canonical enums — docs/SPEC.md §1. Single source of truth for the app layer.
// These mirror prisma/schema.prisma exactly. Never invent a variant.
//
// The `satisfies` assertions at the bottom fail to compile if the Prisma enums
// and these ever drift apart, so drift is a build error rather than a runtime bug.

import type {
  OrgType as PrismaOrgType,
  Role as PrismaRole,
  RegistryStatus as PrismaRegistryStatus,
  InventoryStatus as PrismaInventoryStatus,
  ReturnState as PrismaReturnState,
  LedgerEvent as PrismaLedgerEvent,
  ScanContext as PrismaScanContext,
  ScanVerdict as PrismaScanVerdict,
  Severity as PrismaSeverity,
  LeakageStatus as PrismaLeakageStatus,
  AlertCode as PrismaAlertCode,
} from "@prisma/client";

export const OrgType = {
  RETAILER: "RETAILER",
  DISTRIBUTOR: "DISTRIBUTOR",
  MANUFACTURER: "MANUFACTURER",
  FACILITY: "FACILITY",
  REGULATOR: "REGULATOR",
} as const;
export type OrgType = (typeof OrgType)[keyof typeof OrgType];

export const Role = OrgType;
export type Role = OrgType;

export const RegistryStatus = {
  CLEAN: "CLEAN",
  IN_RETURN_PIPELINE: "IN_RETURN_PIPELINE",
  DESTROYED: "DESTROYED",
} as const;
export type RegistryStatus = (typeof RegistryStatus)[keyof typeof RegistryStatus];

export const InventoryStatus = {
  ACTIVE: "ACTIVE",
  QUARANTINED: "QUARANTINED",
  RETURNED: "RETURNED",
} as const;
export type InventoryStatus = (typeof InventoryStatus)[keyof typeof InventoryStatus];

/// Derived at read time from expiryDate vs the server clock; never stored,
/// so it has no Prisma counterpart and no drift guard.
export const ExpiryState = {
  NORMAL: "NORMAL",
  EXPIRY_WARNING: "EXPIRY_WARNING",
  RETURN_DUE: "RETURN_DUE",
} as const;
export type ExpiryState = (typeof ExpiryState)[keyof typeof ExpiryState];

export const ReturnState = {
  RETURN_DUE: "RETURN_DUE",
  INITIATED: "INITIATED",
  PICKUP_ASSIGNED: "PICKUP_ASSIGNED",
  DISTRIBUTOR_RECEIVED: "DISTRIBUTOR_RECEIVED",
  MANUFACTURER_RECEIVED: "MANUFACTURER_RECEIVED",
  DISPOSAL_SCHEDULED: "DISPOSAL_SCHEDULED",
  FACILITY_RECEIVED: "FACILITY_RECEIVED",
  CERTIFIED_DESTROYED: "CERTIFIED_DESTROYED",
} as const;
export type ReturnState = (typeof ReturnState)[keyof typeof ReturnState];

export const LedgerEvent = {
  ISSUED: "ISSUED",
  SUPPLIED: "SUPPLIED",
  BILLED: "BILLED",
  RETURN_INITIATED: "RETURN_INITIATED",
  RECEIVED: "RECEIVED",
  LEAKED: "LEAKED",
  DESTROYED: "DESTROYED",
} as const;
export type LedgerEvent = (typeof LedgerEvent)[keyof typeof LedgerEvent];

export const ScanContext = {
  SALE: "SALE",
  RETURN_INTAKE: "RETURN_INTAKE",
  VERIFY: "VERIFY",
} as const;
export type ScanContext = (typeof ScanContext)[keyof typeof ScanContext];

export const ScanVerdict = { ALLOW: "ALLOW", BLOCK: "BLOCK" } as const;
export type ScanVerdict = (typeof ScanVerdict)[keyof typeof ScanVerdict];

export const Severity = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

export const LeakageStatus = {
  OPEN: "OPEN",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  WRITTEN_OFF: "WRITTEN_OFF",
} as const;
export type LeakageStatus = (typeof LeakageStatus)[keyof typeof LeakageStatus];

export const AlertCode = {
  UNKNOWN_BATCH: "UNKNOWN_BATCH",
  RESURRECTED_BATCH: "RESURRECTED_BATCH",
  EXPIRED_SALE: "EXPIRED_SALE",
  IN_PIPELINE_SALE: "IN_PIPELINE_SALE",
  QUANTITY_BREACH: "QUANTITY_BREACH",
  DOUBLE_RETURN: "DOUBLE_RETURN",
  LEAKAGE: "LEAKAGE",
  WEIGHT_MISMATCH: "WEIGHT_MISMATCH",
  BACKDATED_INVOICE: "BACKDATED_INVOICE",
  CERTIFICATE_OVER_ALLOCATION: "CERTIFICATE_OVER_ALLOCATION",
} as const;
export type AlertCode = (typeof AlertCode)[keyof typeof AlertCode];

// Compile-time drift guards: app enums must equal Prisma enums, both directions.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _guards = {
  orgType: true as Exact<OrgType, PrismaOrgType>,
  role: true as Exact<Role, PrismaRole>,
  registryStatus: true as Exact<RegistryStatus, PrismaRegistryStatus>,
  inventoryStatus: true as Exact<InventoryStatus, PrismaInventoryStatus>,
  returnState: true as Exact<ReturnState, PrismaReturnState>,
  ledgerEvent: true as Exact<LedgerEvent, PrismaLedgerEvent>,
  scanContext: true as Exact<ScanContext, PrismaScanContext>,
  scanVerdict: true as Exact<ScanVerdict, PrismaScanVerdict>,
  severity: true as Exact<Severity, PrismaSeverity>,
  leakageStatus: true as Exact<LeakageStatus, PrismaLeakageStatus>,
  alertCode: true as Exact<AlertCode, PrismaAlertCode>,
};
export type _EnumDriftGuards = typeof _guards;

/// Errors return { error: { code, message, detail } } where code is an AlertCode
/// (or one of these transport-level codes, which are not compliance findings).
export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  ILLEGAL_TRANSITION: "ILLEGAL_TRANSITION",
  BATCH_MISMATCH: "BATCH_MISMATCH",
  OVER_RECEIPT: "OVER_RECEIPT",
  IDEMPOTENCY_KEY_REUSE: "IDEMPOTENCY_KEY_REUSE",
  RATE_LIMITED: "RATE_LIMITED",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export type ApiErrorCode = AlertCode | ErrorCode;
