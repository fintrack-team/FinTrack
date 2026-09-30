import { vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

import type { app as AppType } from "../../src/app.js";
import type * as AuthServiceTypes from "../../src/modules/auth/service.js";

const authServiceModuleMock = {
  findSessionById: vi.fn(),
  findSessionByTokenHash: vi.fn(),
  revokeSessionFamily: vi.fn(),
  revokeSession: vi.fn(),
  rotateSession: vi.fn(),
  createSession: vi.fn(),
  logoutByTokenHash: vi.fn(),
};
vi.mock("../../src/modules/auth/service.js", () => authServiceModuleMock);

const userServiceModuleMock = {
  getUser: vi.fn(),
};
vi.mock("../../src/modules/user/service.js", () => userServiceModuleMock);

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

beforeAll(async () => {
  ({ app } = await import("../../src/app.js"));
  authService = await import("../../src/modules/auth/service.js");
  ({ generateAccessToken } =
    await import("../../src/modules/auth/controller.js"));
});

describe("Access token lifecycle integration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 for token with invalid signature", async () => {
    const payload = {
      id: "f4f9d2eb-52d9-4a89-a2e1-7f3f6f1f0f11",
      email: "user@test.dev",
      telegram_id: null,
      role: "USER" as const,
      isVerified: true,
      sessionId: "e6594ef2-7a59-4f7a-99f9-862758f624b2",
    };

    const invalidToken = jwt.sign(payload, "wrong_secret", { expiresIn: 60 });

    const response = await request(app)
      .get("/api/users/me")
      .set("Cookie", [`fintrack_access_token=${invalidToken}`]);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid access token");
  });

  it("returns 401 for expired access token", async () => {
    const expiredToken = jwt.sign(
      {
        id: "f4f9d2eb-52d9-4a89-a2e1-7f3f6f1f0f11",
        email: "user@test.dev",
        telegram_id: null,
        role: "USER",
        isVerified: true,
        sessionId: "e6594ef2-7a59-4f7a-99f9-862758f624b2",
      },
      process.env.ACCESS_TOKEN_SECRET || "test_access_secret",
      { expiresIn: -5 },
    );

    const response = await request(app)
      .get("/api/users/me")
      .set("Cookie", [`fintrack_access_token=${expiredToken}`]);

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Access token expired");
  });

  it("returns 401 when token is valid but session is revoked", async () => {
    const validToken = generateAccessToken({
      id: "f4f9d2eb-52d9-4a89-a2e1-7f3f6f1f0f11",
      email: "user@test.dev",
      telegram_id: null,
      role: "USER",
      isVerified: true,
      sessionId: "e6594ef2-7a59-4f7a-99f9-862758f624b2",
    });

    vi.mocked(authService.findSessionById).mockResolvedValue({
      sessionId: "e6594ef2-7a59-4f7a-99f9-862758f624b2",
      userId: "f4f9d2eb-52d9-4a89-a2e1-7f3f6f1f0f11",
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const response = await request(app)
      .get("/api/users/me")
      .set("Cookie", [`fintrack_access_token=${validToken}`]);

    expect(response.status).toBe(404);
  });
});
