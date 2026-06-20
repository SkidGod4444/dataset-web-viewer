import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
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
async function get(key: string, n: number) {
  const r = await r2.send(
    new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${n}` }),
  );
  return await r.Body!.transformToString();
}
console.log("===== unified_hand_tracking_complete_v2.json (first 3800 chars) =====");
console.log(await get(EP + "unified_hand_tracking_complete_v2.json", 3800));
console.log("\n===== depth_metadata.json (first 1400) =====");
console.log(await get(EP + "depth_metadata.json", 1400));
console.log("\n===== motion_data.json (first 1200) =====");
console.log(await get(EP + "motion_data.json", 1200));
