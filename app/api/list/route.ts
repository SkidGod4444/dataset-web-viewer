import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { r2, R2_BUCKET, r2Configured } from "@/lib/r2";
import { guardApiRequest } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;

  if (!r2Configured) {
    return NextResponse.json(
      { error: "R2 is not configured. Set R2_* env vars in .env.local." },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const prefix = searchParams.get("prefix") ?? "";
  const token = searchParams.get("token") ?? undefined;
  const recursive = searchParams.get("recursive") === "1";

  try {
    const res = await r2.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
        // Without a delimiter we get every key under the prefix (recursive).
        Delimiter: recursive ? undefined : "/",
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );

    const folders = (res.CommonPrefixes ?? [])
      .map((p) => p.Prefix)
      .filter((p): p is string => Boolean(p));

    const files = (res.Contents ?? [])
      // Skip the zero-byte placeholder object some tools create for "folders".
      .filter((o) => o.Key && o.Key !== prefix && !o.Key.endsWith("/"))
      .map((o) => ({
        key: o.Key as string,
        size: o.Size ?? 0,
        lastModified: o.LastModified?.toISOString() ?? null,
      }));

    return NextResponse.json({
      prefix,
      folders,
      files,
      nextToken: res.IsTruncated ? (res.NextContinuationToken ?? null) : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list bucket";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
