import { isAuthenticated } from "./auth";

/**
 * Production-only origin check (defense-in-depth). Browsers attach fetch
 * metadata (`Sec-Fetch-Site`) and an `Origin`/`Referer` on same-origin
 * requests; command-line tools and bots don't. Returns a 403 Response when the
 * request doesn't look like it came from our own pages, else null.
 *
 * Used both to gate data routes and to blunt curl brute-forcing of the login.
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
 *  1. Authentication (always): a valid HMAC-signed session cookie is required.
 *     httpOnly + SameSite=Strict and unforgeable without the server secret, so
 *     `curl`/scripts without a real login get 401 — the actual access control.
 *  2. Origin check (production only): defense-in-depth on top of the cookie.
 *
 * Note: a browser viewer must hand bytes to the browser, so an authenticated
 * user can still extract data they can see. See README "Security".
 */
export function guardApiRequest(request: Request): Response | null {
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
