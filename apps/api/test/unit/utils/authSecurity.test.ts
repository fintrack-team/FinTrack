import { vi } from "vitest";
import {
  generateSecureToken,
  generateFamilyId,
  hashToken,
  extractClientIp,
  logSecurityEvent,
} from "../../../src/utils/authSecurity.js";
import { logger } from "../../../src/lib/logger.js";

describe("generateSecureToken", () => {
  it("default size (48 bytes) produces 64-char base64url string", () => {
    const token = generateSecureToken();
    // 48 raw bytes → ceil(48/3)*4 = 64 base64 chars (base64url has no padding)
    expect(token.length).toBe(64);
  });

  it("only base64url-safe chars (no +, /, =)", () => {
    const token = generateSecureToken();
    expect(token).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("size param scales output length", () => {
    expect(generateSecureToken(16).length).toBeLessThan(
      generateSecureToken(48).length,
    );
  });

  it("two calls return different tokens", () => {
    expect(generateSecureToken()).not.toBe(generateSecureToken());
  });
});

describe("generateFamilyId", () => {
  it("returns 48-char lowercase hex string", () => {
    expect(generateFamilyId()).toMatch(/^[0-9a-f]{48}$/);
  });

  it("two calls return different IDs", () => {
    expect(generateFamilyId()).not.toBe(generateFamilyId());
  });
});

describe("hashToken", () => {
  it("returns 64-char hex (SHA-256 output)", () => {
    expect(hashToken("anything")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic – same input, same output", () => {
    expect(hashToken("my-token")).toBe(hashToken("my-token"));
  });

  it("different inputs → different hashes", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });

  it("empty-string hash matches known SHA-256 value", () => {
    const EMPTY_SHA256 =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(hashToken("")).toBe(EMPTY_SHA256);
  });
});

describe("extractClientIp", () => {
  it("returns null for undefined", () => {
    expect(extractClientIp(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractClientIp("")).toBeNull();
  });

  it("returns single IP as-is", () => {
    expect(extractClientIp("192.168.1.1")).toBe("192.168.1.1");
  });

  it("extracts first IP from comma-separated X-Forwarded-For header", () => {
    expect(extractClientIp("10.0.0.1, 172.16.0.1, 8.8.8.8")).toBe("10.0.0.1");
  });

  it("trims surrounding whitespace from extracted IP", () => {
    expect(extractClientIp("  192.168.0.1  , 10.0.0.1")).toBe("192.168.0.1");
  });
});

describe("logSecurityEvent", () => {
  it("calls logger.info with event name and details", () => {
    const spy = vi
      .spyOn(logger, "info")
      .mockImplementation(vi.fn() as unknown as typeof logger.info);

    logSecurityEvent("user.login", { userId: "abc123" });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "user.login", userId: "abc123" }),
      "security",
    );

    spy.mockRestore();
  });

  it("works with no details argument (no crash)", () => {
    const spy = vi
      .spyOn(logger, "info")
      .mockImplementation(vi.fn() as unknown as typeof logger.info);
    expect(() => logSecurityEvent("test.event")).not.toThrow();
    spy.mockRestore();
  });
});
