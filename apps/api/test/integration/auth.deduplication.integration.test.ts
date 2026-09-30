/**
 * Account deduplication tests
 *
 * Covers:
 *   A) "1 manual, 2 Google" — registering with email, then signing in with
 *      Google using the same address must link to the SAME account.
 *   B) "1 Google, 2 manual" — signing in with Google first, then trying to
 *      register with the same email must be rejected with 409.
 *   C) Google exchange with unverified/invalid token is rejected.
 *   D) Leaderboard is accessible to unverified users.
 */

import { jest } from "@jest/globals";
import request from "supertest";

import type { app as AppType } from "../../src/app.js";
import type * as AuthServiceTypes from "../../src/modules/auth/service.js";
import type * as UserServiceTypes from "../../src/modules/user/service.js";
import type { AppError as AppErrorType } from "../../src/middleware/errorHandler.js";
import type { generateAccessToken as GenerateAccessTokenType } from "../../src/modules/auth/controller.js";

const mockVerifyIdToken =
  jest.fn<
    () => Promise<{ getPayload: () => Record<string, unknown> | null }>
  >();

jest.unstable_mockModule("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken = mockVerifyIdToken;
  },
}));

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
const mailerMock = {
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

jest.unstable_mockModule("../../src/utils/mailer.js", () => mailerMock);

let app: typeof AppType;
let authService: typeof AuthServiceTypes;
let userService: typeof UserServiceTypes;
let AppError: typeof AppErrorType;
let generateAccessToken: typeof GenerateAccessTokenType;

beforeAll(async () => {
  ({ app } = await import("../../src/app.js"));
  authService = await import("../../src/modules/auth/service.js");
  userService = await import("../../src/modules/user/service.js");
  ({ AppError } = await import("../../src/middleware/errorHandler.js"));
  ({ generateAccessToken } =
    await import("../../src/modules/auth/controller.js"));
});

const SESSION_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makeUserStub(overrides: Partial<{ isVerified: boolean }> = {}) {
  return {
    id: USER_ID,
    name: "Test User",
    email: "test@example.com",
    photo_url: null,
    isVerified: overrides.isVerified ?? true,
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
        id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        type: "EMAIL" as const,
        email: "test@example.com",
        telegram_id: null,
        google_sub: null,
      },
    ],
  };
}

function makeSessionStub(userId = USER_ID) {
  return {
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
    userId,
  };
}

// ── Scenario A: manual first, Google second ───────────────────────────────

describe("Scenario A — manual registration then Google login with same email", () => {
  beforeEach(() => jest.resetAllMocks());

  it("links Google to the existing email account and issues session cookies", async () => {
    const userStub = makeUserStub({ isVerified: true });

    jest.mocked(authService.loginWithGoogle).mockResolvedValue(userStub);
    jest.mocked(authService.createSession).mockResolvedValue(makeSessionStub());
    jest.mocked(authService.findSessionById).mockResolvedValue({
      sessionId: SESSION_ID,
      userId: USER_ID,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: "google-sub-existing",
        email: "test@example.com",
        email_verified: true,
        name: "Test User",
        iss: "https://accounts.google.com",
        aud: process.env.GOOGLE_CLIENT_ID,
      }),
    });

    const response = await request(app)
      .post("/api/auth/google/exchange")
      .send({ idToken: "valid_id_token" });

    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("fintrack_access_token="),
        expect.stringContaining("fintrack_refresh_token="),
      ]),
    );
  });

  it("returns 409 when loginWithGoogle reports a conflict", async () => {
    jest
      .mocked(authService.loginWithGoogle)
      .mockRejectedValue(new AppError("Item already exists", 409));

    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: "google-sub-conflict",
        email: "conflict@example.com",
        email_verified: true,
        iss: "https://accounts.google.com",
        aud: process.env.GOOGLE_CLIENT_ID,
      }),
    });

    const response = await request(app)
      .post("/api/auth/google/exchange")
      .send({ idToken: "conflict_token" });

    expect(response.status).toBe(409);
  });
});

// ── Scenario B: Google first, manual registration second ─────────────────

describe("Scenario B — Google login first, then manual registration with same email", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns 409 when userService.findUserByEmail detects an existing account", async () => {
    // Simulate a Google-first user: User.email is already set in the DB
    jest.mocked(userService.findUserByEmail).mockResolvedValue({ id: USER_ID });

    const response = await request(app)
      .post("/api/users")
      .send({
        name: "Test User",
        authMethods: [
          { type: "EMAIL", email: "test@example.com", password: "SecurePass1" },
        ],
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe(
      "An account with this email already exists",
    );
    expect(userService.findUserByEmail).toHaveBeenCalledWith(
      "test@example.com",
    );
  });

  it("allows registration and sends verification email when no conflict exists", async () => {
    jest.mocked(userService.findUserByEmail).mockResolvedValue(null);

    const createdUser = makeUserStub({ isVerified: false });
    jest.mocked(userService.createUser).mockResolvedValue(createdUser);
    jest
      .mocked(authService.createEmailVerificationToken)
      .mockResolvedValue("tok123");

    const response = await request(app)
      .post("/api/users")
      .send({
        name: "New User",
        authMethods: [
          { type: "EMAIL", email: "new@example.com", password: "SecurePass1" },
        ],
      });

    expect(response.status).toBe(201);
    expect(userService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@example.com" }),
    );
  });
});

// ── Scenario C: Google token validation ──────────────────────────────────

describe("Scenario C — Google exchange token validation", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns 401 when Google email_verified is false", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: "google-sub-unverified",
        email: "unverified@example.com",
        email_verified: false,
        iss: "https://accounts.google.com",
        aud: process.env.GOOGLE_CLIENT_ID,
      }),
    });

    const response = await request(app)
      .post("/api/auth/google/exchange")
      .send({ idToken: "unverified_token" });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Google email is not verified");
  });

  it("returns 400 for missing idToken payload", async () => {
    const response = await request(app)
      .post("/api/auth/google/exchange")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid Google exchange payload");
  });
});

// ── Leaderboard: accessible to unverified users ───────────────────────────

describe("Donation leaderboard — accessible without email verification", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns 200 (not 403) for an authenticated but unverified user", async () => {
    const accessToken = generateAccessToken({
      id: USER_ID,
      email: "test@example.com",
      telegram_id: null,
      role: "USER",
      isVerified: false,
      sessionId: SESSION_ID,
    });

    jest.mocked(authService.findSessionById).mockResolvedValue({
      sessionId: SESSION_ID,
      userId: USER_ID,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const response = await request(app)
      .get("/api/donations/leaderboard")
      .set("Cookie", [`fintrack_access_token=${accessToken}`]);

    expect(response.status).not.toBe(403);
    expect(response.status).toBe(200);
  });
});
