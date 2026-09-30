import { vi } from "vitest";

const mockUserUpdate = vi.fn();
const mockSessionUpdateMany = vi.fn();

vi.mock("../../../src/prisma/client.js", () => ({
  prisma: {
    user: { update: mockUserUpdate },
    session: { updateMany: mockSessionUpdateMany },
  },
}));

let updateUserRole: (
  actorAdminId: string,
  userId: string,
  role: "USER" | "ADMIN",
) => Promise<unknown>;
let revokeAllSessions: (
  excludeSessionId?: string,
) => Promise<{ revokedCount: number }>;

beforeAll(async () => {
  ({ updateUserRole, revokeAllSessions } =
    await import("../../../src/modules/admin/service.js"));
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateUserRole", () => {
  it("throws 400 when admin demotes themselves", async () => {
    await expect(
      updateUserRole("admin-id", "admin-id", "USER"),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("allows admin to promote another user", async () => {
    mockUserUpdate.mockResolvedValue({ id: "other-id", role: "ADMIN" });
    await expect(
      updateUserRole("admin-id", "other-id", "ADMIN"),
    ).resolves.toBeDefined();
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "other-id" } }),
    );
  });

  it("allows admin to demote a different user", async () => {
    mockUserUpdate.mockResolvedValue({ id: "other-id", role: "USER" });
    await expect(
      updateUserRole("admin-id", "other-id", "USER"),
    ).resolves.toBeDefined();
  });
});

describe("revokeAllSessions", () => {
  it("returns revokedCount from DB result", async () => {
    mockSessionUpdateMany.mockResolvedValue({ count: 7 });
    await expect(revokeAllSessions()).resolves.toEqual({ revokedCount: 7 });
  });

  it("excludes given session when excludeSessionId provided", async () => {
    mockSessionUpdateMany.mockResolvedValue({ count: 3 });
    await revokeAllSessions("keep-this-session");
    expect(mockSessionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: { sessionId: "keep-this-session" },
        }),
      }),
    );
  });

  it("does not include NOT filter when no excludeSessionId", async () => {
    mockSessionUpdateMany.mockResolvedValue({ count: 5 });
    await revokeAllSessions();
    const callArg = mockSessionUpdateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    expect(callArg.where).not.toHaveProperty("NOT");
  });
});
