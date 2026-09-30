import { vi } from "vitest";
import request from "supertest";
import { Prisma } from "@prisma/client";

import type { app as AppType } from "../../src/app.js";
import type * as AuthServiceTypes from "../../src/modules/auth/service.js";
import type * as TransactionServiceTypes from "../../src/modules/transaction/service.js";

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

const transactionServiceModuleMock = {
  getAllTransactions: vi.fn(),
  getTransactionsPerPage: vi.fn(),
  getTransaction: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  importMonobankTransactions: vi.fn(),
  deleteAllMonobankTransactions: vi.fn(),
};
vi.mock(
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

const now = new Date("2025-06-01T12:00:00Z");

const incomeTx = {
  id: "tx-income-1",
  title: "Salary",
  type: "INCOME" as const,
  amount: new Prisma.Decimal(1000),
  currencyCode: "USD" as const,
  source: "MANUAL" as const,
  category: null,
  sourceTransactionId: null,
  sourceAccountId: null,
  importedAt: null,
  created_at: now,
  updated_at: now,
  location: null,
};

const outcomeTx = {
  id: "tx-outcome-1",
  title: "Coffee",
  type: "EXPENSE" as const,
  amount: new Prisma.Decimal(50),
  currencyCode: "USD" as const,
  source: "MANUAL" as const,
  category: null,
  sourceTransactionId: null,
  sourceAccountId: null,
  importedAt: null,
  created_at: now,
  updated_at: now,
  location: null,
};

beforeAll(async () => {
  ({ app } = await import("../../src/app.js"));
  authService = await import("../../src/modules/auth/service.js");
  transactionService = await import("../../src/modules/transaction/service.js");
  ({ generateAccessToken } =
    await import("../../src/modules/auth/controller.js"));
});

describe("Summary Integration", () => {
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

  describe("GET /api/summary", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app).get("/api/summary");
      expect(res.status).toBe(401);
    });

    it("returns 200 with summary for transactions", async () => {
      vi.mocked(transactionService.getAllTransactions).mockResolvedValue({
        data: [incomeTx, outcomeTx],
      });
      const res = await request(app)
        .get("/api/summary")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("currentBalance");
    });

    it("returns 200 with empty summary when no transactions", async () => {
      vi.mocked(transactionService.getAllTransactions).mockResolvedValue({
        data: [],
      });
      const res = await request(app)
        .get("/api/summary")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(200);
      expect(res.body.currentBalance).toBe(0);
    });

    it("filters by source=MANUAL", async () => {
      vi.mocked(transactionService.getAllTransactions).mockResolvedValue({
        data: [outcomeTx],
      });
      const res = await request(app)
        .get("/api/summary?source=MANUAL")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(200);
      expect(
        vi.mocked(transactionService.getAllTransactions),
      ).toHaveBeenCalledWith(USER_ID, "MANUAL");
    });

    it("filters by source=MONOBANK", async () => {
      vi.mocked(transactionService.getAllTransactions).mockResolvedValue({
        data: [],
      });
      const res = await request(app)
        .get("/api/summary?source=MONOBANK")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(200);
      expect(
        vi.mocked(transactionService.getAllTransactions),
      ).toHaveBeenCalledWith(USER_ID, "MONOBANK");
    });

    it("returns 400 for invalid source", async () => {
      const res = await request(app)
        .get("/api/summary?source=INVALID")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(400);
    });

    it("balance = income - outcome", async () => {
      vi.mocked(transactionService.getAllTransactions).mockResolvedValue({
        data: [incomeTx, outcomeTx],
      });
      const res = await request(app)
        .get("/api/summary")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(200);
      expect(res.body.currentBalance).toBe(950);
    });

    it("balance is 0 when income equals outcome", async () => {
      const equalOutcome = { ...outcomeTx, amount: new Prisma.Decimal(1000) };
      vi.mocked(transactionService.getAllTransactions).mockResolvedValue({
        data: [incomeTx, equalOutcome],
      });
      const res = await request(app)
        .get("/api/summary")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(200);
      expect(res.body.currentBalance).toBe(0);
    });

    it("consistent with transaction data after create", async () => {
      vi.mocked(transactionService.getAllTransactions)
        .mockResolvedValueOnce({ data: [incomeTx] })
        .mockResolvedValueOnce({ data: [incomeTx, outcomeTx] });

      const res1 = await request(app)
        .get("/api/summary")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      const res2 = await request(app)
        .get("/api/summary")
        .set("Cookie", [`fintrack_access_token=${token}`]);

      expect(res1.body.currentBalance).toBe(1000);
      expect(res2.body.currentBalance).toBe(950);
    });
  });

  describe("GET /api/summary/chart", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app).get("/api/summary/chart?range=week");
      expect(res.status).toBe(401);
    });

    it("returns chart data for range=day", async () => {
      vi.mocked(transactionService.getAllTransactions).mockResolvedValue({
        data: [incomeTx, outcomeTx],
      });
      const res = await request(app)
        .get("/api/summary/chart?range=day")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("income");
      expect(res.body).toHaveProperty("outcome");
    });

    it("returns chart data for range=week", async () => {
      vi.mocked(transactionService.getAllTransactions).mockResolvedValue({
        data: [incomeTx],
      });
      const res = await request(app)
        .get("/api/summary/chart?range=week")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(200);
    });

    it("returns chart data for range=month", async () => {
      vi.mocked(transactionService.getAllTransactions).mockResolvedValue({
        data: [outcomeTx],
      });
      const res = await request(app)
        .get("/api/summary/chart?range=month")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(200);
    });

    it("returns chart data for range=all", async () => {
      vi.mocked(transactionService.getAllTransactions).mockResolvedValue({
        data: [],
      });
      const res = await request(app)
        .get("/api/summary/chart?range=all")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(200);
    });

    it("returns 400 for invalid range", async () => {
      const res = await request(app)
        .get("/api/summary/chart?range=quarterly")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(400);
    });

    it("returns 400 when range is missing", async () => {
      const res = await request(app)
        .get("/api/summary/chart")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(400);
    });

    it("returns empty arrays for zero transactions", async () => {
      vi.mocked(transactionService.getAllTransactions).mockResolvedValue({
        data: [],
      });
      const res = await request(app)
        .get("/api/summary/chart?range=week")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.income)).toBe(true);
      expect(Array.isArray(res.body.outcome)).toBe(true);
    });
  });
});
