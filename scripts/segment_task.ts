/**
 * Step 1.5: split long multi-repetition takes into individual pick cycles.
 *
 *   bun scripts/segment_task.ts [TASK_SUBSTR] [--in DIR] [--pre S] [--post S]
 *
 * Reads the (T,17) trajectories from Step 1 (export_task.ts) and cuts each take into
 * one episode per grasp cycle (reach -> close -> transport -> open -> retract), using the
 * dominant hand's grasp column. Each segment is re-anchored to its own start (dominant
 * hand at origin, t reset to 0) so every training episode is comparable.
 *
 * Output: <in>/<TASK>/segments/<EPISODE>__sNN.npy  +  segments_manifest.jsonl + segments_summary.json
 */
import { readdir } from "node:fs/promises";
import { mkdir } from "node:fs/promises";

const argv = process.argv.slice(2);
const flag = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const TASK = (argv[0] && !argv[0].startsWith("--") ? argv[0] : "PICK_SMALL_OBJECTS").toUpperCase();
const IN = flag("in", "openarm-policy/data");
const PRE_PAD_S = parseFloat(flag("pre", "1.0")); // reach before the grasp closes
const POST_PAD_S = parseFloat(flag("post", "0.5")); // retract after release
const MIN_GRASP_S = 0.3; // ignore grasp blips shorter than this
const MIN_SEG_S = 1.5; // drop segments shorter than this
const COLS = 17;

// ---- .npy IO (v1.0, little-endian float32) ----
function decodeNpy(bytes: Uint8Array): number[][] {
  const hlen = bytes[8] | (bytes[9] << 8);
  const header = new TextDecoder().decode(bytes.slice(10, 10 + hlen));
  const m = header.match(/'shape':\s*\((\d+),\s*(\d+)\)/);
  const T = +m![1], D = +m![2];
  const dv = new DataView(bytes.buffer, bytes.byteOffset + 10 + hlen);
  const rows: number[][] = [];
  let o = 0;
  for (let i = 0; i < T; i++) {
    const r: number[] = new Array(D);
    for (let j = 0; j < D; j++) { r[j] = dv.getFloat32(o, true); o += 4; }
    rows.push(r);
  }
  return rows;
}
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
  buf.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0], 0);
  buf[8] = hb.length & 0xff; buf[9] = (hb.length >> 8) & 0xff;
  buf.set(hb, 10);
  buf.set(new Uint8Array(dv.buffer), 10 + hb.length);
  return buf;
}

type Seg = { parent: string; idx: number; frames: number; duration: number };

function segmentTake(rows: number[][]): { start: number; end: number }[] {
  const T = rows.length;
  if (T < 2) return [];
  const dt = rows[1][0] - rows[0][0] || 1 / 30;
  const fps = 1 / dt;
  // dominant hand by presence (col1 = R_pos.x, col9 = L_pos.x)
  let rN = 0, lN = 0;
  for (const r of rows) { if (!Number.isNaN(r[1])) rN++; if (!Number.isNaN(r[9])) lN++; }
  const graspCol = rN >= lN ? 8 : 16;
  // binary grasp with forward-fill across NaN
  const g: number[] = [];
  let last = 0;
  for (const r of rows) { const v = r[graspCol]; last = Number.isNaN(v) ? last : v; g.push(last); }

  // contiguous closed runs, drop blips shorter than MIN_GRASP_S
  const minGraspF = Math.max(1, Math.round(MIN_GRASP_S * fps));
  const runs: [number, number][] = [];
  let s = -1;
  for (let i = 0; i < T; i++) {
    if (g[i] >= 0.5 && s < 0) s = i;
    if ((g[i] < 0.5 || i === T - 1) && s >= 0) {
      const e = g[i] < 0.5 ? i - 1 : i;
      if (e - s + 1 >= minGraspF) runs.push([s, e]);
      s = -1;
    }
  }
  // pad into segments, then merge overlaps
  const pre = Math.round(PRE_PAD_S * fps), post = Math.round(POST_PAD_S * fps);
  const padded = runs.map(([a, b]) => [Math.max(0, a - pre), Math.min(T - 1, b + post)] as [number, number]);
  const merged: [number, number][] = [];
  for (const [a, b] of padded) {
    if (merged.length && a <= merged[merged.length - 1][1]) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], b);
    else merged.push([a, b]);
  }
  const minSegF = Math.round(MIN_SEG_S * fps);
  return merged.filter(([a, b]) => b - a + 1 >= minSegF).map(([a, b]) => ({ start: a, end: b }));
}

function reanchor(slice: number[][]): number[][] {
  // dominant hand within the slice
  let rN = 0, lN = 0;
  for (const r of slice) { if (!Number.isNaN(r[1])) rN++; if (!Number.isNaN(r[9])) lN++; }
  const base = rN >= lN ? 1 : 9; // R_pos or L_pos start col
  const first = slice.find((r) => !Number.isNaN(r[base]))!;
  const ax = first[base], ay = first[base + 1], az = first[base + 2];
  const t0 = slice[0][0];
  return slice.map((r) => {
    const o = r.slice();
    o[0] = +(r[0] - t0).toFixed(4);
    for (const c of [1, 9]) { // subtract shared anchor from both hands' positions
      if (!Number.isNaN(o[c])) { o[c] -= ax; o[c + 1] -= ay; o[c + 2] -= az; }
    }
    return o;
  });
}

async function main() {
  const dir = `${IN}/${TASK}`;
  const trajDir = `${dir}/traj`;
  const segDir = `${dir}/segments`;
  await mkdir(segDir, { recursive: true });
  const files = (await readdir(trajDir)).filter((f) => f.endsWith(".npy"));
  console.log(`Segmenting ${files.length} takes from ${trajDir} (pre=${PRE_PAD_S}s post=${POST_PAD_S}s)…`);

  const segs: Seg[] = [];
  let perTake: number[] = [];
  for (const f of files) {
    const rows = decodeNpy(new Uint8Array(await Bun.file(`${trajDir}/${f}`).arrayBuffer()));
    if (!rows.length || rows[0].length !== COLS) continue;
    const cuts = segmentTake(rows);
    perTake.push(cuts.length);
    const parent = f.replace(/\.npy$/, "");
    for (let i = 0; i < cuts.length; i++) {
      const slice = reanchor(rows.slice(cuts[i].start, cuts[i].end + 1));
      const out = `${segDir}/${parent}__s${String(i).padStart(2, "0")}.npy`;
      await Bun.write(out, encodeNpy(slice));
      segs.push({ parent, idx: i, frames: slice.length, duration: +(slice[slice.length - 1][0]).toFixed(2) });
    }
  }

  const durs = segs.map((s) => s.duration).sort((a, b) => a - b);
  const summary = {
    task: TASK, takes: files.length, segments: segs.length,
    segments_per_take: { min: Math.min(...perTake), median: perTake.sort((a, b) => a - b)[perTake.length >> 1], max: Math.max(...perTake) },
    seg_duration_s: durs.length ? { min: durs[0], median: durs[durs.length >> 1], max: durs[durs.length - 1] } : null,
    pre_pad_s: PRE_PAD_S, post_pad_s: POST_PAD_S,
  };
  await Bun.write(`${dir}/segments_manifest.jsonl`, segs.map((s) => JSON.stringify(s)).join("\n") + "\n");
  await Bun.write(`${dir}/segments_summary.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Wrote ${segs.length} segments -> ${segDir}/`);
}

main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
