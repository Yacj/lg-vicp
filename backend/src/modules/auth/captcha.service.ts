import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { Redis } from "ioredis";

export const CAPTCHA_TTL_SECONDS = 120;
const CAPTCHA_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function createCaptcha() {
  const code = Array.from({ length: 4 }, () => CAPTCHA_ALPHABET[randomInt(CAPTCHA_ALPHABET.length)]).join("");
  const noise = Array.from({ length: 5 }, (_, index) => {
    const x = 12 + index * 25;
    const y = 12 + randomInt(28);
    return `<circle cx="${x}" cy="${y}" r="${1 + randomInt(2)}" fill="#${randomInt(0xffffff).toString(16).padStart(6, "0")}"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="132" height="48" viewBox="0 0 132 48"><rect width="132" height="48" fill="#f4f7fb"/>${noise}<text x="66" y="34" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" font-weight="700" letter-spacing="7" fill="#1f2937">${code}</text></svg>`;
  return {
    code,
    image: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
  };
}

export function hashCaptcha(code: string) {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export async function verifyCaptcha(redis: Redis, key: string, code: string) {
  const stored = await redis.get(key);
  if (!stored) return false;
  const actual = Buffer.from(hashCaptcha(code));
  const expected = Buffer.from(stored);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
