import dotenv from "dotenv";
import { AppError } from "../middleware/errorHandler.js";
import { logger } from "../lib/logger.js";

dotenv.config();

const requiredEnvVars = [
  "DATABASE_URL",
  "REDIS_URL",
  "ACCESS_TOKEN_SECRET",
  "CSRF_SECRET",
  "API_KEY_ENCRYPTION_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "BOT_API_SECRET",
  "GOOGLE_CLIENT_ID",
];

for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    throw new AppError(`Missing required environment variable: ${key}`, 500);
  }
}

const GROQAPITOKENS = Object.keys(process.env)
  .filter((key) => key.startsWith("GROQ_API_KEY_"))
  .map((key) => process.env[key])
  .filter((token): token is string => Boolean(token));

if (GROQAPITOKENS.length === 0 && process.env.NODE_ENV !== "test") {
  logger.warn("No Groq API tokens (GROQ_API_KEY_x) found in .env");
}

if (
  process.env.STRIPE_DONATION_AMOUNT &&
  Number.isNaN(Number(process.env.STRIPE_DONATION_AMOUNT))
) {
  throw new AppError(
    "Invalid STRIPE_DONATION_AMOUNT. It must be a number in minor units.",
    500,
  );
}

if (
  process.env.STRIPE_DONATION_DURATION_DAYS &&
  Number.isNaN(Number(process.env.STRIPE_DONATION_DURATION_DAYS))
) {
  throw new AppError(
    "Invalid STRIPE_DONATION_DURATION_DAYS. It must be a number.",
    500,
  );
}

if (process.env.PORT && Number.isNaN(Number(process.env.PORT))) {
  throw new AppError("Invalid PORT. It must be a number.", 500);
}

export const ENV = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  ENABLE_SWAGGER_IN_PROD: process.env.ENABLE_SWAGGER_IN_PROD === "true",
  HOST: process.env.HOST ?? "localhost",
  PORT: process.env.PORT ? Number(process.env.PORT) : 8000,
  SWAGGER_SERVER_URL: process.env.SWAGGER_SERVER_URL ?? "",
  CORS_ORIGINS: process.env.CORS_ORIGINS ?? "",
  FRONTEND_URL: process.env.FRONTEND_URL ?? "",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID as string,
  GOOGLE_OAUTH_VERIFY_MODE:
    process.env.GOOGLE_OAUTH_VERIFY_MODE === "tokeninfo"
      ? "tokeninfo"
      : "verifyIdToken",
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN as string,
  BOT_API_SECRET: process.env.BOT_API_SECRET as string,
  DATABASE_URL: process.env.DATABASE_URL as string,
  REDIS_URL: process.env.REDIS_URL as string,
  MONGO_URL: process.env.MONGO_URL ?? "",
  ACCESS_TOKEN_SECRET: process.env.ACCESS_TOKEN_SECRET as string,
  CSRF_SECRET: process.env.CSRF_SECRET as string,
  GROQAPITOKENS,
  API_KEY_ENCRYPTION_SECRET: process.env.API_KEY_ENCRYPTION_SECRET as string,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  STRIPE_DONATION_PRICE_ID: process.env.STRIPE_DONATION_PRICE_ID ?? "",
  STRIPE_DONATION_SUCCESS_URL: process.env.STRIPE_DONATION_SUCCESS_URL ?? "",
  STRIPE_DONATION_CANCEL_URL: process.env.STRIPE_DONATION_CANCEL_URL ?? "",
  STRIPE_DONATION_CURRENCY: process.env.STRIPE_DONATION_CURRENCY ?? "usd",
  STRIPE_DONATION_AMOUNT: process.env.STRIPE_DONATION_AMOUNT
    ? Number(process.env.STRIPE_DONATION_AMOUNT)
    : undefined,
  STRIPE_DONATION_DURATION_DAYS: process.env.STRIPE_DONATION_DURATION_DAYS
    ? Number(process.env.STRIPE_DONATION_DURATION_DAYS)
    : undefined,
  // Email — sent via Brevo's transactional HTTP API (port 443) so it works on
  // hosts that block outbound SMTP (e.g. Render). Empty key disables sending.
  BREVO_API_KEY: process.env.BREVO_API_KEY ?? "",
  // Sender identity, "Name <email>" or a bare address. Must be a verified
  // sender in the Brevo dashboard.
  MAIL_FROM: process.env.MAIL_FROM ?? "",
  EMAIL_VERIFICATION_BASE_URL: process.env.EMAIL_VERIFICATION_BASE_URL ?? "",
  // Base URL of the frontend directory that hosts /reset-password
  PASSWORD_RESET_BASE_URL: process.env.PASSWORD_RESET_BASE_URL ?? "",
} as const;

export type EnvConfig = typeof ENV;
