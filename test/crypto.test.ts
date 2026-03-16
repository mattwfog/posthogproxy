import { describe, it, expect } from "vitest";
import { verifyPkceS256, generateId, generateSecret } from "../src/crypto";

describe("verifyPkceS256", () => {
  it("returns true for valid code_verifier matching code_challenge", async () => {
    // Known test vector: verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    // SHA-256 -> base64url = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(await verifyPkceS256(verifier, challenge)).toBe(true);
  });

  it("returns false for mismatched verifier", async () => {
    const verifier = "wrong-verifier-value";
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(await verifyPkceS256(verifier, challenge)).toBe(false);
  });
});

describe("generateId", () => {
  it("returns a hex string of expected length", () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns unique values", () => {
    const a = generateId();
    const b = generateId();
    expect(a).not.toBe(b);
  });
});

describe("generateSecret", () => {
  it("returns a hex string of expected length", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });
});
