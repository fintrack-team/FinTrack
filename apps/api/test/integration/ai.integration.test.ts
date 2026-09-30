import { jest } from "@jest/globals";
import request from "supertest";

import type { app as AppType } from "../../src/app.js";
import type * as AuthServiceTypes from "../../src/modules/auth/service.js";
import type * as AiServiceTypes from "../../src/modules/ai/service.js";
import type { generateAccessToken as GenerateAccessTokenType } from "../../src/modules/auth/controller.js";

// Local replica — must be the class the mock exports so controller's instanceof check works
class AiServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AiServiceError";
  }
}

// Mock objects are built once at module scope: jest may call a mock factory
// more than once (it does on Linux), and a fresh object per call would leave
// the test configuring a different jest.fn than the one the app calls.
const authServiceModuleMock = {
  findSessionById: jest.fn(),
  findSessionByTokenHash: jest.fn(),
  revokeSessionFamily: jest.fn(),
  loginWithGoogle: jest.fn(),
  createSession: jest.fn(),
  createEmailVerificationToken: jest.fn(),
};
jest.unstable_mockModule(
  "../../src/modules/auth/service.js",
  () => authServiceModuleMock,
);

const aiServiceModuleMock = {
  AiServiceError,
  getAIHistory: jest.fn(),
  getAiResponse: jest.fn(),
  ensureAiAccessOrThrow: jest.fn(),
  getAiAccessStatus: jest.fn(),
  incrementAiAnalysisUsage: jest.fn(),
};
jest.unstable_mockModule(
  "../../src/modules/ai/service.js",
  () => aiServiceModuleMock,
);

let app: typeof AppType;
let authService: typeof AuthServiceTypes;
let aiService: typeof AiServiceTypes;
let generateAccessToken: typeof GenerateAccessTokenType;

beforeAll(async () => {
  ({ app } = await import("../../src/app.js"));
  authService = await import("../../src/modules/auth/service.js");
  aiService = await import("../../src/modules/ai/service.js");
  ({ generateAccessToken } =
    await import("../../src/modules/auth/controller.js"));
});

const USER_ID = "66ba6cb3-3a2d-4fd9-8a61-30f5ad4fd897";
const SESSION_ID = "5c8dff72-a6f7-4293-af7a-7c7f6190c020";

const accessStub: AiServiceTypes.AiAccessStatus = {
  role: "USER",
  tier: "user",
  donationStatus: "NONE",
  donationExpiresAt: null,
  aiAnalysisUsed: 5,
  aiAnalysisLimit: 10,
  remainingAttempts: 5,
  isUnlimited: false,
};

describe("AI Integration", () => {
  let token: string;

  beforeEach(() => {
    jest.resetAllMocks();

    token = generateAccessToken({
      id: USER_ID,
      email: "me@test.dev",
      telegram_id: null,
      role: "USER",
      isVerified: true,
      sessionId: SESSION_ID,
    });

    jest.mocked(authService.findSessionById).mockResolvedValue({
      sessionId: SESSION_ID,
      userId: USER_ID,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
  });

  describe("GET /api/ai/history", () => {
    it("returns 200 with history array", async () => {
      jest.mocked(aiService.getAIHistory).mockResolvedValue([
        {
          id: "msg-1",
          prompt: "Analyze my spending",
          result: "Your spending is high",
          created_at: new Date(),
        },
      ]);

      const res = await request(app)
        .get("/api/ai/history")
        .set("Cookie", [`fintrack_access_token=${token}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("GET /api/ai/access", () => {
    it("returns 200 with access status fields", async () => {
      jest.mocked(aiService.getAiAccessStatus).mockResolvedValue(accessStub);

      const res = await request(app)
        .get("/api/ai/access")
        .set("Cookie", [`fintrack_access_token=${token}`]);

      expect(res.status).toBe(200);
      expect(res.body.remainingAttempts).toBe(5);
      expect(res.body.isUnlimited).toBe(false);
    });
  });

  describe("POST /api/ai", () => {
    it("returns 200 with AI response", async () => {
      jest
        .mocked(aiService.ensureAiAccessOrThrow)
        .mockResolvedValue(accessStub);
      jest.mocked(aiService.getAiResponse).mockResolvedValue({
        result: "You spent too much on food.",
      } as never);
      jest
        .mocked(aiService.incrementAiAnalysisUsage)
        .mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/ai")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ prompt: "Analyze my spending", data: { total: 1000 } });

      expect(res.status).toBe(200);
    });

    it("returns 400 for missing prompt", async () => {
      const res = await request(app)
        .post("/api/ai")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ data: { total: 1000 } });

      expect(res.status).toBe(400);
    });

    it("returns 400 for missing data", async () => {
      const res = await request(app)
        .post("/api/ai")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ prompt: "Analyze my spending" });

      expect(res.status).toBe(400);
    });

    it("returns 403 when AI limit reached", async () => {
      const { AppError } = await import("../../src/middleware/errorHandler.js");
      jest
        .mocked(aiService.ensureAiAccessOrThrow)
        .mockRejectedValue(
          new AppError(
            "AI analysis limit reached. Please make a donation to unlock unlimited access.",
            403,
          ),
        );

      const res = await request(app)
        .post("/api/ai")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ prompt: "Analyze my spending", data: { total: 1000 } });

      expect(res.status).toBe(403);
    });

    it("returns 503 with error code when AI provider unavailable", async () => {
      jest
        .mocked(aiService.ensureAiAccessOrThrow)
        .mockResolvedValue(accessStub);
      jest
        .mocked(aiService.getAiResponse)
        .mockRejectedValue(
          new AiServiceError(
            "DEFAULT_KEY_LIMIT",
            "Default AI service is temporarily unavailable.",
          ),
        );

      const res = await request(app)
        .post("/api/ai")
        .set("Cookie", [`fintrack_access_token=${token}`])
        .send({ prompt: "Analyze my spending", data: { total: 1000 } });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe("DEFAULT_KEY_LIMIT");
    });
  });
});
