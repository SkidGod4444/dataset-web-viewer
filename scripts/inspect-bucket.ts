import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
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

async function listDelim(prefix: string) {
  const out = await r2.send(
    new ListObjectsV2Command({
      Bucket,
      Prefix: prefix,
      Delimiter: "/",
      MaxKeys: 1000,
    }),
  );
  return {
    folders: (out.CommonPrefixes ?? []).map((p) => p.Prefix!),
    files: (out.Contents ?? []).map((c) => ({ key: c.Key!, size: c.Size! })),
  };
}

function fmt(n: number) {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)}${u[i]}`;
}

async function main() {
  console.log(`\n=== ROOT of ${Bucket} ===`);
  const root = await listDelim("");
  console.log("Top-level folders:");
  for (const f of root.folders) console.log("  📁", f);
  console.log("Top-level files:");
  for (const f of root.files) console.log("  📄", f.key, fmt(f.size));

  // Recurse one level into each top folder
  for (const folder of root.folders.slice(0, 12)) {
    console.log(`\n--- ${folder} ---`);
    const lvl = await listDelim(folder);
    for (const f of lvl.folders.slice(0, 15)) console.log("  📁", f);
    for (const f of lvl.files.slice(0, 15))
      console.log("  📄", f.key, fmt(f.size));
    if (lvl.folders.length > 15)
      console.log(`  …(+${lvl.folders.length - 15} more folders)`);
    if (lvl.files.length > 15)
      console.log(`  …(+${lvl.files.length - 15} more files)`);

    // Go one more level into the first subfolder, to reveal structure
    if (lvl.folders[0]) {
      const sub = await listDelim(lvl.folders[0]);
      console.log(`     ↳ inside ${lvl.folders[0]}:`);
      for (const f of sub.folders.slice(0, 8)) console.log("       📁", f);
      for (const f of sub.files.slice(0, 8))
        console.log("       📄", f.key, fmt(f.size));
    }
  }

  // Hunt for LeRobot/standard markers anywhere near the top
  console.log(`\n=== Format markers (searching first 1000 keys) ===`);
  const flat = await r2.send(
    new ListObjectsV2Command({ Bucket, MaxKeys: 1000 }),
  );
  const keys = (flat.Contents ?? []).map((c) => c.Key!);
  const markers = [
    "info.json",
    "episodes",
    "tasks.jsonl",
    "stats.json",
    "modality.json",
    "meta/",
    ".parquet",
    ".mp4",
    ".hdf5",
    ".h5",
    "data/chunk",
    "videos/chunk",
  ];
  for (const m of markers) {
    const hits = keys.filter((k) => k.includes(m));
    if (hits.length)
      console.log(
        `  [${m}] ×${hits.length}  e.g. ${hits.slice(0, 3).join(" , ")}`,
      );
  }
  console.log(`\nSample of first 20 keys overall:`);
  for (const k of keys.slice(0, 20)) console.log("   ", k);
}

main().catch((e) => {
  console.error("ERROR:", e?.message ?? e);
  process.exit(1);
});
