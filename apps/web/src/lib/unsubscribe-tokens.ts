/**
 * Unsubscribe Tokens — HMAC-signed, URL-safe.
 *
 * Part of FFS-1181 Follow-Up Phase 5. Used by transactional email
 * templates to include a per-recipient unsubscribe URL that, when
 * clicked, inserts a per_flow row into ops.email_suppressions.
 *
 * Token format: base64url(payload_json).base64url(hmac)
 * Payload: { email: string, flow_slug: string, expires_at: number }
 *
 * expires_at is a unix-seconds timestamp. Tokens older than 1 year are
 * rejected. Collision-safe because each payload is timestamped.
 *
 * Secret: process.env.EMAIL_UNSUBSCRIBE_SECRET (32+ bytes, random).
 */

import crypto from "crypto";

interface UnsubscribePayload {
  email: string;
  flow_slug: string;
  expires_at: number; // unix seconds
}

const DEFAULT_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year

function getSecret(): string {
  const s = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "EMAIL_UNSUBSCRIBE_SECRET is missing or too short (need ≥16 chars)"
    );
  }
  return s;
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

/** Create an HMAC-signed unsubscribe token. */
export function signUnsubscribeToken(
  email: string,
  flowSlug: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): string {
  const payload: UnsubscribePayload = {
    email: email.trim().toLowerCase(),
    flow_slug: flowSlug,
    expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(Buffer.from(payloadJson, "utf8"));

  const hmac = crypto
    .createHmac("sha256", getSecret())
    .update(payloadB64)
    .digest();
  const sigB64 = base64UrlEncode(hmac);

  return `${payloadB64}.${sigB64}`;
}

/**
 * Verify a token. Returns the payload on success, null on any failure
 * (tampering, expired, wrong secret, malformed).
 */
export function verifyUnsubscribeToken(
  token: string
): UnsubscribePayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [payloadB64, sigB64] = parts;

    // Recompute HMAC
    const expected = crypto
      .createHmac("sha256", getSecret())
      .update(payloadB64)
      .digest();
    const actual = base64UrlDecode(sigB64);

    if (
      expected.length !== actual.length ||
      !crypto.timingSafeEqual(expected, actual)
    ) {
      return null;
    }

    const payload = JSON.parse(
      base64UrlDecode(payloadB64).toString("utf8")
    ) as UnsubscribePayload;

    if (
      typeof payload.email !== "string" ||
      typeof payload.flow_slug !== "string" ||
      typeof payload.expires_at !== "number"
    ) {
      return null;
    }

    if (payload.expires_at < Math.floor(Date.now() / 1000)) {
      return null; // expired
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Build a full unsubscribe URL for a template placeholder. Requires
 * APP_URL or NEXT_PUBLIC_APP_URL to be set.
 */
export function buildUnsubscribeUrl(email: string, flowSlug: string): string {
  const base =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://atlas.forgottenfelines.org";
  const token = signUnsubscribeToken(email, flowSlug);
  return `${base.replace(/\/$/, "")}/api/emails/unsubscribe/${token}`;
}
