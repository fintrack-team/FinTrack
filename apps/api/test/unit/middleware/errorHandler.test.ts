import { vi } from "vitest";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  AppError,
  errorHandler,
} from "../../../src/middleware/errorHandler.js";

function makeRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe("AppError", () => {
  it("stores statusCode and message", () => {
    const err = new AppError("Forbidden", 403);
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe("Forbidden");
  });

  it("stores optional details", () => {
    const err = new AppError("Bad request", 400, { field: "email" });
    expect(err.details).toEqual({ field: "email" });
  });

  it("is instanceof Error", () => {
    expect(new AppError("x", 500)).toBeInstanceOf(Error);
  });
});

describe("errorHandler", () => {
  const req = {} as never;
  const next = vi.fn() as never;

  it("AppError → uses statusCode and message from error", () => {
    const res = makeRes();
    errorHandler(
      new AppError("Not found", 404, { id: "x" }),
      req,
      res as never,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: "Not found",
      details: { id: "x" },
    });
  });

  it("AppError without details → details is undefined in response", () => {
    const res = makeRes();
    errorHandler(new AppError("Unauthorized", 401), req, res as never, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Unauthorized",
      details: undefined,
    });
  });

  it("ZodError → 400 with 'Validation failed' and issues array", () => {
    let zodErr: z.ZodError | undefined;
    try {
      z.string().min(1).parse(42);
    } catch (e) {
      zodErr = e as z.ZodError;
    }
    const res = makeRes();
    errorHandler(zodErr!, req, res as never, next);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0]?.[0] as {
      error: string;
      details: unknown;
    };
    expect(body.error).toBe("Validation failed");
    expect(Array.isArray(body.details)).toBe(true);
  });

  it("Prisma P2002 (unique constraint) → 409 'Item already exists'", () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      {
        code: "P2002",
        clientVersion: "5.0.0",
      },
    );
    const res = makeRes();
    errorHandler(err, req, res as never, next);
    expect(res.status).toHaveBeenCalledWith(409);
    const body = res.json.mock.calls[0]?.[0] as { error: string };
    expect(body.error).toBe("Item already exists");
  });

  it("Prisma P2025 (record not found) → 404 'Not found'", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Record not found", {
      code: "P2025",
      clientVersion: "5.0.0",
    });
    const res = makeRes();
    errorHandler(err, req, res as never, next);
    expect(res.status).toHaveBeenCalledWith(404);
    const body = res.json.mock.calls[0]?.[0] as { error: string };
    expect(body.error).toBe("Not found");
  });

  it("Prisma unknown error code → 500 'Internal Server Error'", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unknown", {
      code: "P9999",
      clientVersion: "5.0.0",
    });
    const res = makeRes();
    errorHandler(err, req, res as never, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("PrismaClientValidationError → 400 'Invalid Prisma query'", () => {
    const err = new Prisma.PrismaClientValidationError("bad query", {
      clientVersion: "5.0.0",
    });
    const res = makeRes();
    errorHandler(err, req, res as never, next);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0]?.[0] as { error: string };
    expect(body.error).toBe("Invalid Prisma query");
  });

  it("unknown/plain Error → 500 'Internal Server Error'", () => {
    const res = makeRes();
    errorHandler(new Error("something unexpected"), req, res as never, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal Server Error" });
  });

  it("non-Error thrown value (string) → 500", () => {
    const res = makeRes();
    errorHandler("a raw string error", req, res as never, next);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
