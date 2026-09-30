import { vi } from "vitest";
import request from "supertest";
import { Prisma } from "@prisma/client";

import type { app as AppType } from "../../src/app.js";
import type * as AuthServiceTypes from "../../src/modules/auth/service.js";
import type * as TransactionServiceTypes from "../../src/modules/transaction/service.js";
import type * as DonationServiceTypes from "../../src/modules/donation/service.js";
import type * as AdminServiceTypes from "../../src/modules/admin/service.js";

const authServiceModuleMock = {
  findSessionById: vi.fn(),
  findSessionByTokenHash: vi.fn(),
  revokeSessionFamily: vi.fn(),
  revokeSession: vi.fn(),
  rotateSession: vi.fn(),
  createSession: vi.fn(),
  logoutByTokenHash: vi.fn(),
  revokeAllUserSessions: vi.fn(),
  loginWithGoogle: vi.fn(),
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

const donationServiceModuleMock = {
  createDonationCheckoutSession: vi.fn(),
  processStripeWebhook: vi.fn(),
  getDonationLeaderboard: vi.fn(),
};
vi.mock(
  "../../src/modules/donation/service.js",
  () => donationServiceModuleMock,
);

const adminServiceModuleMock = {
  getAdminStats: vi.fn(),
  reportErrorLog: vi.fn(),
  revokeUserSessions: vi.fn(),
  revokeAllSessions: vi.fn(),
  updateUserRole: vi.fn(),
  listUsers: vi.fn(),
  listErrorLogs: vi.fn(),
  resolveErrorLog: vi.fn(),
};
vi.mock("../../src/modules/admin/service.js", () => adminServiceModuleMock);

let app: typeof AppType;
let authService: typeof AuthServiceTypes;
let transactionService: typeof TransactionServiceTypes;
let donationService: typeof DonationServiceTypes;
let adminService: typeof AdminServiceTypes;
let generateAccessToken: (payload: {
  id: string;
  email: string | null;
  telegram_id: string | null;
  role: "USER" | "ADMIN";
  isVerified: boolean;
  sessionId: string;
}) => string;

const USER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const ADMIN_ID = "b2c3d4e5-f678-40ab-9def-123456789012";
const SESSION_ID = "c3d4e5f6-7890-4bcd-8f12-345678901234";
const ADMIN_SESSION_ID = "d4e5f6a7-8901-4cde-a123-456789012345";
const TX_ID = "e5f6a7b8-9012-4def-8234-567890123456";

const txStub = {
  id: TX_ID,
  title: "Salary",
  type: "INCOME" as const,
  amount: new Prisma.Decimal(1000),
  currencyCode: "USD" as const,
  source: "MANUAL" as const,
  sourceTransactionId: null,
  sourceAccountId: null,
  importedAt: null,
  created_at: new Date("2025-06-01T10:00:00Z"),
  updated_at: new Date("2025-06-01T10:00:00Z"),
  location: null,
};

beforeAll(async () => {
  ({ app } = await import("../../src/app.js"));
  authService = await import("../../src/modules/auth/service.js");
  transactionService = await import("../../src/modules/transaction/service.js");
  donationService = await import("../../src/modules/donation/service.js");
  adminService = await import("../../src/modules/admin/service.js");
  ({ generateAccessToken } =
    await import("../../src/modules/auth/controller.js"));
});

describe("User Flow Smoke Tests", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("User flow: login → create transaction → view summary", () => {
    it("authenticated user creates transaction and sees updated summary", async () => {
      const userToken = generateAccessToken({
        id: USER_ID,
        email: "user@test.dev",
        telegram_id: null,
        role: "USER",
        isVerified: true,
        sessionId: SESSION_ID,
      });

      vi.mocked(authService.findSessionById).mockResolvedValue({
        sessionId: SESSION_ID,
        userId: USER_ID,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      // Step 1: Create transaction
      vi.mocked(transactionService.createTransaction).mockResolvedValue(txStub);

      const createRes = await request(app)
        .post("/api/transactions")
        .set("Cookie", [`fintrack_access_token=${userToken}`])
        .send({
          title: "Salary",
          type: "INCOME",
          amount: 1000,
          currencyCode: "USD",
          created_at: "2025-06-01T10:00:00.000Z",
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.id).toBe(TX_ID);

      // Step 2: View summary reflects the new transaction
      vi.mocked(transactionService.getAllTransactions).mockResolvedValue({
        data: [txStub],
      });

      const summaryRes = await request(app)
        .get("/api/summary")
        .set("Cookie", [`fintrack_access_token=${userToken}`]);

      expect(summaryRes.status).toBe(200);
      expect(summaryRes.body.currentBalance).toBe(1000);
    });
  });

  describe("Admin flow: login → manage users → view stats", () => {
    it("admin can view stats and user list", async () => {
      vi.mocked(authService.findSessionById).mockImplementation((sessionId) => {
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

      const adminToken = generateAccessToken({
        id: ADMIN_ID,
        email: "admin@test.dev",
        telegram_id: null,
        role: "ADMIN",
        isVerified: true,
        sessionId: ADMIN_SESSION_ID,
      });

      // Step 1: Get stats
      vi.mocked(adminService.getAdminStats).mockResolvedValue({
        users: { total: 5, admins: 1, verified: 4, newLast7Days: 1 },
        sessions: { active: 2 },
        errors: { open: 0 },
        generatedAt: new Date(),
      });

      const statsRes = await request(app)
        .get("/api/admin/stats")
        .set("Cookie", [`fintrack_access_token=${adminToken}`]);

      expect(statsRes.status).toBe(200);
      expect(statsRes.body.users.total).toBe(5);

      // Step 2: Get user list
      vi.mocked(adminService.listUsers).mockResolvedValue([
        {
          id: USER_ID,
          name: "Test User",
          role: "USER",
          isVerified: true,
          created_at: new Date(),
          updated_at: new Date(),
          authMethods: [],
        },
      ]);

      const usersRes = await request(app)
        .get("/api/admin/users")
        .set("Cookie", [`fintrack_access_token=${adminToken}`]);

      expect(usersRes.status).toBe(200);
    });
  });

  describe("Donation webhook happy path", () => {
    it("webhook SUCCEEDED → leaderboard shows donor", async () => {
      const webhookPayload = Buffer.from(
        JSON.stringify({
          id: "evt_e2e_123",
          type: "checkout.session.completed",
          data: { object: { id: "cs_e2e_123", payment_status: "paid" } },
        }),
      );

      // Step 1: Process webhook
      vi.mocked(donationService.processStripeWebhook).mockResolvedValue({
        received: true,
        duplicate: false,
      });

      const webhookRes = await request(app)
        .post("/api/donations/webhook")
        .set("content-type", "application/json")
        .set("stripe-signature", "t=1,v1=sig_e2e")
        .send(webhookPayload);

      expect(webhookRes.status).toBe(200);
      expect(webhookRes.body.received).toBe(true);

      // Step 2: Leaderboard updated
      vi.mocked(donationService.getDonationLeaderboard).mockResolvedValue([
        {
          userId: USER_ID,
          name: "Donor",
          photoUrl: null,
          totalAmountMinor: 500,
          currency: "usd",
        },
      ]);

      const leaderboardRes = await request(app).get(
        "/api/donations/leaderboard",
      );

      expect(leaderboardRes.status).toBe(200);
      expect(leaderboardRes.body.items).toHaveLength(1);
      expect(leaderboardRes.body.items[0].name).toBe("Donor");
    });
  });

  describe("Monobank import happy path (mocked fetch)", () => {
    it("user connects monobank, imports transactions, views summary", async () => {
      const userId = "11111111-1111-4111-8111-111111111111";
      const sessionId = "22222222-2222-4222-8222-222222222222";

      vi.mocked(authService.findSessionById).mockResolvedValue({
        sessionId,
        userId,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });

      global.fetch = vi.fn() as typeof fetch;
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            accounts: [
              {
                id: "acc_mono_e2e",
                type: "black",
                currencyCode: 980,
                cashbackType: "UAH",
                balance: 100000,
                creditLimit: 0,
                maskedPan: ["4111****1111"],
                iban: "UA1234567890",
              },
            ],
          }),
      } as Response);

      const userToken = generateAccessToken({
        id: userId,
        email: "mono@test.dev",
        telegram_id: null,
        role: "USER",
        isVerified: true,
        sessionId,
      });

      // Step 1: Get accounts
      const accountsRes = await request(app)
        .post("/api/transactions/monobank/accounts")
        .set("Cookie", [`fintrack_access_token=${userToken}`])
        .send({ token: "mono_token_e2e_1234567890" });

      expect(accountsRes.status).toBe(200);

      // Step 2: Import
      vi.mocked(
        transactionService.importMonobankTransactions,
      ).mockResolvedValue({ imported: 3, skipped: 0, total: 3 });

      const importRes = await request(app)
        .post("/api/transactions/monobank/import")
        .set("Cookie", [`fintrack_access_token=${userToken}`])
        .send({
          accountId: "acc_mono_e2e",
          accountCurrencyCode: "UAH",
          transactions: [
            {
              title: "Supermarket",
              type: "EXPENSE",
              amount: 200,
              currencyCode: "UAH",
              created_at: new Date().toISOString(),
              sourceTransactionId: "mono_e2e_1",
              sourceAccountId: "acc_mono_e2e",
            },
          ],
        });

      expect(importRes.status).toBe(200);

      // Step 3: Summary reflects imported transactions
      vi.mocked(transactionService.getAllTransactions).mockResolvedValue({
        data: [
          {
            id: "tx_mono_1",
            title: "Supermarket",
            type: "EXPENSE" as const,
            amount: new Prisma.Decimal(200),
            currencyCode: "UAH" as const,
            source: "MONOBANK" as const,
            sourceTransactionId: null,
            sourceAccountId: null,
            importedAt: null,
            created_at: new Date(),
            updated_at: new Date(),
            location: null,
          },
        ],
      });

      const summaryRes = await request(app)
        .get("/api/summary")
        .set("Cookie", [`fintrack_access_token=${userToken}`]);

      expect(summaryRes.status).toBe(200);
      expect(summaryRes.body.currentBalance).toBe(-200);
    });
  });
});
