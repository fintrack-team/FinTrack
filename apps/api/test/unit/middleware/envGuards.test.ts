import { vi } from "vitest";

describe("blockInProduction", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("calls next(AppError(404)) in production", async () => {
    vi.doMock("../../../src/config/env.js", () => ({
      ENV: { NODE_ENV: "production" },
    }));

    const { blockInProduction } =
      await import("../../../src/middleware/envGuards.js");
    const next = vi.fn();

    blockInProduction({} as never, {} as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as {
      statusCode?: number;
      message?: string;
    };
    expect(err).toBeTruthy();
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe("Not found");
  });

  it("calls next() with no argument in development", async () => {
    vi.doMock("../../../src/config/env.js", () => ({
      ENV: { NODE_ENV: "development" },
    }));

    const { blockInProduction } =
      await import("../../../src/middleware/envGuards.js");
    const next = vi.fn();

    blockInProduction({} as never, {} as never, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("calls next() with no argument in test env", async () => {
    vi.doMock("../../../src/config/env.js", () => ({
      ENV: { NODE_ENV: "test" },
    }));

    const { blockInProduction } =
      await import("../../../src/middleware/envGuards.js");
    const next = vi.fn();

    blockInProduction({} as never, {} as never, next);

    expect(next).toHaveBeenCalledWith();
  });
});
