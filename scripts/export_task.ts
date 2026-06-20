/**
 * Batch exporter: human takes for ONE task -> clean, robot-ready trajectories (.npy).
 *
 *   bun scripts/export_task.ts [TASK_SUBSTR] [--limit N] [--offset N]
 *                              [--hand right|left|both] [--concurrency N] [--out DIR]
 *
 * Default task: PICK_SMALL_OBJECTS. Capped + resumable + concurrent (each source JSON
 * is ~31 MB, and a task has thousands of takes — don't download them all blindly).
 *
 * Per take it emits a float32 array of shape (T, 17), columns:
 *   0        t                      seconds from first kept frame
 *   1..3     R_pos (x,y,z)          right wrist position, anchored (m), world Y = up (gravity)
 *   4..7     R_quat (x,y,z,w)       right wrist orientation
 *   8        R_grasp                1 = closed, 0 = open (hysteresis on thumb-index aperture)
 *   9..11    L_pos (x,y,z)          left wrist position, anchored (m)
 *   12..15   L_quat (x,y,z,w)       left wrist orientation
 *   16       L_grasp                1 = closed, 0 = open
 * Missing hand in a frame -> that hand's 8 columns are NaN.
 *
 * Output: <out>/<TASK>/traj/<EPISODE>.npy  +  manifest.jsonl  +  summary.json
 */
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { mkdir } from "node:fs/promises";

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

// ---- args ----
const argv = process.argv.slice(2);
function flag(name: string, def: string): string {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const TASK = (argv[0] && !argv[0].startsWith("--") ? argv[0] : "PICK_SMALL_OBJECTS").toUpperCase();
const LIMIT = parseInt(flag("limit", "50"), 10);
const OFFSET = parseInt(flag("offset", "0"), 10);
const HAND = flag("hand", "both") as "right" | "left" | "both";
const CONCURRENCY = parseInt(flag("concurrency", "6"), 10);
const OUT = flag("out", "openarm-policy/data");

// ---- QA + grasp tuning ----
const CLOSE_TH = 0.03; // grasp closes when aperture < 3 cm
const OPEN_TH = 0.05; //  grasp opens  when aperture > 5 cm  (hysteresis band)
const SMOOTH_W = 3; //     moving-average window on aperture
const MIN_KEPT_FRAMES = 60; // >= 2 s @ 30 fps
const MIN_DOMINANT_RATIO = 0.5; // dominant hand present in >= 50% of kept frames
const MIN_GRASPS = 1; // a pick must close the gripper at least once

// MANO/MediaPipe 21-keypoint indices
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
type Vec3 = [number, number, number];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function normalize3(a: Vec3): Vec3 | null {
  const n = norm(a);
  return n > 1e-9 ? [a[0] / n, a[1] / n, a[2] / n] : null;
}
function normQuat(q: [number, number, number, number]): [number, number, number, number] {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return n > 1e-9 ? [q[0] / n, q[1] / n, q[2] / n, q[3] / n] : [0, 0, 0, 1];
}

function mat2quat(m: number[][]): [number, number, number, number] {
  const [m00, m01, m02] = m[0], [m10, m11, m12] = m[1], [m20, m21, m22] = m[2];
  const tr = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  return [x, y, z, w];
}
/**
 * EEF pose from hand keypoints (all in one consistent world frame):
 *   position    = wrist keypoint (kp[0])
 *   orientation = hand frame: +Z wrist->middle_mcp, +Y palm normal, +X sideways.
 * Returns null if keypoints are degenerate (collinear / missing) — that frame's hand
 * becomes NaN downstream. We deliberately avoid wrist_pose_world: its translation lives
 * in a different frame than the keypoints and it is non-orthonormal in glitchy frames.
 */
function poseFromKeypoints(kp: number[][]): { pos: Vec3; quat: [number, number, number, number] } | null {
  if (!kp || kp.length <= MIDDLE_MCP) return null;
  const w = kp[WRIST] as Vec3, im = kp[INDEX_MCP] as Vec3, mm = kp[MIDDLE_MCP] as Vec3;
  if (!w || !im || !mm) return null;
  const fwd = normalize3(sub(mm, w)); // +Z along the hand
  if (!fwd) return null;
  const up = normalize3(cross(fwd, sub(im, w))); // +Y palm normal
  if (!up) return null;
  const side = cross(up, fwd); // +X (already unit: up⊥fwd, both unit)
  const R = [
    [side[0], up[0], fwd[0]],
    [side[1], up[1], fwd[1]],
    [side[2], up[2], fwd[2]],
  ];
  return { pos: w, quat: normQuat(mat2quat(R)) };
}

/** Schmitt-trigger grasp on a (smoothed) aperture series -> boolean closed. */
function hysteresisGrasp(aperture: (number | null)[]): (boolean | null)[] {
  const sm = aperture.map((_, i) => {
    const w = aperture.slice(Math.max(0, i - (SMOOTH_W - 1)), i + 1).filter((v): v is number => v != null);
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
  });
  let closed = false;
  return sm.map((a) => {
    if (a == null) return null;
    if (closed ? a > OPEN_TH : a < CLOSE_TH) closed = !closed;
    return closed;
  });
}

// ---- minimal .npy (v1.0, little-endian float32) writer ----
function encodeNpy(rows: number[][]): Uint8Array {
  const T = rows.length, D = T ? rows[0].length : 0;
  const dv = new DataView(new ArrayBuffer(T * D * 4));
  let o = 0;
  for (const r of rows) for (const v of r) { dv.setFloat32(o, v, true); o += 4; }
  let header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${T}, ${D}), }`;
  const pad = (64 - ((10 + header.length + 1) % 64)) % 64;
  header += " ".repeat(pad) + "\n";
  const hb = new TextEncoder().encode(header);
  const buf = new Uint8Array(10 + hb.length + dv.byteLength);
  buf.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0], 0); // \x93NUMPY v1.0
  buf[8] = hb.length & 0xff; buf[9] = (hb.length >> 8) & 0xff;
  buf.set(hb, 10);
  buf.set(new Uint8Array(dv.buffer), 10 + hb.length);
  return buf;
}
function verifyNpy(bytes: Uint8Array): string {
  const magic = String.fromCharCode(...bytes.slice(1, 6));
  const hlen = bytes[8] | (bytes[9] << 8);
  const header = new TextDecoder().decode(bytes.slice(10, 10 + hlen));
  const m = header.match(/'shape':\s*\((\d+),\s*(\d+)\)/);
  return `magic=${magic} shape=(${m?.[1]},${m?.[2]}) bytes=${bytes.length}`;
}

async function listEpisodes(): Promise<string[]> {
  const dates: string[] = [];
  let tok: string | undefined;
  do {
    const o = await r2.send(new ListObjectsV2Command({ Bucket, Prefix: "metavision/", Delimiter: "/", ContinuationToken: tok }));
    for (const p of o.CommonPrefixes ?? []) dates.push(p.Prefix!);
    tok = o.IsTruncated ? o.NextContinuationToken : undefined;
  } while (tok);

  const eps: string[] = [];
  for (const d of dates) {
    let t: string | undefined;
    do {
      const o = await r2.send(new ListObjectsV2Command({ Bucket, Prefix: d, Delimiter: "/", ContinuationToken: t }));
      for (const p of o.CommonPrefixes ?? []) if (p.Prefix!.toUpperCase().includes(TASK)) eps.push(p.Prefix!);
      t = o.IsTruncated ? o.NextContinuationToken : undefined;
    } while (t);
  }
  return eps.sort();
}

type Row = { episode: string; status: string; reason?: string; subject?: string; date?: string;
  frames?: number; kept?: number; duration?: number; dom?: string; grasps?: number; dup?: number; anchor?: number[] };

async function processEpisode(ep: string, outDir: string): Promise<Row> {
  const name = ep.split("/").filter(Boolean).pop()!;
  const m = name.match(/_(S\d+)_(\d{8})_/);
  const base: Row = { episode: name, status: "ok", subject: m?.[1], date: m?.[2] };
  const outPath = `${outDir}/traj/${name}.npy`;
  if (await Bun.file(outPath).exists()) return { ...base, status: "skipped" };

  const key = ep + "PRIMARY/unified_hand_tracking_complete_v2.json";
  const res = await r2.send(new GetObjectCommand({ Bucket, Key: key }));
  const doc = JSON.parse(await res.Body!.transformToString());
  const frames: any[] = doc.frames ?? [];

  // Build per-frame records (union timeline; keep frame if tracking ok & >=1 hand)
  type FR = { t: number; R: any; L: any; Rap: number | null; Lap: number | null };
  const recs: FR[] = [];
  for (const f of frames) {
    if (f.camera_tracking_state && f.camera_tracking_state !== "normal") continue;
    const grab = (h: any) => {
      if (!h) return { pose: null, ap: null as number | null };
      const kp = h.hand_keypoints_3d_world;
      if (!kp || kp.length <= INDEX_TIP) return { pose: null, ap: null };
      const pose = poseFromKeypoints(kp);
      const ap = norm(sub(kp[THUMB_TIP] as Vec3, kp[INDEX_TIP] as Vec3));
      return { pose, ap };
    };
    const R = grab(f.right_hand), L = grab(f.left_hand);
    if (!R.pose && !L.pose) continue;
    recs.push({ t: f.timestamp, R: R.pose, L: L.pose, Rap: R.ap, Lap: L.ap });
  }
  if (recs.length < MIN_KEPT_FRAMES) return { ...base, status: "rejected", reason: `too short (${recs.length}f)`, frames: frames.length, kept: recs.length };

  // grasp via hysteresis, per hand
  const Rgrasp = hysteresisGrasp(recs.map((r) => r.Rap));
  const Lgrasp = hysteresisGrasp(recs.map((r) => r.Lap));
  const countFlips = (g: (boolean | null)[]) => { let n = 0; for (let i = 1; i < g.length; i++) if (g[i] != null && g[i - 1] != null && g[i] !== g[i - 1]) n++; return n; };
  const Rpresent = recs.filter((r) => r.R).length, Lpresent = recs.filter((r) => r.L).length;
  const dom = Rpresent >= Lpresent ? "right" : "left";
  const domPresent = dom === "right" ? Rpresent : Lpresent;
  const domGraspFlips = dom === "right" ? countFlips(Rgrasp) : countFlips(Lgrasp);
  if (domPresent / recs.length < MIN_DOMINANT_RATIO) return { ...base, status: "rejected", reason: "dominant hand too sparse", kept: recs.length, dom };
  if (domGraspFlips < MIN_GRASPS) return { ...base, status: "rejected", reason: "no grasp event", kept: recs.length, dom, grasps: domGraspFlips };

  // anchor: subtract dominant hand's first valid wrist position from all positions
  const anchorRec = recs.find((r) => (dom === "right" ? r.R : r.L));
  const anchor = (dom === "right" ? anchorRec!.R.pos : anchorRec!.L.pos) as Vec3;
  const t0 = recs[0].t;
  const NaNv = NaN;
  const DUP_EPS = 0.03; // both wrists < 3 cm apart = duplicate-detection glitch (early frames)
  const hand = (pose: any, grasp: boolean | null) =>
    pose
      ? [pose.pos[0] - anchor[0], pose.pos[1] - anchor[1], pose.pos[2] - anchor[2], ...pose.quat, grasp ? 1 : 0]
      : [NaNv, NaNv, NaNv, NaNv, NaNv, NaNv, NaNv, NaNv];
  let dupFrames = 0;
  const rows: number[][] = recs.map((r, i) => {
    let R = r.R, L = r.L;
    let rg: boolean | null = Rgrasp[i], lg: boolean | null = Lgrasp[i];
    if (R && L && norm(sub(R.pos as Vec3, L.pos as Vec3)) < DUP_EPS) {
      dupFrames++;
      if (dom === "right") { L = null; lg = null; } else { R = null; rg = null; }
    }
    return [r.t - t0, ...hand(R, rg), ...hand(L, lg)];
  });

  const npy = encodeNpy(rows);
  await Bun.write(outPath, npy);
  return { ...base, frames: frames.length, kept: recs.length, duration: +(recs[recs.length - 1].t - t0).toFixed(1), dom, grasps: domGraspFlips, dup: dupFrames, anchor: anchor.map((v) => +v.toFixed(4)) };
}

async function pool<T, R>(items: T[], n: number, worker: (it: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function run() { while (idx < items.length) { const i = idx++; out[i] = await worker(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
  return out;
}

async function main() {
  const outDir = `${OUT}/${TASK}`;
  await mkdir(`${outDir}/traj`, { recursive: true });
  console.log(`Task=${TASK}  hand=${HAND}  limit=${LIMIT} offset=${OFFSET} conc=${CONCURRENCY}\nDiscovering episodes…`);
  const all = await listEpisodes();
  const slice = all.slice(OFFSET, OFFSET + LIMIT);
  console.log(`Found ${all.length} ${TASK} takes total. Processing ${slice.length} (offset ${OFFSET}).`);

  let done = 0;
  const rows = await pool(slice, CONCURRENCY, async (ep) => {
    const row = await processEpisode(ep, outDir).catch((e) => ({ episode: ep, status: "error", reason: String(e?.message ?? e) } as Row));
    done++;
    if (done % 5 === 0 || done === slice.length) process.stdout.write(`\r  ${done}/${slice.length} processed`);
    return row;
  });
  process.stdout.write("\n");

  const by = (s: string) => rows.filter((r) => r.status === s).length;
  const okRows = rows.filter((r) => r.status === "ok");
  const summary = {
    task: TASK, generated_from: "metavision human hand dataset", columns: ["t", "R_pos*3", "R_quat*4", "R_grasp", "L_pos*3", "L_quat*4", "L_grasp"],
    total_found: all.length, attempted: slice.length, ok: by("ok"), skipped: by("skipped"), rejected: by("rejected"), error: by("error"),
    rejects: rows.filter((r) => r.status === "rejected").reduce((acc: Record<string, number>, r) => ((acc[r.reason ?? "?"] = (acc[r.reason ?? "?"] ?? 0) + 1), acc), {}),
    subjects: [...new Set(okRows.map((r) => r.subject).filter(Boolean))].sort(),
    median_duration_s: okRows.length ? okRows.map((r) => r.duration!).sort((a, b) => a - b)[Math.floor(okRows.length / 2)] : 0,
    dominant_hand: { right: okRows.filter((r) => r.dom === "right").length, left: okRows.filter((r) => r.dom === "left").length },
  };
  await Bun.write(`${outDir}/manifest.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  await Bun.write(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));

  console.log(`\n=== SUMMARY (${TASK}) ===`);
  console.log(JSON.stringify(summary, null, 2));
  if (okRows.length) {
    const first = `${outDir}/traj/${okRows[0].episode}.npy`;
    console.log(`\nnpy self-check (${okRows[0].episode}): ${verifyNpy(new Uint8Array(await Bun.file(first).arrayBuffer()))}`);
    console.log(`Wrote ${okRows.length} trajectories -> ${outDir}/traj/`);
  }
}

main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
