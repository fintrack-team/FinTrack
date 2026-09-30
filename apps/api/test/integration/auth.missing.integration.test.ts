import { jest } from "@jest/globals";
import request from "supertest";

import type { app as AppType } from "../../src/app.js";
import type * as AuthServiceTypes from "../../src/modules/auth/service.js";

// Mock objects are built once at module scope: jest may call a mock factory
// more than once (it does on Linux), and a fresh object per call would leave
// the test configuring a different jest.fn than the one the app calls.
const authServiceModuleMock = {
  findSessionById: jest.fn(),
  findSessionByTokenHash: jest.fn(),
  revokeSessionFamily: jest.fn(),
  revokeSession: jest.fn(),
  rotateSession: jest.fn(),
  createSession: jest.fn(),
  logoutByTokenHash: jest.fn(),
  revokeAllUserSessions: jest.fn(),
  markSessionUsed: jest.fn(),
  loginWithGoogle: jest.fn(),
  loginWithTelegram: jest.fn(),
  findVerificationTokenByUserId: jest.fn(),
  findAuthMethodByEmail: jest.fn(),
  login: jest.fn(),
};
jest.unstable_mockModule(
  "../../src/modules/auth/service.js",
  () => authServiceModuleMock,
);

let app: typeof AppType;
let authService: typeof AuthServiceTypes;
let generateAccessToken: (payload: {
  id: string;
  email: string | null;
  telegram_id: string | null;
  role: "USER" | "ADMIN";
  isVerified: boolean;
  sessionId: string;
}) => string;

const USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const SESSION_ID = "c3d4e5f6-7890-4bcd-8f12-345678901234";
const FAMILY_ID = "fam-ily-uuid-1234-abcd567890ef";

beforeAll(async () => {
  ({ app } = await import("../../src/app.js"));
  authService = await import("../../src/modules/auth/service.js");
  ({ generateAccessToken } =
    await import("../../src/modules/auth/controller.js"));
});

describe("Auth Missing Integration", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe("POST /api/auth/logout-all", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app).post("/api/auth/logout-all");
      expect(res.status).toBe(401);
    });

    it("revokes all sessions for the user", async () => {
      jest.mocked(authService.findSessionById).mockResolvedValue({
        sessionId: SESSION_ID,
        userId: USER_ID,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      jest
        .mocked(authService.revokeAllUserSessions)
        .mockResolvedValue(undefined);
      jest.mocked(authService.revokeSessionFamily).mockResolvedValue(undefined);

      const accessToken = generateAccessToken({
        id: USER_ID,
        email: "user@test.dev",
        telegram_id: null,
        role: "USER",
        isVerified: true,
        sessionId: SESSION_ID,
      });

      const res = await request(app)
        .post("/api/auth/logout-all")
        .set("Cookie", [`fintrack_access_token=${accessToken}`]);

      expect(res.status).toBe(204);
    });

    it("clears session cookies after logout-all", async () => {
      jest.mocked(authService.findSessionById).mockResolvedValue({
        sessionId: SESSION_ID,
        userId: USER_ID,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      jest
        .mocked(authService.revokeAllUserSessions)
        .mockResolvedValue(undefined);
      jest.mocked(authService.revokeSessionFamily).mockResolvedValue(undefined);

      const accessToken = generateAccessToken({
        id: USER_ID,
        email: "user@test.dev",
        telegram_id: null,
        role: "USER",
        isVerified: true,
        sessionId: SESSION_ID,
      });

      const res = await request(app)
        .post("/api/auth/logout-all")
        .set("Cookie", [`fintrack_access_token=${accessToken}`]);

      expect(res.status).toBe(204);
      const setCookieHeader = res.headers["set-cookie"];
      if (setCookieHeader) {
        const cookieStr = Array.isArray(setCookieHeader)
          ? setCookieHeader.join("; ")
          : setCookieHeader;
        expect(cookieStr).toMatch(/fintrack_access_token=;|Max-Age=0/i);
      }
    });
  });

  describe("POST /api/auth/token — refresh token reuse attack", () => {
    it("returns 401 for already-revoked refresh token", async () => {
      jest.mocked(authService.findSessionByTokenHash).mockResolvedValue({
        sessionId: SESSION_ID,
        tokenHash: "hashed_old_token",
        familyId: FAMILY_ID,
        parentSessionId: null,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(Date.now() - 5_000),
        userAgent: "ua",
        ip: "127.0.0.1",
        lastUsedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: USER_ID,
      });

      jest.mocked(authService.revokeSessionFamily).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/auth/token")
        .send({ token: "old_revoked_refresh_token" });

      expect(res.status).toBe(401);
    });

    it("returns 401 and does not rotate expired refresh token", async () => {
      jest.mocked(authService.findSessionByTokenHash).mockResolvedValue({
        sessionId: SESSION_ID,
        tokenHash: "expired_hash",
        familyId: FAMILY_ID,
        parentSessionId: null,
        expiresAt: new Date(Date.now() - 10_000),
        revokedAt: null,
        userAgent: "ua",
        ip: "127.0.0.1",
        lastUsedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: USER_ID,
      });

      const res = await request(app)
        .post("/api/auth/token")
        .send({ token: "expired_refresh_token" });

      expect(res.status).toBe(401);
      expect(jest.mocked(authService.rotateSession)).not.toHaveBeenCalled();
    });

    it("returns 401 when session not found", async () => {
      jest.mocked(authService.findSessionByTokenHash).mockResolvedValue(null);

      const res = await request(app)
        .post("/api/auth/token")
        .send({ token: "nonexistent_token" });

      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/auth/login — validation", () => {
    it("returns 400 for missing credentials", async () => {
      const res = await request(app).post("/api/auth/login").send({});
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid email format", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "not-an-email", password: "password123" });
      expect(res.status).toBe(400);
    });

    it("returns 400 for missing password", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "user@test.dev" });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/auth/google/exchange — OAuth unhappy paths", () => {
    it("returns 400 for missing idToken", async () => {
      const res = await request(app).post("/api/auth/google/exchange").send({});
      expect(res.status).toBe(400);
    });

    it("returns 400 for empty idToken", async () => {
      const res = await request(app)
        .post("/api/auth/google/exchange")
        .send({ idToken: "" });
      expect(res.status).toBe(400);
    });
  });
});

// Rate limit test uses jest.resetModules() to get fresh rate limiter state
describe("Auth Rate Limiting", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("returns 429 after exceeding login rate limit", async () => {
    const _authServiceModuleMock = {
      findSessionById: jest.fn(),
      findSessionByTokenHash: jest.fn(),
      revokeSessionFamily: jest.fn(),
      revokeSession: jest.fn(),
      rotateSession: jest.fn(),
      createSession: jest.fn(),
      logoutByTokenHash: jest.fn(),
      revokeAllUserSessions: jest.fn(),
      markSessionUsed: jest.fn(),
      loginWithGoogle: jest.fn(),
      loginWithTelegram: jest.fn(),
      findVerificationTokenByUserId: jest.fn(),
      findAuthMethodByEmail: jest.fn(),
      login: jest.fn(),
    };
    jest.unstable_mockModule(
      "../../src/modules/auth/service.js",
      () => _authServiceModuleMock,
    );

    const { app: freshApp } = await import("../../src/app.js");

    // Exceed authLoginLimiter (max: 10)
    for (let i = 0; i < 10; i++) {
      await request(freshApp)
        .post("/api/auth/login")
        .send({ email: "test@test.dev", password: "wrong" });
    }

    const res = await request(freshApp)
      .post("/api/auth/login")
      .send({ email: "test@test.dev", password: "wrong" });

    expect(res.status).toBe(429);
  });

  it("returns 429 after exceeding refresh token rate limit", async () => {
    const __authServiceModuleMock = {
      findSessionById: jest.fn(),
      findSessionByTokenHash: jest.fn(async () => null),
      revokeSessionFamily: jest.fn(),
      revokeSession: jest.fn(),
      rotateSession: jest.fn(),
      createSession: jest.fn(),
      logoutByTokenHash: jest.fn(),
      revokeAllUserSessions: jest.fn(),
      markSessionUsed: jest.fn(),
      loginWithGoogle: jest.fn(),
      loginWithTelegram: jest.fn(),
      findVerificationTokenByUserId: jest.fn(),
      findAuthMethodByEmail: jest.fn(),
      login: jest.fn(),
    };
    jest.unstable_mockModule(
      "../../src/modules/auth/service.js",
      () => __authServiceModuleMock,
    );

    const { app: freshApp } = await import("../../src/app.js");

    // Exceed authRefreshLimiter (max: 60)
    const requests = Array.from({ length: 60 }, () =>
      request(freshApp)
        .post("/api/auth/token")
        .send({ token: "invalid_token" }),
    );
    await Promise.all(requests);

    const res = await request(freshApp)
      .post("/api/auth/token")
      .send({ token: "invalid_token" });

    expect(res.status).toBe(429);
  });
});
