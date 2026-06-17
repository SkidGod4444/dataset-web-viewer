import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { parquetMetadataAsync, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { r2, R2_BUCKET, r2Configured } from "@/lib/r2";
import { guardApiRequest } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Convert values hyparquet may return that JSON can't serialize directly. */
function serialize(value: unknown): unknown {
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value.toString();
  }
  if (value instanceof Uint8Array) {
    const hex = Buffer.from(value.subarray(0, 32)).toString("hex");
    return `0x${hex}${value.length > 32 ? "…" : ""}`;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
    return out;
  }
  return value;
}

export async function GET(request: Request) {
  const blocked = guardApiRequest(request);
  if (blocked) return blocked;

  if (!r2Configured) {
    return NextResponse.json({ error: "R2 is not configured." }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!key) return NextResponse.json({ error: "Missing 'key'" }, { status: 400 });

  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") ?? "100", 10)));
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10));

  try {
    const headRes = await r2.send(
      new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    );
    const byteLength = headRes.ContentLength ?? 0;

    // AsyncBuffer backed by HTTP range reads so we only download the footer
    // and the row groups we actually need — not the whole file.
    const file = {
      byteLength,
      async slice(start: number, end?: number): Promise<ArrayBuffer> {
        const last = (end ?? byteLength) - 1;
        const res = await r2.send(
          new GetObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
            Range: `bytes=${start}-${last}`,
          }),
        );
        const bytes = await (
          res.Body as unknown as {
            transformToByteArray: () => Promise<Uint8Array>;
          }
        ).transformToByteArray();
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
      },
    };

    const metadata = await parquetMetadataAsync(file);
    const totalRows = Number(metadata.num_rows);
    const rowStart = Math.min(offset, totalRows);
    const rowEnd = Math.min(offset + limit, totalRows);

    const rawRows = await parquetReadObjects({
      file,
      metadata,
      compressors,
      rowStart,
      rowEnd,
    });

    const rows = rawRows.map((r) => serialize(r) as Record<string, unknown>);
    const columns = Array.from(
      rows.reduce<Set<string>>((set, row) => {
        Object.keys(row).forEach((k) => set.add(k));
        return set;
      }, new Set()),
    );

    return NextResponse.json({
      columns,
      rows,
      totalRows,
      truncated: totalRows > rows.length,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to read parquet file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
