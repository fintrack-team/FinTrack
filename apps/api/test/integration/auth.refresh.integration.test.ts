import { vi } from "vitest";
import request from "supertest";

import type { app as AppType } from "../../src/app.js";
import type * as AuthServiceTypes from "../../src/modules/auth/service.js";

const authServiceMock = {
  findSessionById: vi.fn(),
  findSessionByTokenHash: vi.fn(),
  revokeSessionFamily: vi.fn(),
  revokeSession: vi.fn(),
  rotateSession: vi.fn(),
  createSession: vi.fn(),
  logoutByTokenHash: vi.fn(),
};

vi.mock("../../src/modules/auth/service.js", () => authServiceMock);

let app: typeof AppType;
let authService: typeof AuthServiceTypes;

beforeAll(async () => {
  ({ app } = await import("../../src/app.js"));
  authService = await import("../../src/modules/auth/service.js");
});

describe("Auth Refresh Flow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 and revokes expired refresh session", async () => {
    vi.mocked(authService.findSessionByTokenHash).mockResolvedValue({
      sessionId: "e5af2f58-5f09-4c64-8e13-f5b9323248d0",
      tokenHash: "hash",
      familyId: "family-1",
      parentSessionId: null,
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
      userAgent: "ua",
      ip: "127.0.0.1",
      lastUsedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: "1772f0ba-450d-4b81-bb7c-df6f0a7483c3",
    });

    const response = await request(app)
      .post("/api/auth/token")
      .send({ token: "expired_token" });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Refresh token expired");
    expect(authService.revokeSession).toHaveBeenCalledWith(
      "e5af2f58-5f09-4c64-8e13-f5b9323248d0",
    );
  });

  it("revokes family when refresh token is already revoked", async () => {
    vi.mocked(authService.findSessionByTokenHash).mockResolvedValue({
      sessionId: "e5af2f58-5f09-4c64-8e13-f5b9323248d0",
      tokenHash: "hash",
      familyId: "family-1",
      parentSessionId: null,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(),
      userAgent: "ua",
      ip: "127.0.0.1",
      lastUsedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: "1772f0ba-450d-4b81-bb7c-df6f0a7483c3",
    });

    const response = await request(app)
      .post("/api/auth/token")
      .send({ token: "valid_refresh_token" });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Refresh token reuse detected");
    expect(authService.revokeSessionFamily).toHaveBeenCalledWith("family-1");
  });
});
