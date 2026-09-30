import { vi } from "vitest";

const mockCount = vi.fn();
const mockDeleteMany = vi.fn();
const mockTransaction = vi.fn();

vi.mock("../../../src/prisma/client.js", () => ({
  prisma: { $transaction: mockTransaction },
}));

let deleteAuthMethod: (userId: string, authMethodId: string) => Promise<void>;

beforeAll(async () => {
  ({ deleteAuthMethod } = await import("../../../src/modules/user/service.js"));
});

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ authMethod: { count: mockCount, deleteMany: mockDeleteMany } }),
  );
});

describe("deleteAuthMethod", () => {
  it("throws 400 when removing the last auth method", async () => {
    mockCount.mockResolvedValue(1);
    await expect(
      deleteAuthMethod("user-id", "method-id"),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("throws 404 when auth method not found (deleteMany returns 0)", async () => {
    mockCount.mockResolvedValue(2);
    mockDeleteMany.mockResolvedValue({ count: 0 });
    await expect(
      deleteAuthMethod("user-id", "nonexistent-id"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("resolves when user has multiple methods and method exists", async () => {
    mockCount.mockResolvedValue(3);
    mockDeleteMany.mockResolvedValue({ count: 1 });
    await expect(
      deleteAuthMethod("user-id", "method-id"),
    ).resolves.not.toThrow();
  });

  it("passes userId to deleteMany to prevent deleting another user's method", async () => {
    mockCount.mockResolvedValue(2);
    mockDeleteMany.mockResolvedValue({ count: 1 });
    await deleteAuthMethod("user-id", "method-id");
    expect(mockDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user-id" }),
      }),
    );
  });
});
