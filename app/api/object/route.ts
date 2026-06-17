import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { r2, R2_BUCKET, r2Configured } from "@/lib/r2";
import { guardApiRequest } from "@/lib/guard";
import { basename } from "@/lib/format";
import { mimeOf } from "@/lib/mime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams a single object from R2. Supports:
 *  - ?head=<bytes>  : only the first N bytes (used for capped text previews)
 *  - Range header   : standard HTTP range requests (media seeking)
 *  - ?download=1    : forces a download with the original filename
 */
export async function GET(request: Request) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;

  if (!r2Configured) {
    return new Response("R2 is not configured.", { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!key) return new Response("Missing 'key'", { status: 400 });

  const head = searchParams.get("head");
  const download = searchParams.get("download") === "1";

  let range: string | undefined;
  if (head) {
    const n = Math.max(1, parseInt(head, 10) || 0);
    range = `bytes=0-${n - 1}`;
  } else {
    range = request.headers.get("range") ?? undefined;
  }

  try {
    const res = await r2.send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: key, Range: range }),
    );

    const headers = new Headers();
    // Prefer our extension-based type so images/PDFs render even when R2 has
    // stored them as application/octet-stream.
    const guessed = mimeOf(key);
    headers.set(
      "Content-Type",
      guessed !== "application/octet-stream"
        ? guessed
        : (res.ContentType ?? "application/octet-stream"),
    );
    headers.set("Accept-Ranges", "bytes");
    if (res.ContentLength != null)
      headers.set("Content-Length", String(res.ContentLength));
    if (res.ContentRange) headers.set("Content-Range", res.ContentRange);
    if (download)
      headers.set(
        "Content-Disposition",
        `attachment; filename="${basename(key)}"`,
      );

    const body = res.Body as Readable | undefined;
    const stream = body
      ? (body as unknown as { transformToWebStream: () => ReadableStream })
          .transformToWebStream()
      : null;

    return new Response(stream, {
      status: range ? 206 : 200,
      headers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch object";
    return new Response(message, { status: 500 });
  }
}
