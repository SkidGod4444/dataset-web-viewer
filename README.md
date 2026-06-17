# Dataset Viewer

A no-login web app for browsing and previewing datasets stored in a
**Cloudflare R2** bucket. Built with Next.js (App Router) + bun.

Cloudflare R2 is S3-compatible, so this talks to it directly with the AWS S3
SDK — no third-party service, no account, no auth wall. Credentials live in
`.env.local` and are only ever used on the server; the browser never sees them.

Built with [shadcn/ui](https://ui.shadcn.com) components (base-nova style on
Base UI) and Tailwind v4, with a light / dark / system theme toggle powered by
[`next-themes`](https://github.com/pacocoursey/next-themes).

## Features

- **Light, dark, and system themes** with a toggle in the header (no flash on
  load; all colors are driven by shadcn design tokens).
- **Folder navigation** with breadcrumbs (S3 delimiter-based listing).
- **Recursive search** across all subfolders + client-side filter.
- **Format-aware previews:**
  - Tables for `csv`, `tsv`, `json` (arrays), `jsonl`/`ndjson`, and `parquet`
  - Images, PDF, audio, and video (with range-based seeking)
  - Pretty-printed JSON objects and raw text/markdown/yaml/log
  - Download for any file type
- **Parquet** is read server-side via [`hyparquet`](https://github.com/hyparam/hyparquet)
  using HTTP range reads, so only the footer and needed row groups are fetched
  (not the whole file), with paging through row groups.
- Large text files are capped to the first 2 MB for preview.

## Setup

```bash
bun install
cp .env.example .env.local   # then fill in your R2 credentials
bun run dev                  # http://localhost:3000
```

### Environment variables (`.env.local`)

| Variable                | Description                                            |
| ----------------------- | ------------------------------------------------------ |
| `R2_ENDPOINT`           | `https://<account-id>.r2.cloudflarestorage.com`        |
| `R2_ACCESS_KEY_ID`      | R2 API token access key id                             |
| `R2_SECRET_ACCESS_KEY`  | R2 API token secret access key                         |
| `R2_BUCKET`             | Bucket name to browse                                  |
| `NEXT_PUBLIC_R2_BUCKET` | (optional) bucket name shown in the UI breadcrumb      |

## Architecture

```
app/
  layout.tsx            # ThemeProvider (next-themes) + fonts
  page.tsx              # layout: header + breadcrumbs + sidebar + preview
  api/
    list/route.ts       # ListObjectsV2 (delimiter = folders, recursive = flat)
    object/route.ts     # streams an object; supports ?head=N and HTTP Range
    parquet/route.ts    # reads parquet rows via range-backed AsyncBuffer
components/
  theme-provider.tsx    # next-themes wrapper
  mode-toggle.tsx       # light/dark toggle button
  FileBrowser.tsx       # sidebar: folders, files, filter, recursive, paging
  Preview.tsx           # picks a renderer based on file category
  DataTable.tsx         # sticky-header table for tabular data
  ui/                   # shadcn/ui primitives (button, input, badge, …)
lib/
  r2.ts                 # S3 client pointed at R2
  mime.ts               # extension -> category / content-type
  utils.ts              # cn() class helper
  format.ts, types.ts   # helpers and shared types
```

All API routes run on the Node.js runtime (`export const runtime = "nodejs"`)
because the AWS SDK and parquet reader need Node APIs.

## Security

R2 credentials live in `.env.local` (git-ignored) and are **only ever used
server-side** — they never reach the browser, so the network tab only shows
calls to this app's own `/api/*` routes, never the keys.

What is enforced:

- **Shared-password access gate (the real control)** — opening the app requires
  `APP_PASSWORD`. On success the server sets an **httpOnly, SameSite=Strict,
  HMAC-signed** session cookie (`lib/auth.ts`); every data route requires it
  (`lib/guard.ts`). The cookie can't be forged without `AUTH_SECRET`, so
  `curl`/scripts without a real login get **401**. The login endpoint itself is
  origin-checked in production to blunt brute-forcing.
- **API origin guard (production, defense-in-depth)** — even with a cookie,
  requests to `/api/*` must carry browser fetch metadata (`Sec-Fetch-Site` /
  `Origin` / `Referer`), so a leaked cookie replayed by a script still gets 403.
- **Password-gated downloads** — the Download button requires a password.
- **Production inspection deterrents** — `ProductionGuard` disables the context
  menu and common DevTools shortcuts.

Set `APP_PASSWORD` and a random `AUTH_SECRET` (`openssl rand -base64 48`) in
`.env.local`. Use the lock icon in the header to log out.

### What this can and cannot do

The password gate stops **anonymous and scripted access** — no login, no data.
It is still **not absolute**:

- DevTools / the network tab run on the user's machine and cannot truly be
  blocked (disable JS, use a proxy like mitmproxy, etc.).
- A browser viewer must hand the bytes to the browser, so **a logged-in user can
  still extract data they can see**; the download password is a client-side check.

To go further for premium data: **per-user authentication + authorization**
(instead of one shared password), **private networking / IP allow-listing**,
**short-lived signed object URLs**, **rate limiting**, and **audit logging**.

If a key was ever shared in plaintext (e.g. pasted into chat), rotate it in the
Cloudflare dashboard (R2 → Manage R2 API Tokens).
