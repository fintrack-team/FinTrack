import { jest } from "@jest/globals";
import request from "supertest";

import type { app as AppType } from "../../src/app.js";
import type * as AdminServiceTypes from "../../src/modules/admin/service.js";
import type * as AuthServiceTypes from "../../src/modules/auth/service.js";
import type { generateAccessToken as GenerateAccessTokenType } from "../../src/modules/auth/controller.js";

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

const adminServiceModuleMock = {
  getAdminStats: jest.fn(),
  reportErrorLog: jest.fn(),
  revokeUserSessions: jest.fn(),
  revokeAllSessions: jest.fn(),
  updateUserRole: jest.fn(),
  listUsers: jest.fn(),
  listErrorLogs: jest.fn(),
  resolveErrorLog: jest.fn(),
};
jest.unstable_mockModule(
  "../../src/modules/admin/service.js",
  () => adminServiceModuleMock,
);

let app: typeof AppType;
let authService: typeof AuthServiceTypes;
let adminService: typeof AdminServiceTypes;
let generateAccessToken: typeof GenerateAccessTokenType;

const USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const ADMIN_ID = "b2c3d4e5-f678-40ab-9def-123456789012";
const TARGET_USER_ID = "deadbeef-dead-4eef-abad-beefdeadbeef";
const SESSION_ID = "c3d4e5f6-7890-4bcd-8f12-345678901234";
const ADMIN_SESSION_ID = "d4e5f6a7-8901-4cde-a123-456789012345";
const ERROR_LOG_ID = "e5f6a7b8-9012-4def-8234-567890123456";

const statsStub = {
  users: { total: 10, admins: 1, verified: 8, newLast7Days: 3 },
  sessions: { active: 5 },
  errors: { open: 2 },
  generatedAt: new Date("2026-05-06T00:00:00.000Z"),
};

const errorLogStub = {
  id: ERROR_LOG_ID,
  title: "Test Error",
  message: "Something went wrong",
  stack: null,
  source: null,
  userAgent: null,
  status: "OPEN" as const,
  resolutionNote: null,
  context: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  resolvedAt: null,
  user: { id: USER_ID, name: "Test User", role: "USER" as const },
  resolvedByAdmin: null,
};

const userListStub = [
  {
    id: USER_ID,
    name: "Test User",
    role: "USER" as const,
    isVerified: true,
    created_at: new Date(),
    updated_at: new Date(),
    authMethods: [],
  },
];

beforeAll(async () => {
  ({ app } = await import("../../src/app.js"));
  authService = await import("../../src/modules/auth/service.js");
  adminService = await import("../../src/modules/admin/service.js");
  ({ generateAccessToken } =
    await import("../../src/modules/auth/controller.js"));
});

describe("Admin RBAC Integration", () => {
  let userToken: string;
  let adminToken: string;

  beforeEach(() => {
    jest.resetAllMocks();

    // USER session mock (will be overridden per test when needed)
    jest.mocked(authService.findSessionById).mockImplementation((sessionId) => {
      if (sessionId === SESSION_ID) {
        return Promise.resolve({
          sessionId: SESSION_ID,
          userId: USER_ID,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        });
      }
      if (sessionId === ADMIN_SESSION_ID) {
        return Promise.resolve({
          sessionId: ADMIN_SESSION_ID,
          userId: ADMIN_ID,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        });
      }
      return Promise.resolve(null);
    });

    userToken = generateAccessToken({
      id: USER_ID,
      email: "user@test.dev",
      telegram_id: null,
      role: "USER",
      isVerified: true,
      sessionId: SESSION_ID,
    });

    adminToken = generateAccessToken({
      id: ADMIN_ID,
      email: "admin@test.dev",
      telegram_id: null,
      role: "ADMIN",
      isVerified: true,
      sessionId: ADMIN_SESSION_ID,
    });
  });

  describe("GET /api/admin/stats", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app).get("/api/admin/stats");
      expect(res.status).toBe(401);
    });

    it("returns 403 for USER role", async () => {
      const res = await request(app)
        .get("/api/admin/stats")
        .set("Cookie", [`fintrack_access_token=${userToken}`]);
      expect(res.status).toBe(403);
    });

    it("returns 200 for ADMIN role", async () => {
      jest.mocked(adminService.getAdminStats).mockResolvedValue(statsStub);
      const res = await request(app)
        .get("/api/admin/stats")
        .set("Cookie", [`fintrack_access_token=${adminToken}`]);
      expect(res.status).toBe(200);
      expect(res.body.users).toBeDefined();
    });
  });

  describe("GET /api/admin/users", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app).get("/api/admin/users");
      expect(res.status).toBe(401);
    });

    it("returns 403 for USER role", async () => {
      const res = await request(app)
        .get("/api/admin/users")
        .set("Cookie", [`fintrack_access_token=${userToken}`]);
      expect(res.status).toBe(403);
    });

    it("returns 200 with user list for ADMIN role", async () => {
      jest.mocked(adminService.listUsers).mockResolvedValue(userListStub);
      const res = await request(app)
        .get("/api/admin/users")
        .set("Cookie", [`fintrack_access_token=${adminToken}`]);
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/admin/error-logs", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app).get("/api/admin/error-logs");
      expect(res.status).toBe(401);
    });

    it("returns 403 for USER role", async () => {
      const res = await request(app)
        .get("/api/admin/error-logs")
        .set("Cookie", [`fintrack_access_token=${userToken}`]);
      expect(res.status).toBe(403);
    });

    it("returns 200 for ADMIN role", async () => {
      jest.mocked(adminService.listErrorLogs).mockResolvedValue([errorLogStub]);
      const res = await request(app)
        .get("/api/admin/error-logs")
        .set("Cookie", [`fintrack_access_token=${adminToken}`]);
      expect(res.status).toBe(200);
    });

    it("filters by status=OPEN for ADMIN role", async () => {
      jest.mocked(adminService.listErrorLogs).mockResolvedValue([errorLogStub]);
      const res = await request(app)
        .get("/api/admin/error-logs?status=OPEN")
        .set("Cookie", [`fintrack_access_token=${adminToken}`]);
      expect(res.status).toBe(200);
      expect(jest.mocked(adminService.listErrorLogs)).toHaveBeenCalledWith(
        expect.objectContaining({ status: "OPEN" }),
      );
    });

    it("supports pagination for ADMIN role", async () => {
      jest.mocked(adminService.listErrorLogs).mockResolvedValue([]);
      const res = await request(app)
        .get("/api/admin/error-logs?limit=5&offset=10")
        .set("Cookie", [`fintrack_access_token=${adminToken}`]);
      expect(res.status).toBe(200);
      expect(jest.mocked(adminService.listErrorLogs)).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 5, offset: 10 }),
      );
    });
  });

  describe("POST /api/admin/sessions/revoke-user/:userId", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app).post(
        `/api/admin/sessions/revoke-user/${TARGET_USER_ID}`,
      );
      expect(res.status).toBe(401);
    });

    it("returns 403 for USER role", async () => {
      const res = await request(app)
        .post(`/api/admin/sessions/revoke-user/${TARGET_USER_ID}`)
        .set("Cookie", [`fintrack_access_token=${userToken}`]);
      expect(res.status).toBe(403);
    });

    it("returns 200 for ADMIN role", async () => {
      jest
        .mocked(adminService.revokeUserSessions)
        .mockResolvedValue({ revokedCount: 0 });
      const res = await request(app)
        .post(`/api/admin/sessions/revoke-user/${TARGET_USER_ID}`)
        .set("Cookie", [`fintrack_access_token=${adminToken}`]);
      expect(res.status).toBe(200);
    });

    it("idempotent: revoking already-revoked user is safe", async () => {
      jest
        .mocked(adminService.revokeUserSessions)
        .mockResolvedValue({ revokedCount: 0 });

      const res1 = await request(app)
        .post(`/api/admin/sessions/revoke-user/${TARGET_USER_ID}`)
        .set("Cookie", [`fintrack_access_token=${adminToken}`]);
      const res2 = await request(app)
        .post(`/api/admin/sessions/revoke-user/${TARGET_USER_ID}`)
        .set("Cookie", [`fintrack_access_token=${adminToken}`]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    });
  });

  describe("POST /api/admin/sessions/revoke-all", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app).post("/api/admin/sessions/revoke-all");
      expect(res.status).toBe(401);
    });

    it("returns 403 for USER role", async () => {
      const res = await request(app)
        .post("/api/admin/sessions/revoke-all")
        .set("Cookie", [`fintrack_access_token=${userToken}`]);
      expect(res.status).toBe(403);
    });

    it("returns 200 for ADMIN role", async () => {
      jest
        .mocked(adminService.revokeAllSessions)
        .mockResolvedValue({ revokedCount: 0 });
      const res = await request(app)
        .post("/api/admin/sessions/revoke-all")
        .set("Cookie", [`fintrack_access_token=${adminToken}`]);
      expect(res.status).toBe(200);
    });
  });

  describe("PATCH /api/admin/users/:userId/role", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${TARGET_USER_ID}/role`)
        .send({ role: "ADMIN" });
      expect(res.status).toBe(401);
    });

    it("returns 403 for USER role", async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${TARGET_USER_ID}/role`)
        .set("Cookie", [`fintrack_access_token=${userToken}`])
        .send({ role: "ADMIN" });
      expect(res.status).toBe(403);
    });

    it("returns 200 for ADMIN promoting user", async () => {
      jest.mocked(adminService.updateUserRole).mockResolvedValue({
        id: TARGET_USER_ID,
        name: "Test User",
        role: "ADMIN",
        isVerified: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
      const res = await request(app)
        .patch(`/api/admin/users/${TARGET_USER_ID}/role`)
        .set("Cookie", [`fintrack_access_token=${adminToken}`])
        .send({ role: "ADMIN" });
      expect(res.status).toBe(200);
    });

    it("returns 400 for invalid role value", async () => {
      const res = await request(app)
        .patch(`/api/admin/users/${TARGET_USER_ID}/role`)
        .set("Cookie", [`fintrack_access_token=${adminToken}`])
        .send({ role: "SUPERUSER" });
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid userId param", async () => {
      const res = await request(app)
        .patch("/api/admin/users/not-a-uuid/role")
        .set("Cookie", [`fintrack_access_token=${adminToken}`])
        .send({ role: "ADMIN" });
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/admin/error-logs/:errorLogId/resolve", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app)
        .patch(`/api/admin/error-logs/${ERROR_LOG_ID}/resolve`)
        .send({ resolved: true });
      expect(res.status).toBe(401);
    });

    it("returns 403 for USER role", async () => {
      const res = await request(app)
        .patch(`/api/admin/error-logs/${ERROR_LOG_ID}/resolve`)
        .set("Cookie", [`fintrack_access_token=${userToken}`])
        .send({ resolved: true });
      expect(res.status).toBe(403);
    });

    it("resolves error log for ADMIN role", async () => {
      jest.mocked(adminService.resolveErrorLog).mockResolvedValue({
        id: ERROR_LOG_ID,
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolutionNote: "Fixed",
        resolvedByAdminId: ADMIN_ID,
        updatedAt: new Date(),
      });
      const res = await request(app)
        .patch(`/api/admin/error-logs/${ERROR_LOG_ID}/resolve`)
        .set("Cookie", [`fintrack_access_token=${adminToken}`])
        .send({ resolved: true, resolutionNote: "Fixed" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("RESOLVED");
    });

    it("reopens error log (resolved: false)", async () => {
      jest.mocked(adminService.resolveErrorLog).mockResolvedValue({
        id: ERROR_LOG_ID,
        status: "OPEN",
        resolvedAt: null,
        resolutionNote: null,
        resolvedByAdminId: null,
        updatedAt: new Date(),
      });
      const res = await request(app)
        .patch(`/api/admin/error-logs/${ERROR_LOG_ID}/resolve`)
        .set("Cookie", [`fintrack_access_token=${adminToken}`])
        .send({ resolved: false });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("OPEN");
    });

    it("returns 400 for missing resolved field", async () => {
      const res = await request(app)
        .patch(`/api/admin/error-logs/${ERROR_LOG_ID}/resolve`)
        .set("Cookie", [`fintrack_access_token=${adminToken}`])
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/admin/error-logs/report", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app)
        .post("/api/admin/error-logs/report")
        .send({ title: "Error", message: "Something broke" });
      expect(res.status).toBe(401);
    });

    it("returns 201 for USER role (no ADMIN required)", async () => {
      jest.mocked(adminService.reportErrorLog).mockResolvedValue({
        id: ERROR_LOG_ID,
        title: "Error",
        status: "OPEN",
        createdAt: new Date(),
      });
      const res = await request(app)
        .post("/api/admin/error-logs/report")
        .set("Cookie", [`fintrack_access_token=${userToken}`])
        .send({ title: "Error", message: "Something broke" });
      expect(res.status).toBe(201);
    });

    it("returns 201 for ADMIN role as well", async () => {
      jest.mocked(adminService.reportErrorLog).mockResolvedValue({
        id: ERROR_LOG_ID,
        title: "Admin Error",
        status: "OPEN",
        createdAt: new Date(),
      });
      const res = await request(app)
        .post("/api/admin/error-logs/report")
        .set("Cookie", [`fintrack_access_token=${adminToken}`])
        .send({ title: "Admin Error", message: "Something broke" });
      expect(res.status).toBe(201);
    });

    it("returns 400 for missing required fields", async () => {
      const res = await request(app)
        .post("/api/admin/error-logs/report")
        .set("Cookie", [`fintrack_access_token=${userToken}`])
        .send({});
      expect(res.status).toBe(400);
    });
  });
});
