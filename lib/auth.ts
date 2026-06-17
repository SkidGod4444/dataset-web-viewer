import crypto from "node:crypto";

export const SESSION_COOKIE = "dwv_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days (seconds)

const SECRET = process.env.AUTH_SECRET ?? "";
const PASSWORD = process.env.APP_PASSWORD ?? "";

/** Whether an app password is configured (gate is active). */
export const authConfigured = PASSWORD.length > 0 && SECRET.length > 0;

function timingSafeStrEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function isPasswordCorrect(password: string): boolean {
  return PASSWORD.length > 0 && timingSafeStrEqual(password, PASSWORD);
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
}

/** Create a signed session token: "<expiryMs>.<hmac>". */
export function createSessionToken(): string {
  const payload = String(Date.now() + SESSION_MAX_AGE * 1000);
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token || !SECRET) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return false;
  }
  const exp = Number(payload);
  return Number.isFinite(exp) && exp > Date.now();
}

/** Read and verify the session cookie from an incoming request. */
export function isAuthenticated(request: Request): boolean {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(
    new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`),
  );
  return verifySessionToken(match?.[1]);
}
