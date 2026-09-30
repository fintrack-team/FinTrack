/**
 * Password reset flow tests
 *
 * Covers the controller/validation contract for:
 *   1. POST /api/auth/forgot-password — always returns 200 (no enumeration leak)
 *   2. POST /api/auth/forgot-password — 400 for invalid email format
 *   3. POST /api/auth/reset-password  — 200 { reset: true } for a valid body
 *   4. POST /api/auth/reset-password  — 400 for a password that fails complexity
 *   5. POST /api/auth/reset-password  — 400 when the token is missing
 *
 * NOTE: like the sibling auth integration suites, the service module is mocked
 * and assertions stay at the HTTP/validation layer.
 */

import { vi } from "vitest";
import request from "supertest";

import type { app as AppType } from "../../src/app.js";

const authServiceModuleMock = {
  login: vi.fn(),
  loginWithGoogle: vi.fn(),
  createSession: vi.fn(),
  findSessionById: vi.fn(),
  findSessionByTokenHash: vi.fn(),
  revokeSessionFamily: vi.fn(),
  revokeSession: vi.fn(),
  createEmailVerificationToken: vi.fn(),
  consumeEmailVerificationToken: vi.fn(),
  findVerificationTokenByUserId: vi.fn(),
  findAuthMethodByEmail: vi.fn(),
  createPasswordResetToken: vi.fn(),
  consumePasswordResetToken: vi.fn(),
};
vi.mock("../../src/modules/auth/service.js", () => authServiceModuleMock);

const userServiceModuleMock = {
  getUser: vi.fn(),
  createUser: vi.fn(),
  findUserByEmail: vi.fn(),
  deleteAuthMethod: vi.fn(),
};
vi.mock("../../src/modules/user/service.js", () => userServiceModuleMock);

const utilsMailerModuleMock = {
  sendVerificationEmail: vi
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined),
  sendPasswordResetEmail: vi
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined),
};
vi.mock("../../src/utils/mailer.js", () => utilsMailerModuleMock);

let app: typeof AppType;

beforeAll(async () => {
  ({ app } = await import("../../src/app.js"));
});

const STRONG_PASSWORD = "NewPassw0rd";

// ── 1. Forgot password ────────────────────────────────────────────────────

describe("POST /api/auth/forgot-password", () => {
  it("returns 200 without leaking whether the email is registered", async () => {
    const response = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "ghost@example.com" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ sent: true });
  });

  it("returns 400 for invalid email format", async () => {
    const response = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "not-an-email" });

    expect(response.status).toBe(400);
  });
});

// ── 2. Reset password ─────────────────────────────────────────────────────

describe("POST /api/auth/reset-password", () => {
  it("returns 200 for a well-formed token + strong password", async () => {
    const response = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "valid_token", password: STRONG_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ reset: true });
  });

  it("returns 400 for a password that fails complexity rules", async () => {
    const response = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "valid_token", password: "alllowercase" });

    expect(response.status).toBe(400);
  });

  it("returns 400 when the token is missing", async () => {
    const response = await request(app)
      .post("/api/auth/reset-password")
      .send({ password: STRONG_PASSWORD });

    expect(response.status).toBe(400);
  });
});
