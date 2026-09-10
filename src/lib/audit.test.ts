import { describe, it, expect } from "vitest";
import { canonicalJson, computeHash } from "./audit";

const TS = new Date("2026-09-10T12:00:00.000Z");

describe("computeHash", () => {
  it("is deterministic for identical input", () => {
    const a = computeHash({ payload: { x: 1 }, actorUserId: "u1", serverTs: TS, prevHash: null });
    const b = computeHash({ payload: { x: 1 }, actorUserId: "u1", serverTs: TS, prevHash: null });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the payload changes — tampering is detectable", () => {
    const a = computeHash({ payload: { x: 1 }, actorUserId: "u1", serverTs: TS, prevHash: null });
    const b = computeHash({ payload: { x: 2 }, actorUserId: "u1", serverTs: TS, prevHash: null });
    expect(a).not.toBe(b);
  });

  it("changes when the actor changes", () => {
    const a = computeHash({ payload: { x: 1 }, actorUserId: "u1", serverTs: TS, prevHash: null });
    const b = computeHash({ payload: { x: 1 }, actorUserId: "u2", serverTs: TS, prevHash: null });
    expect(a).not.toBe(b);
  });

  it("changes when the predecessor changes — a rewrite breaks every later link", () => {
    const a = computeHash({ payload: { x: 1 }, actorUserId: "u1", serverTs: TS, prevHash: "aa" });
    const b = computeHash({ payload: { x: 1 }, actorUserId: "u1", serverTs: TS, prevHash: "bb" });
    expect(a).not.toBe(b);
  });
});

describe("canonicalJson", () => {
  it("is stable under key reordering — the jsonb round-trip problem", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it("sorts nested keys too", () => {
    expect(canonicalJson({ x: { p: 1, q: 2 } })).toBe(canonicalJson({ x: { q: 2, p: 1 } }));
  });

  it("preserves array order, which is meaningful", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("still distinguishes different values", () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });

  it("yields the same hash for a payload that survived a jsonb round trip", () => {
    const written = { batchId: "b1", qty: 7, nested: { z: 1, a: 2 } };
    const readBack = { nested: { a: 2, z: 1 }, qty: 7, batchId: "b1" };
    const h = (p: unknown) => computeHash({ payload: p, actorUserId: "u", serverTs: TS, prevHash: null });
    expect(h(written)).toBe(h(readBack));
  });
});
