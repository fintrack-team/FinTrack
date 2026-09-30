import { vi } from "vitest";
import request from "supertest";

import type { app as AppType } from "../../src/app.js";
import type * as AuthServiceTypes from "../../src/modules/auth/service.js";
import type * as UserApiKeyServiceTypes from "../../src/modules/user-api-key/service.js";

const authServiceModuleMock = {
  findSessionById: vi.fn(),
  findSessionByTokenHash: vi.fn(),
  revokeSessionFamily: vi.fn(),
  revokeSession: vi.fn(),
  rotateSession: vi.fn(),
  createSession: vi.fn(),
  logoutByTokenHash: vi.fn(),
  revokeAllUserSessions: vi.fn(),
};
vi.mock("../../src/modules/auth/service.js", () => authServiceModuleMock);

const userApiKeyServiceModuleMock = {
  getUserApiKeys: vi.fn(),
  upsertUserApiKey: vi.fn(),
  deleteUserApiKey: vi.fn(),
  toggleUserApiKey: vi.fn(),
};
vi.mock(
  "../../src/modules/user-api-key/service.js",
  () => userApiKeyServiceModuleMock,
);

let app: typeof AppType;
let authService: typeof AuthServiceTypes;
let userApiKeyService: typeof UserApiKeyServiceTypes;
let generateAccessToken: (payload: {
  id: string;
  email: string | null;
  telegram_id: string | null;
  role: "USER" | "ADMIN";
  isVerified: boolean;
  sessionId: string;
}) => string;

const USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const OTHER_USER_ID = "f0e1d2c3-b4a5-6789-9123-456789abcdef";
const SESSION_ID = "c3d4e5f6-7890-4bcd-8f12-345678901234";
const OTHER_SESSION_ID = "d4e5f6a7-8901-4cde-a123-456789012345";
const KEY_ID = "key1b2c3-d4e5-f678-9012-345678901234";

const keyStub = {
  id: KEY_ID,
  provider: "GROQ" as const,
  isActive: true,
  maskedKey: "sk-pro••••••••abcd",
  createdAt: new Date("2025-01-01T00:00:00Z"),
  updatedAt: new Date("2025-01-01T00:00:00Z"),
};

beforeAll(async () => {
  ({ app } = await import("../../src/app.js"));
  authService = await import("../../src/modules/auth/service.js");
  userApiKeyService = await import("../../src/modules/user-api-key/service.js");
  ({ generateAccessToken } =
    await import("../../src/modules/auth/controller.js"));
});

describe("User API Key Integration", () => {
  let token: string;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authService.findSessionById).mockResolvedValue({
      sessionId: SESSION_ID,
      userId: USER_ID,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    token = generateAccessToken({
      id: USER_ID,
      email: "user@test.dev",
      telegram_id: null,
      role: "USER",
      isVerified: true,
      sessionId: SESSION_ID,
    });
  });

  describe("GET /api/user-api-keys", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app).get("/api/user-api-keys");
      expect(res.status).toBe(401);
    });

    it("returns user's api keys", async () => {
      vi.mocked(userApiKeyService.getUserApiKeys).mockResolvedValue([keyStub]);

      const res = await request(app)
        .get("/api/user-api-keys")
        .set("Cookie", [`fintrack_access_token=${token}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].provider).toBe("GROQ");
    });

    it("returns empty array when user has no keys", async () => {
      vi.mocked(userApiKeyService.getUserApiKeys).mockResolvedValue([]);

      const res = await request(app)
        .get("/api/user-api-keys")
        .set("Cookie", [`fintrack_access_token=${token}`]);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });

    it("only returns own keys (userId scoped to token)", async () => {
      vi.mocked(userApiKeyService.getUserApiKeys).mockResolvedValue([keyStub]);

      await request(app)
        .get("/api/user-api-keys")
        .set("Cookie", [`fintrack_access_token=${token}`]);

      expect(vi.mocked(userApiKeyService.getUserApiKeys)).toHaveBeenCalledWith(
        USER_ID,
      );
    });
  });

  describe("PUT /api/user-api-keys", () => {
    const validBody = {
      provider: "GROQ",
      apiKey: "sk-proj-this-is-a-valid-key-1234",
    };

    it("returns 401 without auth", async () => {
      const res = await request(app).put("/api/user-api-keys").send(validBody);
      expect(res.status).toBe(401);
    });

    it("creates api key and returns 200", async () => {
      vi.mocked(userApiKeyService.upsertUserApiKey).mockResolvedValue({
        id: KEY_ID,
        provider: "GROQ",
        isActive: true,
        maskedKey: "sk-pro••••••••1234",
      });

      const res = await request(app)
        .put("/api/user-api-keys")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.body.provider).toBe("GROQ");
    });

    it("updates existing key (upsert) for same provider", async () => {
      vi.mocked(userApiKeyService.upsertUserApiKey).mockResolvedValue({
        id: KEY_ID,
        provider: "GROQ",
        isActive: true,
        maskedKey: "sk-pro••••••••5678",
      });

      await request(app)
        .put("/api/user-api-keys")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ provider: "GROQ", apiKey: "sk-proj-updated-key-5678" });

      expect(
        vi.mocked(userApiKeyService.upsertUserApiKey),
      ).toHaveBeenCalledTimes(1);
    });

    it("returns 400 for invalid provider", async () => {
      const res = await request(app)
        .put("/api/user-api-keys")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ provider: "UNKNOWN_PROVIDER", apiKey: "sk-valid-key-1234" });

      expect(res.status).toBe(400);
    });

    it("returns 400 for apiKey shorter than 10 chars", async () => {
      const res = await request(app)
        .put("/api/user-api-keys")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ provider: "GROQ", apiKey: "short" });

      expect(res.status).toBe(400);
    });

    it("returns 400 for missing body fields", async () => {
      const res = await request(app)
        .put("/api/user-api-keys")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({});

      expect(res.status).toBe(400);
    });

    it("other user cannot access this user's keys (auth scoping)", async () => {
      const otherToken = generateAccessToken({
        id: OTHER_USER_ID,
        email: "other@test.dev",
        telegram_id: null,
        role: "USER",
        isVerified: true,
        sessionId: OTHER_SESSION_ID,
      });

      vi.mocked(authService.findSessionById).mockResolvedValue({
        sessionId: OTHER_SESSION_ID,
        userId: OTHER_USER_ID,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      vi.mocked(userApiKeyService.upsertUserApiKey).mockResolvedValue({
        id: "other-key-id",
        provider: "GROQ",
        isActive: true,
        maskedKey: "sk-pro••••••••aaaa",
      });

      await request(app)
        .put("/api/user-api-keys")
        .set("Cookie", [`fintrack_access_token=${otherToken}`])
        .send(validBody);

      expect(
        vi.mocked(userApiKeyService.upsertUserApiKey),
      ).toHaveBeenCalledWith(OTHER_USER_ID, "GROQ", validBody.apiKey);
    });
  });

  describe("DELETE /api/user-api-keys/:provider", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app).delete("/api/user-api-keys/GROQ");
      expect(res.status).toBe(401);
    });

    it("deletes key and returns 204", async () => {
      vi.mocked(userApiKeyService.deleteUserApiKey).mockResolvedValue(
        undefined,
      );

      const res = await request(app)
        .delete("/api/user-api-keys/GROQ")
        .set("Cookie", [`fintrack_access_token=${token}`]);

      expect(res.status).toBe(204);
      expect(
        vi.mocked(userApiKeyService.deleteUserApiKey),
      ).toHaveBeenCalledWith(USER_ID, "GROQ");
    });

    it("returns 400 for invalid provider param", async () => {
      const res = await request(app)
        .delete("/api/user-api-keys/INVALID_PROVIDER")
        .set("Cookie", [`fintrack_access_token=${token}`]);

      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/user-api-keys/:provider/toggle", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app).patch("/api/user-api-keys/GROQ/toggle");
      expect(res.status).toBe(401);
    });

    it("toggles key and returns 200", async () => {
      vi.mocked(userApiKeyService.toggleUserApiKey).mockResolvedValue({
        provider: "GROQ",
        isActive: false,
      });

      const res = await request(app)
        .patch("/api/user-api-keys/GROQ/toggle")
        .set("Cookie", [`fintrack_access_token=${token}`]);

      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(false);
    });

    it("returns 404 when key not found", async () => {
      vi.mocked(userApiKeyService.toggleUserApiKey).mockResolvedValue(null);

      const res = await request(app)
        .patch("/api/user-api-keys/GROQ/toggle")
        .set("Cookie", [`fintrack_access_token=${token}`]);

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid provider param", async () => {
      const res = await request(app)
        .patch("/api/user-api-keys/BADPROVIDER/toggle")
        .set("Cookie", [`fintrack_access_token=${token}`]);

      expect(res.status).toBe(400);
    });
  });
});
