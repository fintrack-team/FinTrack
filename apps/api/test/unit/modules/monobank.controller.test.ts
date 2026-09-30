import { vi } from "vitest";

const importMonobankTransactions = vi.fn<() => Promise<unknown>>();
const deleteAllMonobankTransactions = vi.fn<() => Promise<unknown>>();

function createRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

describe("Monobank controller", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns 400 when from >= to", async () => {
    const { fetchMonobankTransactions } =
      await import("../../../src/modules/transaction/monobank.controller.js");

    const req = {
      user: { id: "user-1" },
      body: {
        token: "12345678901234567890",
        from: 200,
        to: 100,
      },
    };
    const res = createRes();
    const next = vi.fn();

    await fetchMonobankTransactions(req as never, res as never, next);

    const err = next.mock.calls[0]?.[0] as {
      statusCode?: number;
      message?: string;
    };
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain("'from' must be less than 'to'");
  });

  it("enforces cooldown for repeated account requests", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ accounts: [{ id: "acc-1" }] }),
    } as Response);

    const { fetchMonobankAccounts } =
      await import("../../../src/modules/transaction/monobank.controller.js");

    const req = {
      user: { id: "user-1" },
      body: {
        token: "12345678901234567890",
      },
    };

    const res1 = createRes();
    const next1 = vi.fn();
    await fetchMonobankAccounts(req as never, res1 as never, next1);
    expect(res1.status).toHaveBeenCalledWith(200);

    const res2 = createRes();
    const next2 = vi.fn();
    await fetchMonobankAccounts(req as never, res2 as never, next2);

    const err = next2.mock.calls[0]?.[0] as {
      statusCode?: number;
      message?: string;
    };
    expect(err.statusCode).toBe(429);
    expect(err.message).toContain("Monobank request cooldown");
  });

  it("maps fetched statement items into preview payload", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accounts: [{ id: "acc-1", currencyCode: 980 }] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: "tx-income",
            time: 1_716_000_000,
            description: "Salary",
            amount: 100500,
            currencyCode: 980,
          },
          {
            id: "tx-expense",
            time: 1_716_000_100,
            description: "Coffee",
            amount: -2500,
            currencyCode: 840,
          },
        ],
      } as Response);

    const { fetchMonobankTransactions } =
      await import("../../../src/modules/transaction/monobank.controller.js");

    const req = {
      user: { id: "user-mapping" },
      body: {
        token: "12345678901234567890",
      },
    };

    const res = createRes();
    const next = vi.fn();
    await fetchMonobankTransactions(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0]?.[0] as {
      transactions: Array<{
        type: string;
        amount: number;
        currencyCode: string;
      }>;
    };
    expect(payload.transactions[0]).toMatchObject({
      type: "INCOME",
      amount: 1005,
      currencyCode: "UAH",
    });
    expect(payload.transactions[1]).toMatchObject({
      type: "EXPENSE",
      amount: 25,
      currencyCode: "USD",
    });
  });

  it("imports monobank transactions through service", async () => {
    vi.doMock("../../../src/modules/transaction/service.js", () => ({
      importMonobankTransactions,
      deleteAllMonobankTransactions,
    }));

    const controller =
      await import("../../../src/modules/transaction/monobank.controller.js");

    importMonobankTransactions.mockResolvedValue({
      imported: 1,
      skipped: 0,
      total: 1,
    });

    const req = {
      user: { id: "user-1" },
      body: {
        transactions: [
          {
            title: "Salary",
            type: "INCOME",
            amount: 100,
            currencyCode: "USD",
            created_at: new Date().toISOString(),
            sourceTransactionId: "source-1",
            sourceAccountId: "account-1",
          },
        ],
      },
    };

    const res = createRes();
    const next = vi.fn();

    await controller.importMonobankTransactions(
      req as never,
      res as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(importMonobankTransactions).toHaveBeenCalledWith(
      "user-1",
      expect.any(Array),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      imported: 1,
      skipped: 0,
      total: 1,
      source: "MONOBANK",
    });
  });
});
