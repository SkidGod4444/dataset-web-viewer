import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? process.env.R2_ACCESS_KEY ?? "",
    secretAccessKey:
      process.env.R2_SECRET_ACCESS_KEY ?? process.env.R2_SECRET ?? "",
  },
});
const Bucket = process.env.R2_BUCKET!;

const EP =
  "metavision/2026-04-16/AW001_OPEN_CLOSE_WATER_BOTTLE_S008_16042026_10_010/PRIMARY/";

async function get(key: string, maxBytes?: number): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket,
    Key: key,
    ...(maxBytes ? { Range: `bytes=0-${maxBytes}` } : {}),
  });
  const r = await r2.send(cmd);
  return await r.Body!.transformToString();
}

async function sizeOf(key: string) {
  const r = await r2.send(
    new ListObjectsV2Command({ Bucket, Prefix: key, MaxKeys: 1 }),
  );
  return r.Contents?.[0]?.Size ?? 0;
}

function trunc(s: string, n = 1600) {
  return s.length > n ? s.slice(0, n) + `\n…[truncated ${s.length} chars]` : s;
}

async function main() {
  // List all files in the episode with sizes
  console.log("=== Files in episode (with sizes) ===");
  const ls = await r2.send(
    new ListObjectsV2Command({ Bucket, Prefix: EP, MaxKeys: 50 }),
  );
  for (const c of ls.Contents ?? [])
    console.log(`  ${(c.Size! / 1024).toFixed(1)}KB  ${c.Key}`);

  const smallJsons = [
    "recording_metadata.json",
    "ar_session.json",
    "hands_metadata.json",
    "depth_metadata.json",
    "motion_data.json",
    "video_timestamps.json",
  ];
  for (const name of smallJsons) {
    console.log(`\n===== ${name} =====`);
    try {
      const sz = await sizeOf(EP + name);
      const body = await get(EP + name, sz > 4000 ? 4000 : undefined);
      console.log(trunc(body));
    } catch (e: any) {
      console.log("  (error)", e?.message);
    }
  }

  // The big unified hand tracking — just the head
  console.log(`\n===== unified_hand_tracking_complete_v2.json (head) =====`);
  try {
    const body = await get(EP + "unified_hand_tracking_complete_v2.json", 3000);
    console.log(trunc(body, 3000));
  } catch (e: any) {
    console.log("  (error)", e?.message);
  }
}

main().catch((e) => {
  console.error("ERROR:", e?.message ?? e);
  process.exit(1);
});
