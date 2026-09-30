import { jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import request from "supertest";

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

const SESSION_ID = "c3d4e5f6-7890-4bcd-8f12-345678901234";

const MONOBANK_ACCOUNTS = [
  {
    id: "acc_mono_1",
    type: "black",
    currencyCode: 980,
    cashbackType: "UAH",
    balance: 100000,
    creditLimit: 0,
    maskedPan: ["555555******5599"],
    iban: "UA123456789012345678901234567",
  },
];

const MONOBANK_STATEMENT = [
  {
    id: "stmt_1",
    time: Math.floor(Date.now() / 1000),
    description: "Coffee",
    mcc: 5812,
    amount: -5000,
    operationAmount: -5000,
    currencyCode: 980,
    commissionRate: 0,
    cashbackAmount: 0,
    balance: 95000,
    hold: false,
  },
];

function makeUserId() {
  return randomUUID();
}

function makeToken(userId: string) {
  return generateAccessToken({
    id: userId,
    email: "user@test.dev",
    telegram_id: null,
    role: "USER",
    isVerified: true,
    sessionId: SESSION_ID,
  });
}

beforeAll(async () => {
  ({ app } = await import("../../src/app.js"));
  authService = await import("../../src/modules/auth/service.js");
  transactionService = await import("../../src/modules/transaction/service.js");
  ({ generateAccessToken } =
    await import("../../src/modules/auth/controller.js"));
});

describe("Monobank Integration", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = jest.fn() as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockAuth(userId: string) {
    jest.mocked(authService.findSessionById).mockResolvedValue({
      sessionId: SESSION_ID,
      userId,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
  }

  function mockFetchSuccess(data: unknown) {
    jest.mocked(global.fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(data),
    } as Response);
  }

  function mockFetchError(status: number, message: string) {
    jest.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve({ errorDescription: message }),
      text: () => Promise.resolve(message),
    } as unknown as Response);
  }

  describe("POST /api/transactions/monobank/accounts", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app)
        .post("/api/transactions/monobank/accounts")
        .send({ token: "mono_token_1234567890abcd" });
      expect(res.status).toBe(401);
    });

    it("returns accounts list on success", async () => {
      const userId = makeUserId();
      mockAuth(userId);
      mockFetchSuccess({ accounts: MONOBANK_ACCOUNTS, clientId: "client_1" });
      const token = makeToken(userId);

      const res = await request(app)
        .post("/api/transactions/monobank/accounts")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ token: "mono_token_1234567890abcd" });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("accounts");
      expect(Array.isArray(res.body.accounts)).toBe(true);
    });

    it("returns 400 for missing token", async () => {
      const userId = makeUserId();
      mockAuth(userId);
      const token = makeToken(userId);

      const res = await request(app)
        .post("/api/transactions/monobank/accounts")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({});

      expect(res.status).toBe(400);
    });

    it("propagates monobank 429 rate-limit as error", async () => {
      const userId = makeUserId();
      mockAuth(userId);
      mockFetchError(429, "Too many requests");
      const token = makeToken(userId);

      const res = await request(app)
        .post("/api/transactions/monobank/accounts")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ token: "mono_token_1234567890abcd" });

      expect(res.status).toBe(429);
    });

    it("propagates monobank 403 unauthorized token as error", async () => {
      const userId = makeUserId();
      mockAuth(userId);
      mockFetchError(403, "Forbidden");
      const token = makeToken(userId);

      const res = await request(app)
        .post("/api/transactions/monobank/accounts")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ token: "invalid_mono_token_1234567890" });

      // Controller maps monobank 401/403 → AppError(401) "Invalid Monobank token"
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/transactions/monobank/fetch", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app)
        .post("/api/transactions/monobank/fetch")
        .send({ token: "mono_token_1234567890abcd", accountId: "acc_1" });
      expect(res.status).toBe(401);
    });

    it("fetches statement preview from monobank", async () => {
      const userId = makeUserId();
      mockAuth(userId);
      const token = makeToken(userId);
      mockFetchSuccess(MONOBANK_STATEMENT);

      const fromDate = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
      const toDate = Math.floor(Date.now() / 1000);

      const res = await request(app)
        .post("/api/transactions/monobank/fetch")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({
          token: "mono_token_1234567890abcd",
          accountId: "acc_mono_1",
          accountCurrencyCode: 980,
          from: fromDate,
          to: toDate,
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("transactions");
    });

    it("returns 400 for missing required fields", async () => {
      const userId = makeUserId();
      mockAuth(userId);
      const token = makeToken(userId);

      const res = await request(app)
        .post("/api/transactions/monobank/fetch")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({});

      expect(res.status).toBe(400);
    });

    it("handles monobank timeout / 5xx error", async () => {
      const userId = makeUserId();
      mockAuth(userId);
      mockFetchError(500, "Internal Server Error");
      const token = makeToken(userId);

      const fromDate = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
      const toDate = Math.floor(Date.now() / 1000);

      const res = await request(app)
        .post("/api/transactions/monobank/fetch")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({
          token: "mono_token_1234567890abcd",
          accountId: "acc_mono_1",
          accountCurrencyCode: 980,
          from: fromDate,
          to: toDate,
        });

      // Controller passes monobank status through → AppError(500)
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/transactions/monobank/import", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app)
        .post("/api/transactions/monobank/import")
        .send({ transactions: [] });
      expect(res.status).toBe(401);
    });

    it("imports transactions and returns 200", async () => {
      const userId = makeUserId();
      mockAuth(userId);
      const token = makeToken(userId);

      jest
        .mocked(transactionService.importMonobankTransactions)
        .mockResolvedValue({ imported: 1, skipped: 0, total: 1 });

      const res = await request(app)
        .post("/api/transactions/monobank/import")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({
          accountId: "acc_mono_1",
          accountCurrencyCode: "UAH",
          transactions: [
            {
              title: "Coffee",
              type: "EXPENSE",
              amount: 50,
              currencyCode: "UAH",
              created_at: new Date().toISOString(),
              sourceTransactionId: "mono_stmt_1",
              sourceAccountId: "acc_mono_1",
            },
          ],
        });

      expect(res.status).toBe(200);
    });

    it("idempotent: duplicate import returns skipped count", async () => {
      const userId = makeUserId();
      mockAuth(userId);
      const token = makeToken(userId);

      jest
        .mocked(transactionService.importMonobankTransactions)
        .mockResolvedValue({ imported: 0, skipped: 1, total: 1 });

      const res = await request(app)
        .post("/api/transactions/monobank/import")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({
          accountId: "acc_mono_1",
          accountCurrencyCode: "UAH",
          transactions: [
            {
              title: "Coffee",
              type: "EXPENSE",
              amount: 50,
              currencyCode: "UAH",
              created_at: new Date().toISOString(),
              sourceTransactionId: "mono_stmt_already_imported",
              sourceAccountId: "acc_mono_1",
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.skipped).toBeGreaterThanOrEqual(0);
    });

    it("returns 400 for empty transactions array without accountId", async () => {
      const userId = makeUserId();
      mockAuth(userId);
      const token = makeToken(userId);

      const res = await request(app)
        .post("/api/transactions/monobank/import")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/transactions/monobank", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app).delete("/api/transactions/monobank");
      expect(res.status).toBe(401);
    });

    it("deletes all monobank transactions", async () => {
      const userId = makeUserId();
      mockAuth(userId);
      const token = makeToken(userId);

      jest
        .mocked(transactionService.deleteAllMonobankTransactions)
        .mockResolvedValue({ deleted: 3, source: "MONOBANK" as const });

      const res = await request(app)
        .delete("/api/transactions/monobank")
        .set("Cookie", [`fintrack_access_token=${token}`]);

      expect(res.status).toBe(200);
      expect(
        jest.mocked(transactionService.deleteAllMonobankTransactions),
      ).toHaveBeenCalledWith(userId);
    });

    it("re-import after delete is fresh (no idempotency block)", async () => {
      const userId = makeUserId();
      mockAuth(userId);
      const token = makeToken(userId);

      jest
        .mocked(transactionService.deleteAllMonobankTransactions)
        .mockResolvedValue({ deleted: 2, source: "MONOBANK" as const });
      jest
        .mocked(transactionService.importMonobankTransactions)
        .mockResolvedValue({ imported: 2, skipped: 0, total: 2 });

      await request(app)
        .delete("/api/transactions/monobank")
        .set("Cookie", [`fintrack_access_token=${token}`]);

      const importRes = await request(app)
        .post("/api/transactions/monobank/import")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({
          accountId: "acc_mono_1",
          accountCurrencyCode: "UAH",
          transactions: [
            {
              title: "Coffee",
              type: "EXPENSE",
              amount: 50,
              currencyCode: "UAH",
              created_at: new Date().toISOString(),
              sourceTransactionId: "mono_stmt_1",
              sourceAccountId: "acc_mono_1",
            },
          ],
        });

      expect(importRes.status).toBe(200);
      expect(importRes.body.imported).toBe(2);
    });
  });
});
