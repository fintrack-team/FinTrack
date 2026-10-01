import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import {
  type TokenPair,
  getTokens,
  hasTokens,
  setTokens,
} from "./tokenStore.js";

const { API_URL, BOT_API_SECRET } = config;

const FETCH_TIMEOUT_MS = 20_000;

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Bot is a trusted service client: instead of rotating refresh tokens (which
// trips the API's reuse-detection when a response is lost to a cold start), it
// re-exchanges telegramId + name for a fresh pair on demand.
async function exchangeTokens(
  telegramId: number,
  name: string,
): Promise<TokenPair> {
  const res = await timedFetch(`${API_URL}/auth/telegram/exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bot-Secret": BOT_API_SECRET,
    },
    body: JSON.stringify({
      source: "bot",
      telegramId: String(telegramId),
      name,
    }),
  });

  if (!res.ok) {
    throw new Error(`Telegram auth failed: ${res.status}`);
  }

  const data = (await res.json()) as TokenPair;
  await setTokens(telegramId, data, name);
  return data;
}

// Dedupe concurrent re-exchanges per user: a burst of 401s would otherwise fire
// one exchange each and blow the API's exchange rate limit (10 / 15 min).
const inflightExchange = new Map<number, Promise<TokenPair>>();

function exchangeOnce(telegramId: number, name: string): Promise<TokenPair> {
  let inflight = inflightExchange.get(telegramId);
  if (!inflight) {
    inflight = exchangeTokens(telegramId, name).finally(() => {
      inflightExchange.delete(telegramId);
    });
    inflightExchange.set(telegramId, inflight);
  }
  return inflight;
}

async function apiFetch(
  method: string,
  path: string,
  telegramId: number,
  body?: unknown,
  retried = false,
): Promise<Response> {
  const tokens = await getTokens(telegramId);

  const res = await timedFetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401 && tokens && !retried) {
    try {
      await exchangeOnce(telegramId, tokens.name);
    } catch (err) {
      logger.warn({ err, path }, "token re-exchange failed");
      return res;
    }
    return apiFetch(method, path, telegramId, body, true);
  }

  if (!res.ok) {
    logger.warn({ status: res.status, method, path }, "api request failed");
  }

  return res;
}

export async function authenticateUser(
  telegramId: number,
  name: string,
): Promise<void> {
  await exchangeTokens(telegramId, name);
}

export async function isAuthenticated(telegramId: number): Promise<boolean> {
  return hasTokens(telegramId);
}

export const api = {
  get: (telegramId: number, path: string) => apiFetch("GET", path, telegramId),
  post: (telegramId: number, path: string, body: unknown) =>
    apiFetch("POST", path, telegramId, body),
  put: (telegramId: number, path: string, body: unknown) =>
    apiFetch("PUT", path, telegramId, body),
  patch: (telegramId: number, path: string, body: unknown) =>
    apiFetch("PATCH", path, telegramId, body),
  delete: (telegramId: number, path: string) =>
    apiFetch("DELETE", path, telegramId),
};
