import { vi } from "vitest";

const mockCreateMany = vi.fn();

vi.mock("../../../src/prisma/client.js", () => ({
  prisma: {
    transaction: { createMany: mockCreateMany },
  },
}));

let importMonobankTransactions: (
  userId: string,
  transactions: unknown[],
) => Promise<{ imported: number; skipped: number; total: number }>;

beforeAll(async () => {
  ({ importMonobankTransactions } =
    (await import("../../../src/modules/transaction/service.js")) as {
      importMonobankTransactions: typeof importMonobankTransactions;
    });
});

beforeEach(() => {
  vi.clearAllMocks();
});

const makeTxs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    title: `Payment ${i}`,
    type: "EXPENSE",
    amount: 100,
    currencyCode: "UAH",
    created_at: new Date("2024-01-01"),
    sourceTransactionId: `src-${i}`,
    sourceAccountId: "acc-1",
  }));

describe("importMonobankTransactions", () => {
  it("returns zeros and skips DB call for empty array", async () => {
    const result = await importMonobankTransactions("user-id", []);
    expect(result).toEqual({ imported: 0, skipped: 0, total: 0 });
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it("reports all as imported when no duplicates exist", async () => {
    mockCreateMany.mockResolvedValue({ count: 3 });
    const result = await importMonobankTransactions("user-id", makeTxs(3));
    expect(result).toEqual({ imported: 3, skipped: 0, total: 3 });
  });

  it("reports skipped as total minus DB count", async () => {
    mockCreateMany.mockResolvedValue({ count: 1 });
    const result = await importMonobankTransactions("user-id", makeTxs(3));
    expect(result).toEqual({ imported: 1, skipped: 2, total: 3 });
  });

  it("calls createMany with skipDuplicates: true", async () => {
    mockCreateMany.mockResolvedValue({ count: 1 });
    await importMonobankTransactions("user-id", makeTxs(1));
    expect(mockCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });
});
