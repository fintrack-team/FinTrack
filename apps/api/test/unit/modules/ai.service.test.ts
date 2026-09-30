import { vi } from "vitest";

const findUnique = vi.fn<() => Promise<unknown>>();
const update = vi.fn<() => Promise<unknown>>();
const findFirst = vi.fn<() => Promise<unknown>>();
const findMany = vi.fn<() => Promise<unknown[]>>();
const createMany = vi.fn<() => Promise<unknown>>();

const mockChatCompletionsCreate = vi.fn<() => Promise<unknown>>();
const decryptApiKey = vi.fn((value: string) => value);

describe("AI service", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    vi.doMock("../../../src/config/env.js", () => ({
      ENV: {
        NODE_ENV: "test",
        GROQAPITOKENS: ["default-token"],
      },
    }));

    vi.doMock("../../../src/prisma/client.js", () => ({
      prisma: {
        user: {
          findUnique,
          update,
        },
        userApiKey: {
          findFirst,
        },
        message: {
          findMany,
          createMany,
        },
      },
    }));

    vi.doMock("../../../src/utils/crypto.js", () => ({
      decryptApiKey,
    }));

    vi.doMock("openai", () => ({
      default: class OpenAI {
        chat = {
          completions: {
            create: mockChatCompletionsCreate,
          },
        };

        constructor() {
          // no-op
        }
      },
    }));
  });

  it("throws 403 when AI attempts are exhausted for regular user", async () => {
    findUnique.mockResolvedValue({
      role: "USER",
      donationStatus: "NONE",
      donationExpiresAt: null,
      aiAnalysisUsed: 10,
      aiAnalysisLimit: 10,
    });

    const { ensureAiAccessOrThrow } =
      await import("../../../src/modules/ai/service.js");

    await expect(ensureAiAccessOrThrow("user-1")).rejects.toMatchObject({
      statusCode: 403,
      message:
        "AI analysis limit reached. Please make a donation to unlock unlimited access.",
    });
  });

  it("tries fallback Gemini model candidates and succeeds", async () => {
    findFirst.mockResolvedValue({
      provider: "GEMINI",
      apiKey: "encrypted-key",
      isActive: true,
      updatedAt: new Date(),
    });
    findMany.mockResolvedValue([]);

    mockChatCompletionsCreate
      .mockRejectedValueOnce(
        Object.assign(new Error("model missing"), { status: 404 }),
      )
      .mockResolvedValueOnce({
        model: "gemini-2.5-flash",
        choices: [{ message: { content: "AI result" } }],
      });

    const { getAiResponse } =
      await import("../../../src/modules/ai/service.js");

    const result = await getAiResponse(
      "user-1",
      "Prompt",
      { x: 1 },
      "gemini-custom",
    );

    expect(result).toEqual({ model: "gemini-2.5-flash", result: "AI result" });
    expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(2);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { role: "user", content: "Prompt", userId: "user-1" },
        { role: "assistant", content: "AI result", userId: "user-1" },
      ],
    });
  });

  it("maps provider rate-limit error to USER_KEY_LIMIT", async () => {
    findFirst.mockResolvedValue({
      provider: "GROQ",
      apiKey: "encrypted-key",
      isActive: true,
      updatedAt: new Date(),
    });
    findMany.mockResolvedValue([]);

    mockChatCompletionsCreate.mockRejectedValueOnce(
      Object.assign(new Error("rate_limit"), {
        status: 429,
        code: "rate_limit_exceeded",
      }),
    );

    const { getAiResponse } =
      await import("../../../src/modules/ai/service.js");

    await expect(
      getAiResponse("user-1", "Prompt", { x: 1 }),
    ).rejects.toMatchObject({
      name: "AiServiceError",
      code: "USER_KEY_LIMIT",
      message: "Your API key has reached its rate limit.",
    });
  });
});
