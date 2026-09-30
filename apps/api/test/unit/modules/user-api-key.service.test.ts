import { vi } from "vitest";

const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockUpsert = vi.fn();
const mockDeleteMany = vi.fn();

vi.mock("../../../src/prisma/client.js", () => ({
  prisma: {
    userApiKey: {
      findMany: mockFindMany,
      upsert: mockUpsert,
      findUnique: mockFindUnique,
      update: mockUpdate,
      deleteMany: mockDeleteMany,
    },
  },
}));

vi.mock("../../../src/utils/crypto.js", () => ({
  encryptApiKey: (k: string) => `enc:${k}`,
  decryptApiKey: (k: string) => k.replace(/^enc:/, ""),
}));

let getUserApiKeys: (userId: string) => Promise<Array<{ maskedKey: string }>>;
let toggleUserApiKey: (
  userId: string,
  provider: "GROQ" | "GEMINI",
) => Promise<{ isActive: boolean; provider: string } | null>;

beforeAll(async () => {
  ({ getUserApiKeys, toggleUserApiKey } =
    (await import("../../../src/modules/user-api-key/service.js")) as {
      getUserApiKeys: typeof getUserApiKeys;
      toggleUserApiKey: typeof toggleUserApiKey;
    });
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUserApiKeys — maskKey", () => {
  it("masks key as first-6 + bullets + last-4", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "k1",
        provider: "GROQ",
        isActive: true,
        apiKey: "enc:gsk_abc123XXXXXXYYYY5678",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const [key] = await getUserApiKeys("user-id");
    expect(key!.maskedKey).toBe("gsk_ab••••••••5678");
  });

  it("never exposes the raw key in maskedKey", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "k1",
        provider: "GROQ",
        isActive: true,
        apiKey: "enc:supersecretkey1234",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const [key] = await getUserApiKeys("user-id");
    expect(key!.maskedKey).not.toContain("supersecretkey1234");
  });
});

describe("toggleUserApiKey", () => {
  it("returns null when key does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await toggleUserApiKey("user-id", "GROQ");
    expect(result).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("toggles isActive from true to false", async () => {
    mockFindUnique.mockResolvedValue({ id: "k1", isActive: true });
    mockUpdate.mockResolvedValue({ isActive: false, provider: "GROQ" });
    await toggleUserApiKey("user-id", "GROQ");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });

  it("toggles isActive from false to true", async () => {
    mockFindUnique.mockResolvedValue({ id: "k1", isActive: false });
    mockUpdate.mockResolvedValue({ isActive: true, provider: "GROQ" });
    await toggleUserApiKey("user-id", "GROQ");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: true } }),
    );
  });
});
