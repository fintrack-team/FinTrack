import { vi } from "vitest";

const mockCustomersCreate = vi.fn<() => Promise<unknown>>();
const mockCheckoutCreate = vi.fn<() => Promise<unknown>>();
const mockConstructEvent = vi.fn<() => unknown>();
const logSecurityEvent = vi.fn<() => void>();

const mockPrisma = {
  user: {
    findUnique: vi.fn<() => Promise<unknown>>(),
    update: vi.fn<() => Promise<unknown>>(),
  },
  donationPayment: {
    upsert: vi.fn<() => Promise<unknown>>(),
    findUnique: vi.fn<() => Promise<unknown>>(),
    updateMany: vi.fn<() => Promise<unknown>>(),
  },
  stripeWebhookEvent: {
    create: vi.fn<() => Promise<unknown>>(),
  },
  $transaction:
    vi.fn<(cb: (tx: unknown) => Promise<unknown>) => Promise<unknown>>(),
};

describe("Donation service", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    vi.doMock("../../../src/config/env.js", () => ({
      ENV: {
        STRIPE_SECRET_KEY: "sk_test_123",
        STRIPE_WEBHOOK_SECRET: "whsec_123",
        STRIPE_DONATION_PRICE_ID: "",
        STRIPE_DONATION_SUCCESS_URL: "https://app.fintrack.dev/success",
        STRIPE_DONATION_CANCEL_URL: "https://app.fintrack.dev/cancel",
        STRIPE_DONATION_CURRENCY: "usd",
        STRIPE_DONATION_AMOUNT: 500,
        STRIPE_DONATION_DURATION_DAYS: 30,
      },
    }));

    vi.doMock("../../../src/prisma/client.js", () => ({
      prisma: mockPrisma,
    }));

    vi.doMock("../../../src/utils/authSecurity.js", () => ({
      logSecurityEvent,
    }));

    vi.doMock("stripe", () => ({
      default: class Stripe {
        customers = {
          create: mockCustomersCreate,
        };

        checkout = {
          sessions: {
            create: mockCheckoutCreate,
          },
        };

        webhooks = {
          constructEvent: mockConstructEvent,
        };

        constructor() {
          // no-op
        }
      },
    }));
  });

  it("creates donation checkout session and passes idempotency key", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      name: "User",
      stripeCustomerId: null,
      authMethods: [{ email: "user@test.dev" }],
    });
    mockCustomersCreate.mockResolvedValue({ id: "cus_123" });
    mockCheckoutCreate.mockResolvedValue({
      id: "cs_123",
      url: "https://checkout.stripe.com/pay/cs_123",
      payment_intent: "pi_123",
      amount_total: 500,
      currency: "usd",
    });

    const { createDonationCheckoutSession } =
      await import("../../../src/modules/donation/service.js");

    const result = await createDonationCheckoutSession("user-1", "idem-1");

    expect(result).toEqual({
      checkoutUrl: "https://checkout.stripe.com/pay/cs_123",
      checkoutSessionId: "cs_123",
    });

    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_123",
        mode: "payment",
      }),
      { idempotencyKey: "idem-1" },
    );
    expect(mockPrisma.donationPayment.upsert).toHaveBeenCalled();
  });

  it("rejects webhook with invalid Stripe signature", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("bad signature");
    });

    const { processStripeWebhook } =
      await import("../../../src/modules/donation/service.js");

    await expect(
      processStripeWebhook(Buffer.from("{}"), "invalid-signature"),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Invalid Stripe webhook signature",
    });
  });

  it("processes completed checkout webhook and activates donation", async () => {
    mockConstructEvent.mockReturnValue({
      id: "evt_123",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_123",
          metadata: { userId: "user-1" },
          payment_status: "paid",
          payment_intent: "pi_123",
          amount_total: 500,
          currency: "usd",
        },
      },
    });

    mockPrisma.stripeWebhookEvent.create.mockResolvedValue({ id: "evt_123" });
    mockPrisma.donationPayment.findUnique.mockResolvedValue({
      userId: "user-1",
    });
    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          donationPayment: {
            upsert: vi.fn<() => Promise<unknown>>().mockResolvedValue({}),
          },
          user: {
            update: vi.fn<() => Promise<unknown>>().mockResolvedValue({}),
          },
        };
        return callback(tx as never);
      },
    );

    const { processStripeWebhook } =
      await import("../../../src/modules/donation/service.js");

    const result = await processStripeWebhook(Buffer.from("{}"), "sig_123");

    expect(result).toEqual({ received: true, duplicate: false });
    expect(mockPrisma.stripeWebhookEvent.create).toHaveBeenCalled();
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(logSecurityEvent).toHaveBeenCalledWith(
      "stripe.donation.activated",
      expect.objectContaining({
        userId: "user-1",
        stripeCheckoutSessionId: "cs_123",
      }),
    );
  });
});
