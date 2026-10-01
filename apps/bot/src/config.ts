import dotenv from "dotenv";
dotenv.config();

if (!process.env.TELEGRAM_BOT_TOKEN)
  throw new Error("TELEGRAM_BOT_TOKEN is required in .env");
if (!process.env.BOT_API_SECRET)
  throw new Error("BOT_API_SECRET is required in .env");
if (!process.env.API_URL) throw new Error("API_URL is required in .env");
if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required in .env");

export const config = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  BOT_API_SECRET: process.env.BOT_API_SECRET,
  API_URL: process.env.API_URL.replace(/\/$/, ""),
  REDIS_URL: process.env.REDIS_URL,
} as const;
