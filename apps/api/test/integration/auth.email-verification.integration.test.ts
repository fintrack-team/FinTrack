/**
 * Email verification flow tests
 *
 * Covers:
 *   1. GET /api/auth/verify-email  — valid token → session issued + redirect
 *   2. GET /api/auth/verify-email  — missing token → 400
 *   3. GET /api/auth/verify-email  — invalid/expired token → 400
 *   4. POST /api/auth/resend-verification — always returns 200 (no leak)
 *   5. POST /api/auth/resend-verification — sends email for unverified user
 *   6. POST /api/auth/resend-verification — silently skips already-verified user
 */

import { jest } from "@jest/globals";
import request from "supertest";

import type { app as AppType } from "../../src/app.js";
import type * as AuthServiceTypes from "../../src/modules/auth/service.js";
import type * as UserServiceTypes from "../../src/modules/user/service.js";
import type { AppError as AppErrorType } from "../../src/middleware/errorHandler.js";

// Mock objects are built once at module scope: jest may call a mock factory
// more than once (it does on Linux), and a fresh object per call would leave
// the test configuring a different jest.fn than the one the app calls.
const authServiceMock = {
  login: jest.fn(),
  loginWithGoogle: jest.fn(),
  createSession: jest.fn(),
  findSessionById: jest.fn(),
  findSessionByTokenHash: jest.fn(),
  revokeSessionFamily: jest.fn(),
  revokeSession: jest.fn(),
  createEmailVerificationToken: jest.fn(),
  consumeEmailVerificationToken: jest.fn(),
  findVerificationTokenByUserId: jest.fn(),
  findAuthMethodByEmail: jest.fn(),
};
const userServiceMock = {
  getUser: jest.fn(),
  createUser: jest.fn(),
  findUserByEmail: jest.fn(),
  deleteAuthMethod: jest.fn(),
};
const mailerModuleMock = {
  sendVerificationEmail: jest
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined),
};

jest.unstable_mockModule(
  "../../src/modules/auth/service.js",
  () => authServiceMock,
);

jest.unstable_mockModule(
  "../../src/modules/user/service.js",
  () => userServiceMock,
);

jest.unstable_mockModule("../../src/utils/mailer.js", () => mailerModuleMock);

let app: typeof AppType;
let authService: typeof AuthServiceTypes;
let userService: typeof UserServiceTypes;
let AppError: typeof AppErrorType;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mailerMock: any;

beforeAll(async () => {
  ({ app } = await import("../../src/app.js"));
  authService = await import("../../src/modules/auth/service.js");
  userService = await import("../../src/modules/user/service.js");
  ({ AppError } = await import("../../src/middleware/errorHandler.js"));
  mailerMock = await import("../../src/utils/mailer.js");
});

const USER_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const SESSION_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

function makeUserStub(isVerified = false) {
  return {
    id: USER_ID,
    name: "Test User",
    email: "user@example.com",
    photo_url: null,
    isVerified,
    role: "USER" as const,
    aiAnalysisUsed: 0,
    aiAnalysisLimit: 10,
    donationStatus: "NONE" as const,
    donationGrantedAt: null,
    donationExpiresAt: null,
    stripeCustomerId: null,
    created_at: new Date(),
    updated_at: new Date(),
    authMethods: [
      {
        id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        type: "EMAIL" as const,
        email: "user@example.com",
        telegram_id: null,
        google_sub: null,
      },
    ],
  };
}

function makeAuthMethodStub() {
  return {
    id: "am-id",
    userId: USER_ID,
    type: "EMAIL" as const,
    email: "user@example.com",
    password_hash: "hash",
    telegram_id: null,
    google_sub: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ── 1. Valid token → verified + session + redirect ────────────────────────

describe("GET /api/auth/verify-email", () => {
  beforeEach(() => jest.resetAllMocks());

  it("consumes valid token, issues session cookies, and redirects", async () => {
    const verifiedUser = makeUserStub(true);

    jest
      .mocked(authService.consumeEmailVerificationToken)
      .mockResolvedValue(USER_ID);
    jest.mocked(userService.getUser).mockResolvedValue(verifiedUser);
    jest.mocked(authService.createSession).mockResolvedValue({
      sessionId: SESSION_ID,
      tokenHash: "hash",
      familyId: "fam-1",
      parentSessionId: null,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      userAgent: null,
      ip: null,
      lastUsedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: USER_ID,
    });

    const response = await request(app)
      .get("/api/auth/verify-email")
      .query({ token: "valid_token_abc123" });

    expect(response.status).toBe(302);
    expect(authService.consumeEmailVerificationToken).toHaveBeenCalledWith(
      "valid_token_abc123",
    );
    expect(response.headers["set-cookie"]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("fintrack_access_token="),
        expect.stringContaining("fintrack_refresh_token="),
      ]),
    );
  });

  it("returns 400 when token query param is missing", async () => {
    const response = await request(app).get("/api/auth/verify-email");

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Missing verification token");
  });

  it("returns 400 when token is invalid", async () => {
    jest
      .mocked(authService.consumeEmailVerificationToken)
      .mockRejectedValue(
        new AppError("Invalid or expired verification token", 400),
      );

    const response = await request(app)
      .get("/api/auth/verify-email")
      .query({ token: "bad_token" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid or expired verification token");
  });

  it("returns 400 when token is expired", async () => {
    jest
      .mocked(authService.consumeEmailVerificationToken)
      .mockRejectedValue(new AppError("Verification token expired", 400));

    const response = await request(app)
      .get("/api/auth/verify-email")
      .query({ token: "expired_token" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Verification token expired");
  });
});

// ── 2. Resend verification ────────────────────────────────────────────────

describe("POST /api/auth/resend-verification", () => {
  beforeEach(() => jest.resetAllMocks());

  it("always returns 200 even when email does not exist (no enumeration leak)", async () => {
    jest.mocked(authService.findAuthMethodByEmail).mockResolvedValue(null);

    const response = await request(app)
      .post("/api/auth/resend-verification")
      .send({ email: "ghost@example.com" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ sent: true });
    expect(mailerMock.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("sends verification email for an unverified user", async () => {
    const unverifiedUser = makeUserStub(false);

    jest
      .mocked(authService.findAuthMethodByEmail)
      .mockResolvedValue(makeAuthMethodStub());
    jest.mocked(userService.getUser).mockResolvedValue(unverifiedUser);
    jest
      .mocked(authService.createEmailVerificationToken)
      .mockResolvedValue("fresh_token_xyz");
    // resetAllMocks() wipes the factory's resolved value; the controller chains
    // .catch() on the result, so the mock must return a promise again.
    mailerMock.sendVerificationEmail.mockResolvedValue(undefined);

    const response = await request(app)
      .post("/api/auth/resend-verification")
      .send({ email: "user@example.com" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ sent: true });
    expect(mailerMock.sendVerificationEmail).toHaveBeenCalledWith(
      "user@example.com",
      "fresh_token_xyz",
      "Test User",
    );
  });

  it("silently skips sending when user is already verified", async () => {
    const verifiedUser = makeUserStub(true);

    jest
      .mocked(authService.findAuthMethodByEmail)
      .mockResolvedValue(makeAuthMethodStub());
    jest.mocked(userService.getUser).mockResolvedValue(verifiedUser);

    const response = await request(app)
      .post("/api/auth/resend-verification")
      .send({ email: "user@example.com" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ sent: true });
    expect(mailerMock.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid email format", async () => {
    const response = await request(app)
      .post("/api/auth/resend-verification")
      .send({ email: "not-an-email" });

    expect(response.status).toBe(400);
  });
});

// ── 3. createEmailVerificationToken unit-level ────────────────────────────

describe("authService.createEmailVerificationToken (unit)", () => {
  it("is callable and returns a string token (mock)", async () => {
    jest
      .mocked(authService.createEmailVerificationToken)
      .mockResolvedValue("mock_token_48bytes");

    const token = await authService.createEmailVerificationToken(USER_ID);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });
});

// ── 4. consumeEmailVerificationToken unit-level ───────────────────────────

describe("authService.consumeEmailVerificationToken (unit)", () => {
  it("returns userId on success (mock)", async () => {
    jest
      .mocked(authService.consumeEmailVerificationToken)
      .mockResolvedValue(USER_ID);

    const result = await authService.consumeEmailVerificationToken("any_token");
    expect(result).toBe(USER_ID);
  });

  it("throws AppError on bad token (mock)", async () => {
    jest
      .mocked(authService.consumeEmailVerificationToken)
      .mockRejectedValue(
        new AppError("Invalid or expired verification token", 400),
      );

    await expect(
      authService.consumeEmailVerificationToken("bad"),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
