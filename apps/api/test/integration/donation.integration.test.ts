import { vi } from "vitest";
import request from "supertest";

import type { app as AppType } from "../../src/app.js";
import type * as AuthServiceTypes from "../../src/modules/auth/service.js";
import type * as DonationServiceTypes from "../../src/modules/donation/service.js";

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

const donationServiceModuleMock = {
  createDonationCheckoutSession: vi.fn(),
  processStripeWebhook: vi.fn(),
  getDonationLeaderboard: vi.fn(),
};
vi.mock(
  "../../src/modules/donation/service.js",
  () => donationServiceModuleMock,
);

let app: typeof AppType;
let authService: typeof AuthServiceTypes;
let donationService: typeof DonationServiceTypes;
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

beforeAll(async () => {
  ({ app } = await import("../../src/app.js"));
  authService = await import("../../src/modules/auth/service.js");
  donationService = await import("../../src/modules/donation/service.js");
  ({ generateAccessToken } =
    await import("../../src/modules/auth/controller.js"));
});

describe("Donation Integration", () => {
  let token: string;
  const webhookPayload = Buffer.from(
    JSON.stringify({
      id: "evt_test_123",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_123", payment_status: "paid" } },
    }),
  );

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

  describe("POST /api/donations/checkout-session", () => {
    it("returns 401 without auth", async () => {
      const res = await request(app).post("/api/donations/checkout-session");
      expect(res.status).toBe(401);
    });

    it("creates checkout session and returns 201", async () => {
      vi.mocked(
        donationService.createDonationCheckoutSession,
      ).mockResolvedValue({
        checkoutUrl: "https://checkout.stripe.com/session_123",
        checkoutSessionId: "cs_test_123",
      });

      const res = await request(app)
        .post("/api/donations/checkout-session")
        .set("Cookie", [`fintrack_access_token=${token}`]);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("checkoutUrl");
      expect(res.body).toHaveProperty("checkoutSessionId");
    });

    it("passes idempotency key from header to service", async () => {
      vi.mocked(
        donationService.createDonationCheckoutSession,
      ).mockResolvedValue({
        checkoutUrl: "https://checkout.stripe.com/session_123",
        checkoutSessionId: "cs_test_123",
      });

      await request(app)
        .post("/api/donations/checkout-session")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .set("x-idempotency-key", "idem-key-abc123");

      expect(
        vi.mocked(donationService.createDonationCheckoutSession),
      ).toHaveBeenCalledWith(USER_ID, "idem-key-abc123");
    });

    it("calls service without idempotency key when header missing", async () => {
      vi.mocked(
        donationService.createDonationCheckoutSession,
      ).mockResolvedValue({
        checkoutUrl: "https://checkout.stripe.com/session_abc",
        checkoutSessionId: "cs_test_abc",
      });

      await request(app)
        .post("/api/donations/checkout-session")
        .set("Cookie", [`fintrack_access_token=${token}`]);

      expect(
        vi.mocked(donationService.createDonationCheckoutSession),
      ).toHaveBeenCalledWith(USER_ID, undefined);
    });
  });

  describe("POST /api/donations/webhook", () => {
    it("returns 400 for missing stripe-signature header", async () => {
      const res = await request(app)
        .post("/api/donations/webhook")
        .set("content-type", "application/json")
        .send(webhookPayload);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/signature/i);
    });

    it("processes SUCCEEDED webhook and returns 200", async () => {
      vi.mocked(donationService.processStripeWebhook).mockResolvedValue({
        received: true,
        duplicate: false,
      });

      const res = await request(app)
        .post("/api/donations/webhook")
        .set("content-type", "application/json")
        .set("stripe-signature", "t=123456,v1=abc123def456")
        .send(webhookPayload);

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(res.body.duplicate).toBe(false);
    });

    it("idempotent: duplicate webhook event returns duplicate=true", async () => {
      vi.mocked(donationService.processStripeWebhook).mockResolvedValue({
        received: true,
        duplicate: true,
      });

      const res = await request(app)
        .post("/api/donations/webhook")
        .set("content-type", "application/json")
        .set("stripe-signature", "t=123456,v1=abc123def456")
        .send(webhookPayload);

      expect(res.status).toBe(200);
      expect(res.body.duplicate).toBe(true);
      expect(res.body.received).toBe(true);
    });

    it("processes CANCELED webhook (expired session)", async () => {
      const canceledPayload = Buffer.from(
        JSON.stringify({
          id: "evt_canceled_123",
          type: "checkout.session.expired",
          data: { object: { id: "cs_expired_123" } },
        }),
      );

      vi.mocked(donationService.processStripeWebhook).mockResolvedValue({
        received: true,
        duplicate: false,
      });

      const res = await request(app)
        .post("/api/donations/webhook")
        .set("content-type", "application/json")
        .set("stripe-signature", "t=123456,v1=cancelledsig")
        .send(canceledPayload);

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });

    it("returns error when service throws invalid signature", async () => {
      vi.mocked(donationService.processStripeWebhook).mockRejectedValue(
        Object.assign(new Error("Invalid Stripe webhook signature"), {
          statusCode: 400,
        }),
      );

      const res = await request(app)
        .post("/api/donations/webhook")
        .set("content-type", "application/json")
        .set("stripe-signature", "t=bad,v1=bad")
        .send(webhookPayload);

      // Plain Error (not AppError) → error handler returns 500
      expect(res.status).toBe(500);
    });

    it("parallel duplicate webhooks all receive a response (no crash)", async () => {
      let callCount = 0;
      vi.mocked(donationService.processStripeWebhook).mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          received: true,
          duplicate: callCount > 1,
        });
      });

      const requests = Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/donations/webhook")
          .set("content-type", "application/json")
          .set("stripe-signature", "t=123456,v1=parallel_sig")
          .send(webhookPayload),
      );

      const results = await Promise.all(requests);
      expect(results.every((r) => r.status === 200)).toBe(true);
    });
  });

  describe("GET /api/donations/leaderboard", () => {
    it("returns 200 with leaderboard (no auth required)", async () => {
      vi.mocked(donationService.getDonationLeaderboard).mockResolvedValue([
        {
          userId: USER_ID,
          name: "Test User",
          photoUrl: null,
          totalAmountMinor: 1000,
          currency: "usd",
        },
      ]);

      const res = await request(app).get("/api/donations/leaderboard");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items).toHaveLength(1);
    });

    it("returns empty leaderboard when no donations", async () => {
      vi.mocked(donationService.getDonationLeaderboard).mockResolvedValue([]);

      const res = await request(app).get("/api/donations/leaderboard");

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(0);
    });

    it("leaderboard is consistent after SUCCEEDED webhook", async () => {
      vi.mocked(donationService.processStripeWebhook).mockResolvedValue({
        received: true,
        duplicate: false,
      });
      vi.mocked(donationService.getDonationLeaderboard).mockResolvedValue([
        {
          userId: USER_ID,
          name: "Test User",
          photoUrl: null,
          totalAmountMinor: 500,
          currency: "usd",
        },
      ]);

      await request(app)
        .post("/api/donations/webhook")
        .set("content-type", "application/json")
        .set("stripe-signature", "t=1,v1=sig")
        .send(webhookPayload);

      const res = await request(app).get("/api/donations/leaderboard");
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
    });
  });
});
