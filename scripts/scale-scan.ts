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

async function listAll(prefix: string, delimiter = "/") {
  let token: string | undefined;
  const folders: string[] = [];
  const files: { key: string; size: number }[] = [];
  do {
    const out = await r2.send(
      new ListObjectsV2Command({
        Bucket,
        Prefix: prefix,
        Delimiter: delimiter,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const p of out.CommonPrefixes ?? []) folders.push(p.Prefix!);
    for (const c of out.Contents ?? [])
      files.push({ key: c.Key!, size: c.Size! });
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return { folders, files };
}

async function main() {
  const { folders: dates } = await listAll("metavision/");
  console.log(`Date folders: ${dates.length}`);
  console.log(
    `  span: ${dates[0]?.split("/")[1]} → ${dates[dates.length - 1]?.split("/")[1]}`,
  );

  const taskCount = new Map<string, number>();
  const subjects = new Set<string>();
  let totalEpisodes = 0;

  for (const d of dates) {
    const { folders: eps } = await listAll(d);
    totalEpisodes += eps.length;
    for (const ep of eps) {
      const name = ep.split("/").filter(Boolean).pop()!;
      // AW001_OPEN_CLOSE_WATER_BOTTLE_S008_16042026_10_010
      const taskMatch = name.match(/^([A-Z]+\d+)_(.+?)_(S\d+)_/);
      if (taskMatch) {
        const code = `${taskMatch[1]} ${taskMatch[2]}`;
        taskCount.set(code, (taskCount.get(code) ?? 0) + 1);
        subjects.add(taskMatch[3]);
      } else {
        taskCount.set("UNPARSED:" + name.slice(0, 30), 1);
      }
    }
  }

  console.log(`\nTotal episodes (takes): ${totalEpisodes}`);
  console.log(`Distinct subjects: ${subjects.size} → ${[...subjects].sort().join(", ")}`);
  console.log(`\nTasks (${taskCount.size}) by #takes:`);
  for (const [t, n] of [...taskCount.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(5)}  ${t}`);

  // crude size estimate: sample one episode's total bytes × episodes
  const sampleEp =
    "metavision/2026-04-16/AW001_OPEN_CLOSE_WATER_BOTTLE_S008_16042026_10_010/";
  const { files } = await listAll(sampleEp, "ZZZNODELIM");
  const epBytes = files.reduce((a, f) => a + f.size, 0);
  console.log(
    `\nSample episode size: ${(epBytes / 1024 / 1024).toFixed(1)}MB across ${files.length} files`,
  );
  console.log(
    `Rough dataset size estimate: ${((epBytes * totalEpisodes) / 1024 / 1024 / 1024).toFixed(0)}GB (≈ ${totalEpisodes} × sample)`,
  );
}

main().catch((e) => {
  console.error("ERROR:", e?.message ?? e);
  process.exit(1);
});
