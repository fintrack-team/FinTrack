import { ENV } from "../../config/env.js";
import type { CookieOptions, Request, Response, NextFunction } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import type { VerifyIdTokenOptions } from "google-auth-library";
import type { JwtPayload } from "../../types/jwt.js";
import { AppError } from "../../middleware/errorHandler.js";
import * as authService from "./service.js";
import {
  LoginUserBodySchema,
  TelegramWidgetPayloadSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
} from "@fintrack/types";
import {
  extractClientIp,
  generateFamilyId,
  generateSecureToken,
  hashToken,
  logSecurityEvent,
} from "../../utils/authSecurity.js";
import * as userService from "../user/service.js";
import * as mailer from "../../utils/mailer.js";
import { logger } from "../../lib/logger.js";

// Controllers
const { ACCESS_TOKEN_SECRET } = ENV;
const ACCESS_TOKEN_COOKIE = "fintrack_access_token";
const REFRESH_TOKEN_COOKIE = "fintrack_refresh_token";
const ACCESS_TOKEN_TTL = 15 * 60; // 15 minutes
const REFRESH_TOKEN_TTL_DAYS = 7;
const GOOGLE_ISSUERS = new Set([
  "https://accounts.google.com",
  "accounts.google.com",
]);
const TELEGRAM_WIDGET_AUTH_TTL_SECONDS = 24 * 60 * 60;
const BOT_SECRET_HEADER = "x-bot-secret";

const isProduction = ENV.NODE_ENV === "production";
const cookieBaseOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  path: "/",
};
const googleOAuthClient = new OAuth2Client();

function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
  refreshExpiresAt: Date,
) {
  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
    ...cookieBaseOptions,
    maxAge: ACCESS_TOKEN_TTL * 1000,
  });

  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
    ...cookieBaseOptions,
    expires: refreshExpiresAt,
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_TOKEN_COOKIE, cookieBaseOptions);
  res.clearCookie(REFRESH_TOKEN_COOKIE, cookieBaseOptions);
}

export function generateAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

function getRefreshTokenFromRequest(req: Request): string | null {
  const fromCookie = req.cookies?.[REFRESH_TOKEN_COOKIE];
  if (typeof fromCookie === "string" && fromCookie.length > 0)
    return fromCookie;
  const fromBody = req.body?.token;
  if (typeof fromBody === "string" && fromBody.length > 0) return fromBody;

  return null;
}

function buildPayload(
  user: NonNullable<Awaited<ReturnType<typeof userService.getUser>>>,
): JwtPayload {
  return {
    id: user.id,
    email: user.authMethods.find((m) => m.type === "EMAIL")?.email ?? null,
    telegram_id:
      user.authMethods.find((m) => m.type === "TELEGRAM")?.telegram_id ?? null,
    role: user.role,
    isVerified: user.isVerified,
  };
}

async function issueUserSession(
  req: Request,
  res: Response,
  userId: string,
  payload: JwtPayload,
) {
  const refreshToken = generateSecureToken();
  const refreshTokenHash = hashToken(refreshToken);
  const refreshTokenExpirationDate = new Date(
    Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  const createdSession = await authService.createSession({
    tokenHash: refreshTokenHash,
    familyId: generateFamilyId(),
    expiresAt: refreshTokenExpirationDate,
    userAgent: req.headers["user-agent"]?.slice(0, 512) || null,
    ip:
      extractClientIp(req.headers["x-forwarded-for"] as string | undefined) ||
      req.ip ||
      null,
    lastUsedAt: new Date(),
    userId,
  });

  const accessToken = generateAccessToken({
    ...payload,
    sessionId: createdSession.sessionId,
  });

  setAuthCookies(res, accessToken, refreshToken, refreshTokenExpirationDate);
}

async function issueTelegramTokenPair(
  req: Request,
  userId: string,
  payload: JwtPayload,
) {
  const refreshToken = generateSecureToken();
  const refreshTokenHash = hashToken(refreshToken);
  const refreshTokenExpirationDate = new Date(
    Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  const createdSession = await authService.createSession({
    tokenHash: refreshTokenHash,
    familyId: generateFamilyId(),
    expiresAt: refreshTokenExpirationDate,
    userAgent: req.headers["user-agent"]?.slice(0, 512) || null,
    ip:
      extractClientIp(req.headers["x-forwarded-for"] as string | undefined) ||
      req.ip ||
      null,
    lastUsedAt: new Date(),
    userId,
  });

  const accessToken = generateAccessToken({
    ...payload,
    sessionId: createdSession.sessionId,
  });

  return { accessToken, refreshToken };
}

const GoogleTokenInfoSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.union([z.literal("true"), z.literal("false")]),
  name: z.string().optional(),
  picture: z.string().url().optional(),
  aud: z.string(),
});

const GoogleIdTokenPayloadSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.union([z.boolean(), z.literal("true"), z.literal("false")]),
  name: z.string().optional(),
  picture: z.string().url().optional(),
  aud: z.string().optional(),
  iss: z.string().optional(),
});

function normalizeGoogleEmailVerified(value: boolean | "true" | "false") {
  return value === true || value === "true";
}

async function verifyGoogleTokenViaTokenInfo(idToken: string) {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );
  if (!response.ok) {
    throw new AppError("Invalid Google token", 401);
  }

  const rawData: unknown = await response.json();
  const parsed = GoogleTokenInfoSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new AppError("Invalid Google token payload", 401);
  }

  if (ENV.GOOGLE_CLIENT_ID && parsed.data.aud !== ENV.GOOGLE_CLIENT_ID) {
    throw new AppError("Invalid Google token audience", 401);
  }

  if (parsed.data.email_verified !== "true") {
    throw new AppError("Google email is not verified", 401);
  }

  return parsed.data;
}

async function verifyGoogleTokenViaIdToken(idToken: string) {
  const verifyOptions: VerifyIdTokenOptions = {
    idToken,
  };
  if (ENV.GOOGLE_CLIENT_ID) {
    verifyOptions.audience = ENV.GOOGLE_CLIENT_ID;
  }

  const ticket = await googleOAuthClient.verifyIdToken(verifyOptions);

  const payload = ticket.getPayload();
  const parsed = GoogleIdTokenPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError("Invalid Google token payload", 401);
  }

  if (!normalizeGoogleEmailVerified(parsed.data.email_verified)) {
    throw new AppError("Google email is not verified", 401);
  }

  if (!parsed.data.iss || !GOOGLE_ISSUERS.has(parsed.data.iss)) {
    throw new AppError("Invalid Google token issuer", 401);
  }

  if (ENV.GOOGLE_CLIENT_ID && parsed.data.aud !== ENV.GOOGLE_CLIENT_ID) {
    throw new AppError("Invalid Google token audience", 401);
  }

  return {
    sub: parsed.data.sub,
    email: parsed.data.email,
    email_verified: "true" as const,
    name: parsed.data.name,
    picture: parsed.data.picture,
    aud: parsed.data.aud ?? "",
  };
}

async function verifyGoogleToken(idToken: string) {
  const mode = ENV.GOOGLE_OAUTH_VERIFY_MODE;
  if (mode === "tokeninfo") {
    return verifyGoogleTokenViaTokenInfo(idToken);
  }

  return verifyGoogleTokenViaIdToken(idToken);
}

// The bot exchange issues tokens for a bare telegramId, so only the bot itself
// may call it. Hashing both sides gives equal-length buffers for
// timingSafeEqual, leaking neither content nor length.
function hasValidBotSecret(req: Request): boolean {
  const received = req.headers[BOT_SECRET_HEADER];
  if (typeof received !== "string" || received.length === 0) return false;
  const expected = crypto
    .createHash("sha256")
    .update(ENV.BOT_API_SECRET)
    .digest();
  const actual = crypto.createHash("sha256").update(received).digest();
  return crypto.timingSafeEqual(expected, actual);
}

function verifyTelegramWidgetPayload(rawPayload: unknown) {
  const parsed = TelegramWidgetPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new AppError("Invalid Telegram widget payload", 400);
  }

  if (!ENV.TELEGRAM_BOT_TOKEN) {
    throw new AppError("Telegram bot token is not configured", 500);
  }

  const payload = parsed.data;
  const authDate = Number(payload.auth_date);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    !Number.isFinite(authDate) ||
    authDate <= 0 ||
    nowSeconds - authDate > TELEGRAM_WIDGET_AUTH_TTL_SECONDS
  ) {
    throw new AppError("Telegram login payload expired", 401);
  }

  const dataCheckString = Object.entries(payload)
    .filter(([key, value]) => key !== "hash" && value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort()
    .join("\n");

  const secret = crypto
    .createHash("sha256")
    .update(ENV.TELEGRAM_BOT_TOKEN)
    .digest();
  const expectedHash = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  const receivedHash = payload.hash.toLowerCase();
  if (
    expectedHash.length !== receivedHash.length ||
    !crypto.timingSafeEqual(
      Buffer.from(expectedHash, "hex"),
      Buffer.from(receivedHash, "hex"),
    )
  ) {
    throw new AppError("Invalid Telegram login signature", 401);
  }

  const firstName = payload.first_name?.trim();
  const lastName = payload.last_name?.trim();
  const username = payload.username?.trim();
  const name =
    [firstName, lastName].filter(Boolean).join(" ") ||
    (username ? `@${username}` : `Telegram ${String(payload.id)}`);

  return {
    telegramId: String(payload.id),
    name,
  };
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = LoginUserBodySchema.parse(req.body);
    const user = await authService.login(email, password);
    if (!user) throw new AppError("Invalid credentials", 401);
    if (!user.isVerified) {
      throw new AppError("Email verification required", 403);
    }

    const payload = buildPayload(user);
    await issueUserSession(req, res, user.id, payload);
    logSecurityEvent("auth.login.success", { userId: user.id });
    res.status(200).json({ authenticated: true });
  } catch (err) {
    const maybeEmail =
      typeof req.body?.email === "string" ? req.body.email : undefined;
    logSecurityEvent("auth.login.failed", { email: maybeEmail, ip: req.ip });
    next(err);
  }
}

export function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  (async () => {
    const authHeader = req.headers.authorization?.split(" ")[1];
    const token = authHeader || req.cookies?.[ACCESS_TOKEN_COOKIE];
    if (!token) throw new AppError("Missing access token", 401);

    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);
    const JwtPayloadSchema = z.object({
      id: z.string().uuid(),
      email: z.string().email().nullable(),
      telegram_id: z.string().nullable(),
      role: z.enum(["USER", "ADMIN"]),
      isVerified: z.boolean(),
      sessionId: z.string().uuid(),
    });

    const payload = JwtPayloadSchema.parse(decoded);
    if (ENV.NODE_ENV === "test") {
      req.user = payload;
      return next();
    }

    const session = await authService.findSessionById(payload.sessionId);
    if (!session || session.userId !== payload.id) {
      throw new AppError("Invalid access token session", 401);
    }

    if (session.revokedAt || session.expiresAt <= new Date()) {
      throw new AppError("Session revoked or expired", 401);
    }

    req.user = payload;
    next();
  })().catch((err) => {
    if (err instanceof jwt.TokenExpiredError) {
      return next(new AppError("Access token expired", 401));
    }
    if (err instanceof jwt.JsonWebTokenError) {
      return next(new AppError("Invalid access token", 401));
    }
    next(err);
  });
}

export async function token(req: Request, res: Response, next: NextFunction) {
  try {
    const refreshToken = getRefreshTokenFromRequest(req);
    if (!refreshToken) throw new AppError("Missing refresh token", 401);

    const refreshTokenHash = hashToken(refreshToken);
    const existingSession =
      await authService.findSessionByTokenHash(refreshTokenHash);

    if (!existingSession) {
      clearAuthCookies(res);
      logSecurityEvent("auth.refresh.invalid_token", { ip: req.ip });
      throw new AppError("Invalid refresh token", 401);
    }

    if (existingSession.revokedAt) {
      await authService.revokeSessionFamily(existingSession.familyId);
      clearAuthCookies(res);
      logSecurityEvent("auth.refresh.reuse_detected", {
        userId: existingSession.userId,
        sessionId: existingSession.sessionId,
        familyId: existingSession.familyId,
      });
      throw new AppError("Refresh token reuse detected", 401);
    }

    if (existingSession.expiresAt < new Date()) {
      await authService.revokeSession(existingSession.sessionId);
      clearAuthCookies(res);
      throw new AppError("Refresh token expired", 401);
    }

    const user = await userService.getUser(existingSession.userId);
    if (!user) {
      await authService.revokeSessionFamily(existingSession.familyId);
      clearAuthCookies(res);
      throw new AppError("User not found", 401);
    }

    const payload = buildPayload(user);

    const nextRefreshToken = generateSecureToken();
    const nextRefreshTokenHash = hashToken(nextRefreshToken);
    const nextRefreshTokenExpirationDate = new Date(
      Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    let rotatedSession: Awaited<ReturnType<typeof authService.rotateSession>>;
    try {
      rotatedSession = await authService.rotateSession(
        existingSession.sessionId,
        {
          tokenHash: nextRefreshTokenHash,
          familyId: existingSession.familyId,
          parentSessionId: existingSession.sessionId,
          expiresAt: nextRefreshTokenExpirationDate,
          userAgent: req.headers["user-agent"]?.slice(0, 512) || null,
          ip:
            extractClientIp(
              req.headers["x-forwarded-for"] as string | undefined,
            ) ||
            req.ip ||
            null,
          lastUsedAt: new Date(),
          userId: existingSession.userId,
        },
      );
    } catch (rotationError) {
      await authService.revokeSessionFamily(existingSession.familyId);
      clearAuthCookies(res);
      logSecurityEvent("auth.refresh.reuse_detected", {
        userId: existingSession.userId,
        sessionId: existingSession.sessionId,
        familyId: existingSession.familyId,
        source: "rotation",
      });
      throw rotationError;
    }

    const accessToken = generateAccessToken({
      ...payload,
      sessionId: rotatedSession.sessionId,
    });

    setAuthCookies(
      res,
      accessToken,
      nextRefreshToken,
      nextRefreshTokenExpirationDate,
    );
    logSecurityEvent("auth.refresh.rotated", {
      userId: existingSession.userId,
      familyId: existingSession.familyId,
      parentSessionId: existingSession.sessionId,
    });
    res.status(200).json({ authenticated: true });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const refreshToken = getRefreshTokenFromRequest(req);
    if (refreshToken) {
      const refreshTokenHash = hashToken(refreshToken);
      const session = await authService.logoutByTokenHash(refreshTokenHash);
      if (session) {
        logSecurityEvent("auth.logout.success", {
          userId: session.userId,
          sessionId: session.sessionId,
        });
      }
    }

    clearAuthCookies(res);
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
}

export async function logoutAll(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError("Unauthorized", 401);
    await authService.revokeAllUserSessions(userId);
    clearAuthCookies(res);
    logSecurityEvent("auth.logout_all.success", { userId });
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
}

export async function googleExchange(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = z
      .object({
        idToken: z.string().min(10),
      })
      .safeParse(req.body);
    if (!parsed.success)
      throw new AppError("Invalid Google exchange payload", 400);

    const verifiedGoogleData = await verifyGoogleToken(parsed.data.idToken);
    const user = await authService.loginWithGoogle({
      googleSub: verifiedGoogleData.sub,
      email: verifiedGoogleData.email,
      name: verifiedGoogleData.name || verifiedGoogleData.email,
      photoUrl: verifiedGoogleData.picture ?? null,
    });

    if (!user) throw new AppError("Unable to complete Google login", 401);
    const payload = buildPayload(user);
    await issueUserSession(req, res, user.id, payload);
    logSecurityEvent("auth.google.exchange.success", { userId: user.id });
    res.status(200).json({ authenticated: true });
  } catch (err) {
    logSecurityEvent("auth.google.exchange.failed", { ip: req.ip });
    next(err);
  }
}

export async function verifyEmail(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : null;
    if (!token) throw new AppError("Missing verification token", 400);

    const userId = await authService.consumeEmailVerificationToken(token);
    const user = await userService.getUser(userId);
    if (!user) throw new AppError("User not found", 404);

    const payload = buildPayload(user);
    await issueUserSession(req, res, user.id, payload);

    logSecurityEvent("auth.email.verified", { userId });

    const corsFirstOrigin = ENV.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .find(Boolean);
    const frontendBase =
      ENV.FRONTEND_URL || corsFirstOrigin || "http://localhost:5173";
    const normalizedFrontendBase = frontendBase.replace(/\/+$/, "");
    res.redirect(`${normalizedFrontendBase}/dashboard?verified=1`);
  } catch (err) {
    next(err);
  }
}

export async function telegramExchange(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = z
      .discriminatedUnion("source", [
        z.object({
          source: z.literal("bot"),
          telegramId: z.string().min(1),
          name: z.string().min(1),
        }),
        z.object({
          source: z.literal("widget"),
          telegram: TelegramWidgetPayloadSchema,
        }),
      ])
      .safeParse(req.body);
    if (!parsed.success)
      throw new AppError("Invalid Telegram exchange payload", 400);

    if (parsed.data.source === "bot" && !hasValidBotSecret(req)) {
      logSecurityEvent("auth.telegram.exchange.bot_secret_invalid", {
        ip: req.ip,
      });
      throw new AppError("Unauthorized", 401);
    }

    const telegram =
      parsed.data.source === "widget"
        ? verifyTelegramWidgetPayload(parsed.data.telegram)
        : {
            telegramId: parsed.data.telegramId,
            name: parsed.data.name,
          };

    const user = await authService.loginWithTelegram(
      telegram.telegramId,
      telegram.name,
    );
    if (!user) throw new AppError("Unable to complete Telegram login", 401);

    const payload = buildPayload(user);

    if (parsed.data.source === "widget") {
      await issueUserSession(req, res, user.id, payload);
      logSecurityEvent("auth.telegram.widget_exchange.success", {
        userId: user.id,
      });
      return res.status(200).json({ authenticated: true });
    }

    const tokenPair = await issueTelegramTokenPair(req, user.id, payload);
    logSecurityEvent("auth.telegram.exchange.success", { userId: user.id });
    return res.status(200).json(tokenPair);
  } catch (err) {
    logSecurityEvent("auth.telegram.exchange.failed", { ip: req.ip });
    next(err);
  }
}

export async function linkTelegram(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError("Unauthorized", 401);

    const parsed = z
      .object({
        telegram: TelegramWidgetPayloadSchema,
      })
      .safeParse(req.body);
    if (!parsed.success)
      throw new AppError("Invalid Telegram link payload", 400);

    const telegram = verifyTelegramWidgetPayload(parsed.data.telegram);
    const user = await authService.linkTelegramToUser({
      userId,
      telegramId: telegram.telegramId,
    });

    if (!user) throw new AppError("User not found", 404);
    logSecurityEvent("auth.telegram.link.success", {
      userId,
      telegramId: telegram.telegramId,
    });
    return res.status(200).json({ linked: true });
  } catch (err) {
    logSecurityEvent("auth.telegram.link.failed", {
      userId: req.user?.id,
      ip: req.ip,
    });
    next(err);
  }
}

export async function linkGoogle(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError("Unauthorized", 401);

    const parsed = z
      .object({ idToken: z.string().min(10) })
      .safeParse(req.body);
    if (!parsed.success) throw new AppError("Invalid Google link payload", 400);

    const verifiedGoogleData = await verifyGoogleToken(parsed.data.idToken);
    const user = await authService.linkGoogleToUser({
      userId,
      googleSub: verifiedGoogleData.sub,
      email: verifiedGoogleData.email,
      photoUrl: verifiedGoogleData.picture ?? null,
    });

    if (!user) throw new AppError("User not found", 404);
    logSecurityEvent("auth.google.link.success", { userId });
    return res.status(200).json({ linked: true });
  } catch (err) {
    logSecurityEvent("auth.google.link.failed", {
      userId: req.user?.id,
      ip: req.ip,
    });
    next(err);
  }
}

export async function telegramRefresh(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = z
      .object({ refreshToken: z.string().min(1) })
      .safeParse(req.body);
    if (!parsed.success) throw new AppError("Missing refresh token", 400);

    const refreshTokenHash = hashToken(parsed.data.refreshToken);
    const existingSession =
      await authService.findSessionByTokenHash(refreshTokenHash);

    if (!existingSession) {
      logSecurityEvent("auth.telegram.refresh.invalid_token", { ip: req.ip });
      throw new AppError("Invalid refresh token", 401);
    }

    if (existingSession.revokedAt) {
      await authService.revokeSessionFamily(existingSession.familyId);
      logSecurityEvent("auth.telegram.refresh.reuse_detected", {
        userId: existingSession.userId,
        familyId: existingSession.familyId,
      });
      throw new AppError("Refresh token reuse detected", 401);
    }

    if (existingSession.expiresAt < new Date()) {
      await authService.revokeSession(existingSession.sessionId);
      throw new AppError("Refresh token expired", 401);
    }

    const user = await userService.getUser(existingSession.userId);
    if (!user) {
      await authService.revokeSessionFamily(existingSession.familyId);
      throw new AppError("User not found", 401);
    }

    const payload = buildPayload(user);
    const nextRefreshToken = generateSecureToken();
    const nextRefreshTokenHash = hashToken(nextRefreshToken);
    const nextRefreshTokenExpirationDate = new Date(
      Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    const rotatedSession = await authService.rotateSession(
      existingSession.sessionId,
      {
        tokenHash: nextRefreshTokenHash,
        familyId: existingSession.familyId,
        parentSessionId: existingSession.sessionId,
        expiresAt: nextRefreshTokenExpirationDate,
        userAgent: req.headers["user-agent"]?.slice(0, 512) || null,
        ip:
          extractClientIp(
            req.headers["x-forwarded-for"] as string | undefined,
          ) ||
          req.ip ||
          null,
        lastUsedAt: new Date(),
        userId: existingSession.userId,
      },
    );

    const accessToken = generateAccessToken({
      ...payload,
      sessionId: rotatedSession.sessionId,
    });

    logSecurityEvent("auth.telegram.refresh.rotated", {
      userId: existingSession.userId,
      familyId: existingSession.familyId,
    });
    res.status(200).json({ accessToken, refreshToken: nextRefreshToken });
  } catch (err) {
    next(err);
  }
}

export async function resendVerification(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);

    const normalizedEmail = email.trim().toLowerCase();
    const authMethod = await authService.findAuthMethodByEmail(normalizedEmail);

    // Always return 200 to avoid leaking whether email exists
    if (!authMethod) return res.status(200).json({ sent: true });

    const user = await userService.getUser(authMethod.userId);
    if (!user || user.isVerified) return res.status(200).json({ sent: true });

    const verificationToken = await authService.createEmailVerificationToken(
      user.id,
    );
    // Background send — keep the response fast and leak-free regardless of the
    // mail provider's latency or availability.
    void mailer
      .sendVerificationEmail(normalizedEmail, verificationToken, user.name)
      .catch((err) =>
        logger.error({ err }, "Failed to send verification email"),
      );

    logSecurityEvent("auth.email.resend_verification", { userId: user.id });
    return res.status(200).json({ sent: true });
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { email } = ForgotPasswordSchema.parse(req.body);

    const result = await authService.createPasswordResetToken(email);

    // Always return 200 to avoid leaking whether the email is registered.
    // Send in the background: a slow/blocked mail provider must not hang the
    // request or turn the no-leak 200 into a 500.
    if (result) {
      void mailer
        .sendPasswordResetEmail(
          email.trim().toLowerCase(),
          result.token,
          result.name,
        )
        .catch((err) =>
          logger.error({ err }, "Failed to send password reset email"),
        );
      logSecurityEvent("auth.password.reset_requested", {
        userId: result.userId,
      });
    }

    return res.status(200).json({ sent: true });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { token, password } = ResetPasswordSchema.parse(req.body);

    const userId = await authService.consumePasswordResetToken(token, password);

    logSecurityEvent("auth.password.reset_completed", { userId });
    return res.status(200).json({ reset: true });
  } catch (err) {
    next(err);
  }
}
