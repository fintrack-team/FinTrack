import { jest } from "@jest/globals";
import request from "supertest";
import { Prisma } from "@prisma/client";

import type { app as AppType } from "../../src/app.js";
import type * as AuthServiceTypes from "../../src/modules/auth/service.js";
import type * as TransactionServiceTypes from "../../src/modules/transaction/service.js";

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
};
jest.unstable_mockModule(
  "../../src/modules/auth/service.js",
  () => authServiceModuleMock,
);

const transactionServiceModuleMock = {
  getAllTransactions: jest.fn(),
  getTransactionsPerPage: jest.fn(),
  getTransaction: jest.fn(),
  createTransaction: jest.fn(),
  updateTransaction: jest.fn(),
  deleteTransaction: jest.fn(),
  importMonobankTransactions: jest.fn(),
  deleteAllMonobankTransactions: jest.fn(),
};
jest.unstable_mockModule(
  "../../src/modules/transaction/service.js",
  () => transactionServiceModuleMock,
);

let app: typeof AppType;
let authService: typeof AuthServiceTypes;
let transactionService: typeof TransactionServiceTypes;
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

const P95_BUDGET_MS = 200;
const CONCURRENCY_COUNT = 10;

beforeAll(async () => {
  ({ app } = await import("../../src/app.js"));
  authService = await import("../../src/modules/auth/service.js");
  transactionService = await import("../../src/modules/transaction/service.js");
  ({ generateAccessToken } =
    await import("../../src/modules/auth/controller.js"));
});

describe("Performance Smoke Tests", () => {
  let token: string;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(authService.findSessionById).mockResolvedValue({
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

  describe(`p95 response time ≤ ${P95_BUDGET_MS}ms for critical endpoints`, () => {
    const SAMPLE_SIZE = 20;

    async function measureLatencies(
      fn: () => Promise<request.Response>,
    ): Promise<number[]> {
      const latencies: number[] = [];
      for (let i = 0; i < SAMPLE_SIZE; i++) {
        const start = Date.now();
        await fn();
        latencies.push(Date.now() - start);
      }
      latencies.sort((a, b) => a - b);
      return latencies;
    }

    function p95(latencies: number[]): number {
      const idx = Math.ceil(latencies.length * 0.95) - 1;
      return latencies[idx] ?? latencies[latencies.length - 1] ?? 0;
    }

    it("GET /api/transactions p95 within budget", async () => {
      jest
        .mocked(transactionService.getAllTransactions)
        .mockResolvedValue({ data: [] });

      const latencies = await measureLatencies(() =>
        request(app)
          .get("/api/transactions")
          .set("Cookie", [`fintrack_access_token=${token}`]),
      );

      const p95ms = p95(latencies);
      expect(p95ms).toBeLessThanOrEqual(P95_BUDGET_MS);
    });

    it("GET /api/summary p95 within budget", async () => {
      jest
        .mocked(transactionService.getAllTransactions)
        .mockResolvedValue({ data: [] });

      const latencies = await measureLatencies(() =>
        request(app)
          .get("/api/summary")
          .set("Cookie", [`fintrack_access_token=${token}`]),
      );

      const p95ms = p95(latencies);
      expect(p95ms).toBeLessThanOrEqual(P95_BUDGET_MS);
    });

    it("GET /api/health p95 within budget", async () => {
      const latencies = await measureLatencies(() =>
        request(app).get("/api/health"),
      );

      const p95ms = p95(latencies);
      expect(p95ms).toBeLessThanOrEqual(P95_BUDGET_MS);
    });
  });

  describe(`Concurrency: ${CONCURRENCY_COUNT} simultaneous requests`, () => {
    it("handles concurrent GET /api/transactions without errors", async () => {
      jest
        .mocked(transactionService.getAllTransactions)
        .mockResolvedValue({ data: [] });

      const responses = await Promise.all(
        Array.from({ length: CONCURRENCY_COUNT }, () =>
          request(app)
            .get("/api/transactions")
            .set("Cookie", [`fintrack_access_token=${token}`]),
        ),
      );

      expect(responses.every((r) => r.status === 200)).toBe(true);
    });

    it("handles concurrent POST /api/transactions without race conditions", async () => {
      jest.mocked(transactionService.createTransaction).mockResolvedValue({
        id: "tx-concurrent",
        title: "Test",
        type: "EXPENSE" as const,
        amount: new Prisma.Decimal(10),
        currencyCode: "USD" as const,
        source: "MANUAL" as const,
        sourceTransactionId: null,
        sourceAccountId: null,
        importedAt: null,
        created_at: new Date(),
        updated_at: new Date(),
        location: null,
      });

      const payload = {
        title: "Concurrent Tx",
        type: "EXPENSE",
        amount: 10,
        currencyCode: "USD",
        created_at: new Date().toISOString(),
      };

      const responses = await Promise.all(
        Array.from({ length: CONCURRENCY_COUNT }, () =>
          request(app)
            .post("/api/transactions")
            .set("Cookie", [`fintrack_access_token=${token}`])
            .send(payload),
        ),
      );

      expect(responses.every((r) => r.status === 201)).toBe(true);
    });

    it("concurrent auth refresh rotation does not error", async () => {
      jest.mocked(authService.findSessionByTokenHash).mockResolvedValue(null);

      const responses = await Promise.all(
        Array.from({ length: CONCURRENCY_COUNT }, () =>
          request(app)
            .post("/api/auth/token")
            .send({ token: `refresh_token_${Math.random()}` }),
        ),
      );

      // Each should be 401 (not found) — no 500 errors
      expect(responses.every((r) => r.status === 401)).toBe(true);
    });
  });

  describe("Basic security regression", () => {
    it("unauthenticated cannot access /api/transactions (authz)", async () => {
      const res = await request(app).get("/api/transactions");
      expect(res.status).toBe(401);
    });

    it("unauthenticated cannot access /api/summary (authz)", async () => {
      const res = await request(app).get("/api/summary");
      expect(res.status).toBe(401);
    });

    it("IDOR: service called with correct userId scope", async () => {
      jest.mocked(transactionService.getTransaction).mockResolvedValue(null);

      const attackerToken = generateAccessToken({
        id: "11111111-1111-4111-8111-111111111111",
        email: "evil@test.dev",
        telegram_id: null,
        role: "USER",
        isVerified: true,
        sessionId: SESSION_ID,
      });

      jest.mocked(authService.findSessionById).mockResolvedValue({
        sessionId: SESSION_ID,
        userId: "11111111-1111-4111-8111-111111111111",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      const res = await request(app)
        .get("/api/transactions/22222222-2222-4222-8222-222222222222")
        .set("Cookie", [`fintrack_access_token=${attackerToken}`]);

      expect(res.status).toBe(404);
      // Service must be called with attacker's userId, not victim's
      expect(
        jest.mocked(transactionService.getTransaction),
      ).toHaveBeenCalledWith(
        "22222222-2222-4222-8222-222222222222",
        "11111111-1111-4111-8111-111111111111",
      );
    });
  });
});
