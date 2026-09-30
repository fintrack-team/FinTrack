import { jest } from "@jest/globals";
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

beforeAll(async () => {
  ({ app } = await import("../../src/app.js"));
  authService = await import("../../src/modules/auth/service.js");
  transactionService = await import("../../src/modules/transaction/service.js");
  ({ generateAccessToken } =
    await import("../../src/modules/auth/controller.js"));
});

describe("Transaction IDOR protection integration", () => {
  const userId = "f4f9d2eb-52d9-4a89-a2e1-7f3f6f1f0f11";
  const transactionId = "0f98ef84-6e7d-4b88-9cb0-0e3b2d123456";

  beforeEach(() => {
    jest.resetAllMocks();

    jest.mocked(authService.findSessionById).mockResolvedValue({
      sessionId: "e6594ef2-7a59-4f7a-99f9-862758f624b2",
      userId,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    // Simulate transaction owned by another user -> service cannot find it for current user
    jest.mocked(transactionService.getTransaction).mockResolvedValue(null);
  });

  function makeUserToken() {
    return generateAccessToken({
      id: userId,
      email: "user@test.dev",
      telegram_id: null,
      role: "USER",
      isVerified: true,
      sessionId: "e6594ef2-7a59-4f7a-99f9-862758f624b2",
    });
  }

  it("returns 404 on GET /transactions/:id for foreign transaction", async () => {
    const response = await request(app)
      .get(`/api/transactions/${transactionId}`)
      .set("Cookie", [`fintrack_access_token=${makeUserToken()}`]);

    expect(response.status).toBe(404);
  });

  it("returns 404 on PATCH /transactions/:id and does not update", async () => {
    const response = await request(app)
      .patch(`/api/transactions/${transactionId}`)
      .set("Cookie", [`fintrack_access_token=${makeUserToken()}`])
      .send({ title: "Changed" });

    expect(response.status).toBe(404);
  });

  it("returns 404 on DELETE /transactions/:id and does not delete", async () => {
    const response = await request(app)
      .delete(`/api/transactions/${transactionId}`)
      .set("Cookie", [`fintrack_access_token=${makeUserToken()}`]);

    expect(response.status).toBe(404);
  });
});
