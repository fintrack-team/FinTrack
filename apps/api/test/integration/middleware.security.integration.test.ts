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
  loginWithGoogle: jest.fn(),
};
jest.unstable_mockModule(
  "../../src/modules/auth/service.js",
  () => authServiceModuleMock,
);

let app: typeof AppType;
let authService: typeof AuthServiceTypes;

beforeAll(async () => {
  ({ app } = await import("../../src/app.js"));
  authService = await import("../../src/modules/auth/service.js");
});

describe("Middleware / Security Integration", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe("Helmet security headers", () => {
    it("sets X-Content-Type-Options: nosniff", async () => {
      const res = await request(app).get("/api/health");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("sets X-Frame-Options or CSP frame-ancestors", async () => {
      const res = await request(app).get("/api/health");
      const hasXFrameOptions = "x-frame-options" in res.headers;
      const hasCsp = "content-security-policy" in res.headers;
      expect(hasXFrameOptions || hasCsp).toBe(true);
    });

    it("sets X-DNS-Prefetch-Control", async () => {
      const res = await request(app).get("/api/health");
      expect(res.headers["x-dns-prefetch-control"]).toBeDefined();
    });

    it("sets Strict-Transport-Security or equivalent", async () => {
      const res = await request(app).get("/api/health");
      // helmet provides HSTS — present in most configs
      expect(res.headers["strict-transport-security"]).toBeDefined();
    });

    it("does not expose X-Powered-By header", async () => {
      const res = await request(app).get("/api/health");
      expect(res.headers["x-powered-by"]).toBeUndefined();
    });
  });

  describe("CORS", () => {
    it("allows configured dev origins", async () => {
      const res = await request(app)
        .get("/api/health")
        .set("Origin", "http://localhost:3000");
      expect(res.headers["access-control-allow-origin"]).toBe(
        "http://localhost:3000",
      );
    });

    it("allows localhost:5173 (Vite dev origin)", async () => {
      const res = await request(app)
        .get("/api/health")
        .set("Origin", "http://localhost:5173");
      expect(res.headers["access-control-allow-origin"]).toBe(
        "http://localhost:5173",
      );
    });

    it("blocks unknown origins in non-production", async () => {
      const res = await request(app)
        .options("/api/health")
        .set("Origin", "https://evil-site.example.com");
      // CORS allowlist rejects unknown origin — header must be absent
      const origin = res.headers["access-control-allow-origin"];
      expect(origin).toBeUndefined();
    });

    it("includes credentials header for allowed origins", async () => {
      const res = await request(app)
        .get("/api/health")
        .set("Origin", "http://localhost:3000");
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });
  });

  describe("CSRF token endpoint", () => {
    it("GET /api/csrf-token returns 200 with csrfToken", async () => {
      const res = await request(app).get("/api/csrf-token");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("csrfToken");
      expect(typeof res.body.csrfToken).toBe("string");
      expect(res.body.csrfToken.length).toBeGreaterThan(0);
    });

    it("CSRF is bypassed for login endpoint in test env", async () => {
      // In test env NODE_ENV=test, CSRF protection is always skipped
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "test@test.dev", password: "password" });
      // Should not fail with CSRF error (403 CSRF_INVALID)
      expect(res.status).not.toBe(403);
      expect(res.body?.code).not.toBe("CSRF_INVALID");
    });

    it("CSRF is bypassed for webhook endpoint", async () => {
      const res = await request(app)
        .post("/api/donations/webhook")
        .set("content-type", "application/json")
        .send(Buffer.from("{}"));
      // Should fail with stripe-signature error (400), not CSRF error (403)
      expect(res.status).toBe(400);
      expect(res.body?.code).not.toBe("CSRF_INVALID");
    });
  });

  describe("404 catch-all", () => {
    it("returns 404 for unknown routes", async () => {
      const res = await request(app).get("/api/nonexistent-endpoint");
      expect(res.status).toBe(404);
    });

    it("returns 404 for unknown POST routes", async () => {
      const res = await request(app).post("/api/does-not-exist").send({});
      expect(res.status).toBe(404);
    });
  });

  describe("Request body limits", () => {
    it("returns 413 for JSON body exceeding 32kb limit", async () => {
      jest.mocked(authService.findSessionById).mockResolvedValue({
        sessionId: "sess-1234",
        userId: "user-1234",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      // Generate body larger than 32kb
      const largeBody = { data: "x".repeat(35 * 1024) };

      const res = await request(app)
        .post("/api/transactions")
        .set("content-type", "application/json")
        .send(JSON.stringify(largeBody));

      expect(res.status).toBe(413);
    });
  });
});
