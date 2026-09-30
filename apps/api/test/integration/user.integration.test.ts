import { jest } from "@jest/globals";
import request from "supertest";

import type { app as AppType } from "../../src/app.js";
import type * as UserServiceTypes from "../../src/modules/user/service.js";
import type * as AuthServiceTypes from "../../src/modules/auth/service.js";
import type { AppError as AppErrorType } from "../../src/middleware/errorHandler.js";
import type { generateAccessToken as GenerateAccessTokenType } from "../../src/modules/auth/controller.js";

const mockTransaction = jest.fn();

// Mock objects are built once at module scope: jest may call a mock factory
// more than once (it does on Linux), and a fresh object per call would leave
// the test configuring a different jest.fn than the one the app calls.
const prismaClientModuleMock = {
  prisma: { $transaction: mockTransaction },
};
jest.unstable_mockModule(
  "../../src/prisma/client.js",
  () => prismaClientModuleMock,
);

const authServiceModuleMock = {
  findSessionById: jest.fn(),
  findSessionByTokenHash: jest.fn(),
  revokeSessionFamily: jest.fn(),
  loginWithGoogle: jest.fn(),
  createSession: jest.fn(),
  createEmailVerificationToken: jest.fn(),
};
jest.unstable_mockModule(
  "../../src/modules/auth/service.js",
  () => authServiceModuleMock,
);

const userServiceModuleMock = {
  getUser: jest.fn(),
  deleteAuthMethod: jest.fn(),
  updateUser: jest.fn(),
  updateUserAuthMethods: jest.fn(),
  deleteUser: jest.fn(),
  createUser: jest.fn(),
  findUserByEmail: jest.fn(),
};
jest.unstable_mockModule(
  "../../src/modules/user/service.js",
  () => userServiceModuleMock,
);

let app: typeof AppType;
let authService: typeof AuthServiceTypes;
let userService: typeof UserServiceTypes;
let generateAccessToken: typeof GenerateAccessTokenType;
let AppError: typeof AppErrorType;

beforeAll(async () => {
  ({ app } = await import("../../src/app.js"));
  authService = await import("../../src/modules/auth/service.js");
  userService = await import("../../src/modules/user/service.js");
  ({ generateAccessToken } =
    await import("../../src/modules/auth/controller.js"));
  ({ AppError } = await import("../../src/middleware/errorHandler.js"));
});

const USER_ID = "66ba6cb3-3a2d-4fd9-8a61-30f5ad4fd897";
const SESSION_ID = "5c8dff72-a6f7-4293-af7a-7c7f6190c020";

const userStub = {
  id: USER_ID,
  name: "Test User",
  email: "me@test.dev",
  photo_url: null,
  isVerified: true,
  role: "USER" as const,
  aiAnalysisUsed: 0,
  aiAnalysisLimit: 10,
  donationStatus: "NONE" as const,
  donationGrantedAt: null,
  donationExpiresAt: null,
  stripeCustomerId: null,
  created_at: new Date(),
  updated_at: new Date(),
  authMethods: [],
};

describe("User Integration", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    );
  });

  it("uses current user id from token for deleting auth method (/me path)", async () => {
    const currentUserId = "66ba6cb3-3a2d-4fd9-8a61-30f5ad4fd897";
    const authMethodId = "5c8dff72-a6f7-4293-af7a-7c7f6190c020";

    const accessToken = generateAccessToken({
      id: currentUserId,
      email: "me@test.dev",
      telegram_id: null,
      role: "USER",
      isVerified: true,
      sessionId: "5c8dff72-a6f7-4293-af7a-7c7f6190c020",
    });

    jest.mocked(authService.findSessionById).mockResolvedValue({
      sessionId: "5c8dff72-a6f7-4293-af7a-7c7f6190c020",
      userId: currentUserId,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    jest.mocked(userService.deleteAuthMethod).mockResolvedValue(undefined);

    const response = await request(app)
      .delete(`/api/users/me/auth-methods/${authMethodId}`)
      .set("Cookie", [`fintrack_access_token=${accessToken}`]);

    expect(response.status).toBe(204);
  });

  it("returns 404 for /api/users/me/auth-methods/:id when service does not find method", async () => {
    const currentUserId = "5b0e88d2-5a89-4b11-96ab-8936d5117aa6";
    const authMethodId = "97552032-a5b4-4be3-90f8-b2e9f22ab44f";

    const accessToken = generateAccessToken({
      id: currentUserId,
      email: "me@test.dev",
      telegram_id: null,
      role: "USER",
      isVerified: true,
      sessionId: "97552032-a5b4-4be3-90f8-b2e9f22ab44f",
    });

    jest.mocked(authService.findSessionById).mockResolvedValue({
      sessionId: "97552032-a5b4-4be3-90f8-b2e9f22ab44f",
      userId: currentUserId,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    jest
      .mocked(userService.deleteAuthMethod)
      .mockRejectedValue(new AppError("Auth method not found", 404));

    const response = await request(app)
      .delete(`/api/users/me/auth-methods/${authMethodId}`)
      .set("Cookie", [`fintrack_access_token=${accessToken}`]);

    expect(response.status).toBe(404);
  });

  describe("GET /api/users/me", () => {
    it("returns 200 with current user", async () => {
      jest.mocked(userService.getUser).mockResolvedValue(userStub);

      const token = generateAccessToken({
        id: USER_ID,
        email: "me@test.dev",
        telegram_id: null,
        role: "USER",
        isVerified: true,
        sessionId: SESSION_ID,
      });

      const res = await request(app)
        .get("/api/users/me")
        .set("Cookie", [`fintrack_access_token=${token}`]);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(USER_ID);
      expect(res.body.name).toBe("Test User");
    });

    it("returns 404 when user not found", async () => {
      jest.mocked(userService.getUser).mockResolvedValue(null);

      const token = generateAccessToken({
        id: USER_ID,
        email: "me@test.dev",
        telegram_id: null,
        role: "USER",
        isVerified: true,
        sessionId: SESSION_ID,
      });

      const res = await request(app)
        .get("/api/users/me")
        .set("Cookie", [`fintrack_access_token=${token}`]);

      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/users/me", () => {
    it("returns 200 with updated user", async () => {
      const updatedStub = { ...userStub, name: "New Name" };
      jest.mocked(userService.updateUser).mockResolvedValue(undefined);
      jest.mocked(userService.getUser).mockResolvedValue(updatedStub);

      const token = generateAccessToken({
        id: USER_ID,
        email: "me@test.dev",
        telegram_id: null,
        role: "USER",
        isVerified: true,
        sessionId: SESSION_ID,
      });

      const res = await request(app)
        .patch("/api/users/me")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ name: "New Name" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("New Name");
    });

    it("returns 400 for invalid body", async () => {
      const token = generateAccessToken({
        id: USER_ID,
        email: "me@test.dev",
        telegram_id: null,
        role: "USER",
        isVerified: true,
        sessionId: SESSION_ID,
      });

      const res = await request(app)
        .patch("/api/users/me")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ name: 12345 });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/users/me", () => {
    it("returns 204 after deleting own account", async () => {
      jest.mocked(userService.deleteUser).mockResolvedValue(undefined);

      const token = generateAccessToken({
        id: USER_ID,
        email: "me@test.dev",
        telegram_id: null,
        role: "USER",
        isVerified: true,
        sessionId: SESSION_ID,
      });

      const res = await request(app)
        .delete("/api/users/me")
        .set("Cookie", [`fintrack_access_token=${token}`]);

      expect(res.status).toBe(204);
      expect(jest.mocked(userService.deleteUser)).toHaveBeenCalledWith(USER_ID);
    });
  });
});
