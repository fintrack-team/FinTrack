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
const OTHER_USER_ID = "f0e1d2c3-b4a5-6789-9123-456789abcdef";
const SESSION_ID = "c3d4e5f6-7890-4bcd-8f12-345678901234";
const TX_ID = "e5f6a7b8-9012-4def-8234-567890123456";

const txStub = {
  id: TX_ID,
  userId: USER_ID,
  title: "Coffee",
  type: "EXPENSE" as const,
  amount: new Prisma.Decimal(50),
  currencyCode: "USD" as const,
  source: "MANUAL" as const,
  category: null,
  sourceTransactionId: null,
  sourceAccountId: null,
  importedAt: null,
  created_at: new Date("2025-01-15T10:00:00Z"),
  updated_at: new Date("2025-01-15T10:00:00Z"),
  location: null,
};

const monobankTxStub = { ...txStub, source: "MONOBANK" as const };

beforeAll(async () => {
  ({ app } = await import("../../src/app.js"));
  authService = await import("../../src/modules/auth/service.js");
  transactionService = await import("../../src/modules/transaction/service.js");
  ({ generateAccessToken } =
    await import("../../src/modules/auth/controller.js"));
});

describe("Transaction Integration", () => {
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

  describe("GET /api/transactions", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app).get("/api/transactions");
      expect(res.status).toBe(401);
    });

    it("returns all transactions", async () => {
      jest.mocked(transactionService.getAllTransactions).mockResolvedValue({
        data: [txStub],
      });
      const res = await request(app)
        .get("/api/transactions")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(TX_ID);
    });

    it("returns empty list when no transactions", async () => {
      jest
        .mocked(transactionService.getAllTransactions)
        .mockResolvedValue({ data: [] });
      const res = await request(app)
        .get("/api/transactions")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it("filters by source=MANUAL", async () => {
      jest
        .mocked(transactionService.getAllTransactions)
        .mockResolvedValue({ data: [txStub] });
      const res = await request(app)
        .get("/api/transactions?source=MANUAL")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(200);
      expect(
        jest.mocked(transactionService.getAllTransactions),
      ).toHaveBeenCalledWith(USER_ID, "MANUAL");
    });

    it("filters by source=MONOBANK", async () => {
      jest
        .mocked(transactionService.getAllTransactions)
        .mockResolvedValue({ data: [monobankTxStub] });
      const res = await request(app)
        .get("/api/transactions?source=MONOBANK")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(200);
      expect(
        jest.mocked(transactionService.getAllTransactions),
      ).toHaveBeenCalledWith(USER_ID, "MONOBANK");
    });

    it("returns 400 for invalid source", async () => {
      const res = await request(app)
        .get("/api/transactions?source=INVALID")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/transactions (paginated)", () => {
    it("returns paginated results", async () => {
      jest.mocked(transactionService.getTransactionsPerPage).mockResolvedValue({
        data: [txStub],
        pagination: { page: 1, perPage: 10, total: 1, totalPages: 1 },
      });
      const res = await request(app)
        .get("/api/transactions?page=1&perPage=10")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(200);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.total).toBe(1);
    });

    it("returns second page correctly", async () => {
      jest.mocked(transactionService.getTransactionsPerPage).mockResolvedValue({
        data: [],
        pagination: { page: 2, perPage: 10, total: 5, totalPages: 1 },
      });
      const res = await request(app)
        .get("/api/transactions?page=2&perPage=10")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(200);
      expect(
        jest.mocked(transactionService.getTransactionsPerPage),
      ).toHaveBeenCalledWith(USER_ID, 2, 10, undefined);
    });

    it("returns 400 for non-numeric page", async () => {
      const res = await request(app)
        .get("/api/transactions?page=abc&perPage=10")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(400);
    });

    it("returns 400 for page < 1", async () => {
      const res = await request(app)
        .get("/api/transactions?page=0&perPage=10")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(400);
    });

    it("returns 400 for perPage < 1", async () => {
      const res = await request(app)
        .get("/api/transactions?page=1&perPage=0")
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/transactions/:id", () => {
    it("returns transaction by id", async () => {
      jest.mocked(transactionService.getTransaction).mockResolvedValue(txStub);
      const res = await request(app)
        .get(`/api/transactions/${TX_ID}`)
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(TX_ID);
    });

    it("returns 404 when transaction not found", async () => {
      jest.mocked(transactionService.getTransaction).mockResolvedValue(null);
      const res = await request(app)
        .get(`/api/transactions/${TX_ID}`)
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(404);
    });

    it("returns 404 for another user's transaction (IDOR)", async () => {
      // Service returns null because userId filter excludes other user's tx
      jest.mocked(transactionService.getTransaction).mockResolvedValue(null);
      const res = await request(app)
        .get(`/api/transactions/${TX_ID}`)
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(404);
      expect(
        jest.mocked(transactionService.getTransaction),
      ).toHaveBeenCalledWith(TX_ID, USER_ID);
    });

    it("returns 401 without auth", async () => {
      const res = await request(app).get(`/api/transactions/${TX_ID}`);
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/transactions", () => {
    const validBody = {
      title: "Coffee",
      type: "EXPENSE",
      amount: 50,
      currencyCode: "USD",
      created_at: "2025-01-15T10:00:00.000Z",
    };

    it("creates transaction and returns 201", async () => {
      jest
        .mocked(transactionService.createTransaction)
        .mockResolvedValue(txStub);
      const res = await request(app)
        .post("/api/transactions")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send(validBody);
      expect(res.status).toBe(201);
      expect(res.body.id).toBe(TX_ID);
    });

    it("returns 400 for missing required fields", async () => {
      const res = await request(app)
        .post("/api/transactions")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ title: "Coffee" });
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid transaction type", async () => {
      const res = await request(app)
        .post("/api/transactions")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ ...validBody, type: "INVALID_TYPE" });
      expect(res.status).toBe(400);
    });

    it("returns 400 for negative amount", async () => {
      const res = await request(app)
        .post("/api/transactions")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ ...validBody, amount: -10 });
      expect(res.status).toBe(400);
    });

    it("returns 400 for empty title", async () => {
      const res = await request(app)
        .post("/api/transactions")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ ...validBody, title: "" });
      expect(res.status).toBe(400);
    });

    it("returns 401 without auth", async () => {
      const res = await request(app).post("/api/transactions").send(validBody);
      expect(res.status).toBe(401);
    });
  });

  describe("PATCH /api/transactions/:id", () => {
    it("updates transaction and returns 200", async () => {
      jest.mocked(transactionService.getTransaction).mockResolvedValue(txStub);
      jest.mocked(transactionService.updateTransaction).mockResolvedValue({
        ...txStub,
        title: "Tea",
      });
      const res = await request(app)
        .patch(`/api/transactions/${TX_ID}`)
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ title: "Tea" });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Tea");
    });

    it("returns 404 when transaction not found", async () => {
      jest.mocked(transactionService.getTransaction).mockResolvedValue(null);
      const res = await request(app)
        .patch(`/api/transactions/${TX_ID}`)
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ title: "Tea" });
      expect(res.status).toBe(404);
    });

    it("returns 403 for MONOBANK transaction (read-only)", async () => {
      jest
        .mocked(transactionService.getTransaction)
        .mockResolvedValue(monobankTxStub);
      const res = await request(app)
        .patch(`/api/transactions/${TX_ID}`)
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ title: "Tea" });
      expect(res.status).toBe(403);
    });

    it("returns 404 for another user's transaction (IDOR)", async () => {
      jest.mocked(transactionService.getTransaction).mockResolvedValue(null);
      const attackerToken = generateAccessToken({
        id: OTHER_USER_ID,
        email: "attacker@test.dev",
        telegram_id: null,
        role: "USER",
        isVerified: true,
        sessionId: SESSION_ID,
      });
      jest.mocked(authService.findSessionById).mockResolvedValue({
        sessionId: SESSION_ID,
        userId: OTHER_USER_ID,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const res = await request(app)
        .patch(`/api/transactions/${TX_ID}`)
        .set("Cookie", [`fintrack_access_token=${attackerToken}`])
        .send({ title: "Hack" });
      expect(res.status).toBe(404);
    });

    it("returns 401 without auth", async () => {
      const res = await request(app)
        .patch(`/api/transactions/${TX_ID}`)
        .send({ title: "Tea" });
      expect(res.status).toBe(401);
    });
  });

  describe("DELETE /api/transactions/:id", () => {
    it("deletes transaction and returns 204", async () => {
      jest.mocked(transactionService.getTransaction).mockResolvedValue(txStub);
      jest
        .mocked(transactionService.deleteTransaction)
        .mockResolvedValue(txStub);
      const res = await request(app)
        .delete(`/api/transactions/${TX_ID}`)
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(204);
    });

    it("returns 404 when transaction not found", async () => {
      jest.mocked(transactionService.getTransaction).mockResolvedValue(null);
      const res = await request(app)
        .delete(`/api/transactions/${TX_ID}`)
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(404);
    });

    it("returns 403 for MONOBANK transaction (read-only)", async () => {
      jest
        .mocked(transactionService.getTransaction)
        .mockResolvedValue(monobankTxStub);
      const res = await request(app)
        .delete(`/api/transactions/${TX_ID}`)
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(403);
    });

    it("returns 404 for another user's transaction (IDOR)", async () => {
      jest.mocked(transactionService.getTransaction).mockResolvedValue(null);
      const res = await request(app)
        .delete(`/api/transactions/${TX_ID}`)
        .set("Cookie", [`fintrack_access_token=${token}`]);
      expect(res.status).toBe(404);
      expect(
        jest.mocked(transactionService.getTransaction),
      ).toHaveBeenCalledWith(TX_ID, USER_ID);
    });

    it("returns 401 without auth", async () => {
      const res = await request(app).delete(`/api/transactions/${TX_ID}`);
      expect(res.status).toBe(401);
    });
  });
});
