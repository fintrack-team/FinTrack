import { vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

const mockFindUnique = vi.fn();

vi.mock("../../../src/prisma/client.js", () => ({
  prisma: {
    user: { findUnique: mockFindUnique },
  },
}));

vi.mock("../../../src/config/env.js", () => ({
  ENV: { NODE_ENV: "production" },
}));

type UserPayload = {
  id: string;
  email: string | null;
  telegram_id: string | null;
  role: "USER" | "ADMIN";
  isVerified: boolean;
  sessionId: string;
};

let requireRole: (
  roles: Array<"USER" | "ADMIN">,
) => (req: Request, res: Response, next: NextFunction) => Promise<void>;
let requireVerifiedUser: (
  req: Request,
  res: Response,
  next: NextFunction,
) => void;

beforeAll(async () => {
  ({ requireRole, requireVerifiedUser } =
    await import("../../../src/middleware/authz.js"));
});

beforeEach(() => {
  vi.clearAllMocks();
});

function makeReq(user?: Partial<UserPayload>): Request {
  return { user } as unknown as Request;
}

const res = {} as Response;

describe("requireRole", () => {
  it("returns 401 when req.user is missing", async () => {
    const next = vi.fn() as NextFunction;
    await requireRole(["ADMIN"])(makeReq(undefined), res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 }),
    );
  });

  it("returns 403 when DB role is USER on ADMIN-only route", async () => {
    mockFindUnique.mockResolvedValue({ role: "USER" });
    const next = vi.fn() as NextFunction;
    await requireRole(["ADMIN"])(
      makeReq({ id: "u1", role: "USER" }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it("calls next() when DB confirms ADMIN role", async () => {
    mockFindUnique.mockResolvedValue({ role: "ADMIN" });
    const next = vi.fn() as NextFunction;
    await requireRole(["ADMIN"])(
      makeReq({ id: "u1", role: "ADMIN" }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("allows USER on USER+ADMIN route", async () => {
    mockFindUnique.mockResolvedValue({ role: "USER" });
    const next = vi.fn() as NextFunction;
    await requireRole(["USER", "ADMIN"])(
      makeReq({ id: "u1", role: "USER" }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("falls back to token role when DB throws and token role is allowed", async () => {
    mockFindUnique.mockRejectedValue(new Error("DB unavailable"));
    const next = vi.fn() as NextFunction;
    await requireRole(["ADMIN"])(
      makeReq({ id: "u1", role: "ADMIN" }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("enforces token role fallback when DB throws and role is insufficient", async () => {
    mockFindUnique.mockRejectedValue(new Error("DB unavailable"));
    const next = vi.fn() as NextFunction;
    await requireRole(["ADMIN"])(
      makeReq({ id: "u1", role: "USER" }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });
});

describe("requireVerifiedUser (production mode)", () => {
  it("returns 401 when req.user is missing", () => {
    const next = vi.fn() as NextFunction;
    requireVerifiedUser({ user: undefined } as unknown as Request, res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 401 }),
    );
  });

  it("returns 403 for unverified user", () => {
    const next = vi.fn() as NextFunction;
    requireVerifiedUser(makeReq({ isVerified: false }), res, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it("calls next() for verified user", () => {
    const next = vi.fn() as NextFunction;
    requireVerifiedUser(makeReq({ isVerified: true }), res, next);
    expect(next).toHaveBeenCalledWith();
  });
});
