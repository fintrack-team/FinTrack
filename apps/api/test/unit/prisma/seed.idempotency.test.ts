import { vi } from "vitest";

vi.mock("bcrypt", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed") },
  hash: vi.fn().mockResolvedValue("hashed"),
}));

const mockUser = { id: "seed-user-id" };
const mockFindMany = vi.fn();
const mockFindFirst = vi.fn();
const mockDeleteMany = vi.fn();
const mockCreate = vi.fn().mockResolvedValue(mockUser);
const mockCreateMany = vi.fn().mockResolvedValue({ count: 0 });
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../src/prisma/client.js", () => ({
  prisma: {
    $connect: mockConnect,
    $disconnect: mockDisconnect,
    authMethod: {
      findMany: mockFindMany,
      findFirst: mockFindFirst,
      create: mockCreate,
    },
    user: {
      deleteMany: mockDeleteMany,
      create: mockCreate,
    },
    transaction: {
      create: mockCreate,
      createMany: mockCreateMany,
    },
    message: { create: mockCreate },
    donationPayment: { create: mockCreate },
    errorLog: { create: mockCreate },
  },
}));

vi.mock("../../../src/utils/crypto.js", () => ({
  encryptApiKey: (key: string) => `encrypted:${key}`,
}));

let runSeed: () => Promise<void>;

beforeAll(async () => {
  ({ runSeed } = await import("../../../src/prisma/seed.js"));
});

beforeEach(() => {
  vi.clearAllMocks();
  mockFindMany.mockResolvedValue([]);
  mockFindFirst.mockResolvedValue(null);
  mockDeleteMany.mockResolvedValue({ count: 0 });
  mockCreate.mockResolvedValue(mockUser);
  mockCreateMany.mockResolvedValue({ count: 0 });
});

describe("seed idempotency", () => {
  it("runs without error on first call", async () => {
    await expect(runSeed()).resolves.not.toThrow();
  });

  it("runs without error on second call (idempotent)", async () => {
    await runSeed();
    await expect(runSeed()).resolves.not.toThrow();
  });

  it("deletes stale users when previous seed data exists", async () => {
    mockFindMany
      .mockResolvedValueOnce([{ userId: "old-id-1" }, { userId: "old-id-2" }]) // email methods
      .mockResolvedValueOnce([{ userId: "old-id-3" }]); // telegram methods

    await runSeed();

    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["old-id-1", "old-id-2", "old-id-3"] } },
    });
  });

  it("skips deleteMany when no stale users exist", async () => {
    mockFindMany.mockResolvedValue([]);
    mockFindFirst.mockResolvedValue(null);

    await runSeed();

    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("does not call $disconnect (caller's responsibility)", async () => {
    await runSeed();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });
});
