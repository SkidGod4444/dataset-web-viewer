import { HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { r2, R2_BUCKET, r2Configured } from "@/lib/r2";
import { guardApiRequest } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;

  if (!r2Configured) {
    return NextResponse.json({ error: "R2 is not configured." }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const prefix = searchParams.get("prefix");

  try {
    // --- Folder: immediate contents only (a single, fast delimiter call).
    // We deliberately do NOT walk the whole subtree — for large buckets that
    // means hundreds of LIST calls and many seconds. Users navigate in instead.
    if (prefix !== null) {
      const res = await r2.send(
        new ListObjectsV2Command({
          Bucket: R2_BUCKET,
          Prefix: prefix,
          Delimiter: "/",
          MaxKeys: 1000,
        }),
      );

      let immediateFileCount = 0;
      let immediateFileSize = 0;
      for (const o of res.Contents ?? []) {
        if (o.Key && o.Key !== prefix && !o.Key.endsWith("/")) {
          immediateFileCount += 1;
          immediateFileSize += o.Size ?? 0;
        }
      }

      return NextResponse.json({
        type: "folder",
        prefix,
        subfolderCount: (res.CommonPrefixes ?? []).length,
        immediateFileCount,
        immediateFileSize,
        hasMore: Boolean(res.IsTruncated),
      });
    }

    // --- File: HEAD for stored content-type, etag, storage class, metadata ---
    if (!key) {
      return NextResponse.json({ error: "Missing 'key' or 'prefix'" }, { status: 400 });
    }

    const res = await r2.send(
      new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    );

    return NextResponse.json({
      type: "file",
      key,
      size: res.ContentLength ?? 0,
      lastModified: res.LastModified?.toISOString() ?? null,
      contentType: res.ContentType ?? null,
      etag: res.ETag ? res.ETag.replace(/"/g, "") : null,
      storageClass: res.StorageClass ?? null,
      metadata: res.Metadata ?? {},
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load info";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
