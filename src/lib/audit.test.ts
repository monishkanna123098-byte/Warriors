import { describe, it, expect } from "vitest";
import { computeHash } from "./audit";

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
