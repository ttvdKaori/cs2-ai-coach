import crypto from "node:crypto";

export function createId(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function seedFromHash(hash) {
  const normalized = String(hash || "").padEnd(16, "0").slice(0, 16);
  return Number.parseInt(normalized.slice(0, 8), 16) ^ Number.parseInt(normalized.slice(8), 16);
}

export function mulberry32(seed) {
  let value = seed >>> 0;
  return function rand() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(items, rand) {
  return items[Math.floor(rand() * items.length) % items.length];
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function percent(value, digits = 0) {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatRoundTime(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = String(safe % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

export function sanitizeFileName(name) {
  const base = String(name || "upload.dem").split(/[\\/]/).pop();
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "upload.dem";
}

export function unique(items) {
  return [...new Set(items)];
}

