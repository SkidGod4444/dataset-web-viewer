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
const EPROOT =
  "metavision/2026-04-16/AW001_OPEN_CLOSE_WATER_BOTTLE_S008_16042026_10_010/";

async function main() {
  // Are there multiple views (PRIMARY / SECONDARY / ...)?
  const lvl = await r2.send(
    new ListObjectsV2Command({
      Bucket,
      Prefix: EPROOT,
      Delimiter: "/",
      MaxKeys: 50,
    }),
  );
  console.log("Subfolders inside one episode:");
  for (const p of lvl.CommonPrefixes ?? []) console.log("  ", p.Prefix);
  for (const c of lvl.Contents ?? []) console.log("   (file)", c.Key);

  // Look for "_3d" / world keypoints by scanning a middle slice of the unified file
  const r = await r2.send(
    new GetObjectCommand({
      Bucket,
      Key: EPROOT + "PRIMARY/unified_hand_tracking_complete_v2.json",
      Range: `bytes=4000-12000`,
    }),
  );
  const txt = await r.Body!.transformToString();
  // print key names that show up
  const keys = new Set<string>();
  for (const m of txt.matchAll(/"([a-z_0-9]+)"\s*:/gi)) keys.add(m[1]);
  console.log("\nField names seen in hand-tracking frame body:");
  console.log("  ", [...keys].join(", "));
  // show a window that likely contains 3d keypoints
  const idx = txt.search(/3d|world|_3d|keypoints_3d|metric/i);
  console.log("\nWindow around first 3D/world mention:");
  console.log(idx >= 0 ? txt.slice(idx - 80, idx + 600) : "(none found in window)");
}
main().catch((e) => console.error("ERROR:", e?.message ?? e));
