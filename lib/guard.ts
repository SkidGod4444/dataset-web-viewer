import { isAuthenticated } from "./auth";

// Non-browser / automation user agents. Real browsers never match these.
// (Headless Chrome's *new* mode uses a normal UA, so this is a coarse layer —
// the client-side AutomationGuard catches the webdriver flag too.)
const AUTOMATION_UA =
  /headlesschrome|phantomjs|slimerjs|selenium|webdriver|puppeteer|playwright|python-requests|python-urllib|curl\/|wget\/|scrapy|httpclient|java\/|go-http-client|node-fetch|axios|okhttp|libwww|lwp::|aiohttp|\bbot\b|crawler|spider/i;

/** True when the request's User-Agent looks like a script/bot, not a browser. */
export function isAutomatedUserAgent(request: Request): boolean {
  const ua = request.headers.get("user-agent");
  if (!ua) return true; // browsers always send a UA; missing => scripted
  return AUTOMATION_UA.test(ua);
}

/**
 * Production-only origin check (defense-in-depth). Browsers attach fetch
 * metadata (`Sec-Fetch-Site`) and an `Origin`/`Referer` on same-origin
 * requests; command-line tools and bots don't.
 */
export function enforceBrowserOrigin(request: Request): Response | null {
  if (process.env.NODE_ENV !== "production") return null;

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "same-origin" || secFetchSite === "same-site") {
    return null;
  }
  if (secFetchSite === "cross-site" || secFetchSite === "none") {
    return forbidden();
  }

  const host = request.headers.get("host");
  const source = request.headers.get("origin") ?? request.headers.get("referer");
  if (host && source) {
    try {
      if (new URL(source).host === host) return null;
    } catch {
      // malformed — fall through to reject
    }
  }
  return forbidden();
}

/**
 * Gate for the data APIs:
 *  1. Reject automation/script user agents (all environments).
 *  2. Require a valid HMAC-signed session cookie (the real access control).
 *  3. Production-only origin check (defense-in-depth).
 *
 * Note: a browser viewer must hand bytes to the browser, so an authenticated
 * real user can still extract data they can see; stealth automation that forges
 * a browser UA + has a valid session can also pass. See README "Security".
 */
export function guardApiRequest(request: Request): Response | null {
  if (isAutomatedUserAgent(request)) return forbidden();
  if (!isAuthenticated(request)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "cache-control": "no-store" },
    });
  }
  return enforceBrowserOrigin(request);
}

function forbidden(): Response {
  return new Response(
    "Forbidden: datasets may only be accessed through the web viewer.",
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}
