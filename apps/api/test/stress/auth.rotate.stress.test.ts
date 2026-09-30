import { vi } from "vitest";

describe("Auth rotateSession stress", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("allows only one successful rotation under concurrent reuse attempts", async () => {
    const revoked = new Set<string>();

    vi.doMock("../../src/prisma/client.js", () => ({
      prisma: {
        $transaction: async (
          callback: (tx: {
            session: {
              updateMany: (args: {
                where: { sessionId: string };
                data: unknown;
              }) => Promise<{ count: number }>;
              create: (args: {
                data: { tokenHash: string };
              }) => Promise<{ sessionId: string }>;
            };
          }) => Promise<unknown>,
        ) => {
          const tx = {
            session: {
              updateMany: async (args: { where: { sessionId: string } }) => {
                const sessionId = args.where.sessionId;
                if (revoked.has(sessionId)) {
                  return { count: 0 };
                }

                revoked.add(sessionId);
                // Add jitter to increase race pressure after acquiring the lock
                await new Promise((resolve) =>
                  setTimeout(resolve, Math.floor(Math.random() * 5)),
                );
                return { count: 1 };
              },
              create: async (args: { data: { tokenHash: string } }) => ({
                sessionId: `new-${args.data.tokenHash}`,
              }),
            },
          };

          return callback(tx);
        },
      },
    }));

    const { rotateSession } = await import("../../src/modules/auth/service.js");

    const attempts = 40;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, (_, index) =>
        rotateSession("root-session", {
          tokenHash: `token-${index}`,
          familyId: "family-1",
          expiresAt: new Date(Date.now() + 60_000),
          userId: "user-1",
        }),
      ),
    );

    const successCount = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected") as Array<{
      status: "rejected";
      reason: { message?: string; statusCode?: number };
    }>;

    expect(successCount).toBe(1);
    expect(failed.length).toBe(attempts - 1);
    expect(
      failed.every(
        (r) =>
          r.reason?.message === "Refresh token reuse detected" &&
          r.reason?.statusCode === 401,
      ),
    ).toBe(true);
  });
});
