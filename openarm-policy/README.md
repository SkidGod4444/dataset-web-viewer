# OpenArm policy pipeline — no-teleop (human dataset → sim → real)

Train an OpenArm 2.0 policy from the **NEUROSCAPE human hand dataset** without ever
teleoperating the robot. The human takes supply *trajectories* (where the hand went +
when it grasped); the robot's *observations* are re-rendered in simulation.

> **The one rule that makes this work:** the human data is egocentric (head-mounted
> iPhone, arbitrary per-take world frame). OpenArm sees fixed wrist + ceiling cameras.
> So we **discard the human RGB and re-render observations in MuJoCo from OpenArm's real
> camera poses.** Human data = trajectories, *not* images.

Hardware: OpenArm 2.0 (7-DoF/arm, parallel gripper), **no KER, no teleop**. Compute: 2× H200.
Steps 1–6 are sim/data only — **no physical arm needed**; do them while it ships (Steps 2–6
run on the H200 box). Only Step 7 (deploy) touches the real robot.

---

## Pipeline

| # | Step | Tool | Status |
|---|------|------|--------|
| 1 | Decode human takes → EEF pose + grasp trajectories (batch) | `scripts/export_task.ts` | ✅ **built + validated** |
| 1.5 | Segment long takes → one episode per pick cycle | `scripts/segment_task.ts` | ✅ **built + validated** |
| 2 | Retarget: EEF pose → OpenArm joint angles (IK) | `openarm-policy/retarget.py` (+ `openarm_control`) | ✅ written — **run on H200 box** |
| 3 | Replay in sim, **re-render** wrist+ceiling cameras → robot demos | `openarm-policy/replay_sim.py` | ✅ written — **run on H200 box** |
| 3· | Smoke-test one episode → PNG contact sheet (run first on box) | `openarm-policy/replay_smoke_test.py` | ✅ written |
| 4 | Augment: domain randomization (folded into replay) | `replay_sim.py --randomize N` | ✅ written |
| 5 | Convert → `lerobot_v2.1`, train **ACT** | `openarm-policy/train_act.sh` | ✅ written |
| 6 | Eval in sim | `openarm_mujoco` / `openarm_isaac_lab` | shipped (OpenArm) |
| 7 | Deploy on real OpenArm | `openarm-policy/policy_server.py` + dora | ✅ server written; wire real dataflow |

**One-command driver:** `./run_pipeline.sh PICK_SMALL_OBJECTS` runs all stages; gate stages
with `STAGES="1 1.5"` (laptop-side) or `STAGES="2 3 4"` (H200 box). Deps for Steps 2–5:
`pip install -r openarm-policy/requirements.txt` (+ `openarm_control` from source).

---

## Repository layout

Trajectory exporters live in the web-viewer repo (they reuse its R2 creds + S3 SDK); the
rest is the standalone box-side project.

```
scripts/                    # laptop-side (bun + R2) — runs today, no OpenArm stack
  export_task.ts            # Step 1   human takes → (T,17) EEF+grasp .npy
  segment_task.ts           # Step 1.5 → one episode per pick cycle
  inspect-bucket.ts  scale-scan.ts  peek-*.ts   # dataset exploration / schema probes
openarm-policy/             # box-side (Python + OpenArm stack)
  run_pipeline.sh           # one-command, stage-gated driver
  requirements.txt          # box deps (LeRobot pinned 0.3.3)
  retarget.py               # Step 2   EEF pose → OpenArm 16-DoF joints via IK
  replay_sim.py             # Step 3+4 MuJoCo replay + object weld + DR → OpenArmDataset
  replay_smoke_test.py      # render one episode → PNG contact sheet (run first on box)
  view_sim.py               # watch the sim live (3D viewer) or export MP4
  train_act.sh              # Step 5   convert v2.1 + train ACT
  policy_server.py          # Step 7   serve ACT over OpenArm's socket contract
  data/<TASK>/              # generated, gitignored (derived from confidential data)
    traj/*.npy              #   Step 1   (T,17)  t|R_pos3 R_quat4 R_grasp|L_pos3 L_quat4 L_grasp
    segments/*.npy          #   Step 1.5 (T,17)  one pick cycle each, re-anchored
    retargeted/*.npy        #   Step 2   (T,16)  right_arm7 rgrip1 left_arm7 lgrip1
    openarm_dataset/        #   Step 3   episodes/<i>/{obs,action}/arms/*  + cameras/*.jpg
    lerobot/                #   Step 5   converted LeRobotDataset v2.1
    train/act/              #   Step 5   trained ACT policy
    *_manifest.jsonl  *summary.json       # per-stage stats / reject reasons
```

**Where each runs:** Steps 1–1.5 on the laptop (or any host with the R2 creds). Steps 2–7
on the H200 box after `pip install -r openarm-policy/requirements.txt` + `openarm_control`.
What I validated on real data vs. only syntax-checked (no MuJoCo/GPU here) is marked per step.

---

## Step 0 — environment

**Laptop (Steps 1–1.5):** just `bun` + the dataset-web-viewer repo's `.env.local` (R2 creds).
Nothing to install.

**H200 box (Steps 2–7):**
```bash
pip install -r openarm-policy/requirements.txt                # mujoco, lerobot==0.3.3, openarm-mujoco, openarm-dataset, …
git clone https://github.com/enactic/openarm_control.git && pip install -e openarm_control   # IK — not on PyPI
openarm-mujoco-launch                                         # sanity-check the MJCF renders
```
LeRobot is pinned to **0.3.3** — OpenArm's converter only emits LeRobotDataset v2.1.

## Step 1 — batch-decode human takes (✅ runs today)

Run from the dataset-web-viewer repo (has R2 creds in `.env.local` + the S3 SDK):

```bash
# capped + resumable + concurrent. 8,728 PICK_SMALL_OBJECTS takes exist in the bucket.
bun scripts/export_task.ts PICK_SMALL_OBJECTS --limit 300 --concurrency 8
# scale out in batches (resumes — skips takes already written):
bun scripts/export_task.ts PICK_SMALL_OBJECTS --limit 300 --offset 300
```

Output `openarm-policy/data/PICK_SMALL_OBJECTS/`:
- `traj/<EPISODE>.npy` — float32 `(T, 17)`, numpy-loadable, columns:
  `t | R_pos(3) R_quat(4) R_grasp | L_pos(3) L_quat(4) L_grasp`
  (missing hand in a frame → that hand's 8 cols are `NaN`).
- `manifest.jsonl` — per-take status/subject/duration/dominant-hand/dup-frames/anchor.
- `summary.json` — totals, reject reasons, subject list.

**Pose convention** (one consistent ARKit world frame, gravity = +Y):
position = wrist keypoint `kp[0]`; orientation = hand frame (+Z wrist→middle_mcp,
+Y palm normal, +X sideways), derived from `hand_keypoints_3d_world` — **not**
`wrist_pose_world` (its translation is in a different frame and it is non-orthonormal in
glitchy frames). Quaternions are always unit-norm. Each take is anchored so the dominant
hand starts at the origin (anchor saved in the manifest to recover world coords).

**Quality handling already built in:** grasp via Schmitt-trigger hysteresis (3 cm close /
5 cm open) to kill chatter; duplicate-hand artifact filter (both wrists < 3 cm apart →
NaN the non-dominant hand — the tracker collapses both hands early in many takes); reject
takes that are too short (< 2 s), have no grasp event, or whose dominant hand is < 50 %
present.

Pick a **gripper-feasible** task: `PICK_SMALL_OBJECTS`. Finger tasks (pen / zipper / knot /
button) are **off the table** for a parallel gripper — skip them. Run any task by name:
`bun scripts/export_task.ts PICK_AND_PLACE_UTENSILS --limit 200`.

Next: **Step 1.5 segments** the long multi-rep takes (some are 4+ min / thousands of frames)
into individual pick cycles — feed `segments/` (not `traj/`) to retargeting. Optional later
refinements: light temporal smoothing of the EEF path; a reachability pre-filter once the
OpenArm IK is wired (Step 2).

## Step 1.5 — segment long takes (✅ runs today)

```bash
bun scripts/segment_task.ts PICK_SMALL_OBJECTS          # reads traj/, writes segments/
```
Splits each take into one episode per grasp cycle (reach → close → transport → open →
retract) using the dominant hand's grasp column: forward-fills grasp over gaps, drops
< 0.3 s blips, pads ±(1.0 s pre / 0.5 s post), merges overlaps, drops < 1.5 s segments,
and re-anchors each segment to its own origin with `t` reset to 0. Validated: a 4-min take
→ 25 clean pick cycles; every segment contains a grasp; all quats stay unit-norm.
Output `segments/<EPISODE>__sNN.npy` (same 17-col layout) + `segments_summary.json`.
This is the ~5× episode multiplier — feed `segments/` to Step 2, not `traj/`.

## Step 2 — retarget to OpenArm (✅ written — run on the H200 box)

```bash
# needs openarm_control + the OpenArm MJCF installed (cannot run on the web-viewer laptop)
python openarm-policy/retarget.py \
  --in  openarm-policy/data/PICK_SMALL_OBJECTS/segments \
  --out openarm-policy/data/PICK_SMALL_OBJECTS/retargeted --arm auto
```
For a parallel gripper there is **no dexterous retargeting** — `retarget.py` maps the wrist
6-DoF pose → 7-DoF arm via IK and the grasp bit → joint 8, packing the OpenArm 16-DoF
layout `right_arm[7]+grip[1]+left_arm[7]+grip[1]` (single-arm → dominant block, other at
rest). The math (quat→R, frame transform, packing, temporal IK seeding) is done and
unit-tested; **before running, calibrate three things** at the top of the file and match
the IK call to your install:
- `R_HUMAN_TO_ROBOT` — ARKit(+Y up) → OpenArm base(+Z up) axis remap.
- `T_WORKSPACE_OFFSET` / `POS_SCALE` — place + scale the human reach into the arm's workspace.
- `GRIPPER_OPEN/CLOSED` — joint-8 limits from the URDF.
- `solve_ik()` / `fk()` — match `openarm_control.Kinematics` signatures (the 3 flagged lines).

IK failure / joint-limit / `IK_POS_TOL` violations reject frames; a segment under
`MIN_SEG_SUCCESS` (85 %) is dropped — that's your **reachability filter**, reported as
per-segment IK success in `retarget_manifest.jsonl`.

## Step 3 — replay in MuJoCo + re-render (✅ written — run on the H200 box)

**Smoke-test the sim first** (do this the moment OpenArm's stack installs, before any data —
catches MJCF path / camera name / workspace-transform mistakes in seconds):
```bash
python openarm-policy/replay_smoke_test.py --synthetic --out /tmp/openarm_smoke   # no data needed
python openarm-policy/replay_smoke_test.py --in openarm-policy/data/PICK_SMALL_OBJECTS/retargeted
# → open /tmp/openarm_smoke/smoke_montage.png (rows=timesteps, cols=overview|wrist|ceiling)
```
Then the full batch:
```bash
python openarm-policy/replay_sim.py \
  --in openarm-policy/data/PICK_SMALL_OBJECTS/retargeted \
  --out openarm-policy/data/PICK_SMALL_OBJECTS --randomize 4
```
`replay_sim.py` injects a free-joint object + table into the OpenArm MJCF, kinematically
replays each retargeted joint trajectory, **welds the object to the gripper while grasped**
(so the rendered pick is visible — the object isn't in the human data, this reconstructs
it from where the hand closed), and renders the **wrist + ceiling** cameras at their real
poses. Writes one `OpenArmDataset` episode per segment (`obs/action/arms/{right,left}/
{qpos,qvel,qtorque}` (T,8) + `cameras/*/*.jpg` + `metadata.yaml`). **Verify before running:**
`MJCF_PATH`, `CAMERAS`, `RIGHT/LEFT_JOINTS`, `EEF_BODY` against the installed MJCF, and that
the on-disk layout passes `openarm-dataset-validate`.

## Step 4 — augment (✅ folded into Step 3)

`--randomize N` renders N domain-randomized variants per segment (light position/colour,
object colour; extend with table texture + camera jitter in `randomize()`). DR is what buys
you sim2real on vision with **zero real frames**. Multiply further with DexMimicGen/MimicGen
if needed.

## Step 5 — convert + train ACT (✅ written — H200 box)

```bash
HF_USER=<you> bash openarm-policy/train_act.sh PICK_SMALL_OBJECTS
```
Validates the OpenArmDataset → converts to LeRobotDataset v2.1 (`--success-only`) →
`lerobot-train --policy.type=act` (LeRobot 0.3.3). 2× H200 is wildly over-provisioned for
ACT; single-GPU is fine (`accelerate launch --multi_gpu` if you want both). Rule of thumb:
**~50 demos/task** (25 is too few) — a non-issue here; the real constraint is how many
segments survive IK and look realistic after replay.

## Step 6 — eval in sim

Roll out in `openarm_mujoco` (or Isaac Lab `Isaac-Lift-Cube-OpenArm-v0` as a template).
Measure task success before touching hardware.

## Step 7 — deploy on real OpenArm (✅ policy server written; wire the dataflow)

```bash
python openarm-policy/policy_server.py \
  --policy openarm-policy/data/PICK_SMALL_OBJECTS/train/act --socket /dev/shm/policy-server.socket
# then run a real-robot dora inference dataflow that talks to this socket
```
`policy_server.py` loads the trained ACT model and serves OpenArm's documented contract
(JSON line → Arrow IPC obs: cameras HxWx3 uint8 + `position` float32; reply
`{"interval", "cutoff_hz": 15, "positions": [[16 floats], ...]}`). **The one genuine
build-it-yourself gap:** only the *MuJoCo* inference dataflow ships. The real-robot version =
swap `dora-openarm-mujoco` → `dora-openarm` (real follower, `--align-trigger gripper`) + real
camera nodes → `dora-openarm-observer` → this server → `dora-openarm-actions-executor`.
Verify the socket framing against `enactic/dora-openarm-inference/src/local_policy_server.py`.

---

## Watching the sim — how to actually see the robot

Everything renders on the **H200 box** (MuJoCo), not the laptop. Ways to look, cheapest first:

| Want | Command | Shows |
|---|---|---|
| Model loads OK? | `openarm-mujoco-launch` | OpenArm's own GUI (bare arm) |
| Frame stills | `python openarm-policy/replay_smoke_test.py --synthetic` | PNG contact sheet (overview/wrist/ceiling) |
| **Watch it move (live)** | `python openarm-policy/view_sim.py --synthetic` or `--in <retargeted>` | 3D window, orbit with the mouse |
| Shareable clip | `python openarm-policy/view_sim.py --in <retargeted> --video out.mp4` | MP4 (headless-friendly) |
| **Policy driving it** | Step 6 eval rollout | the trained ACT acting autonomously |

Two different things you're watching:
- **Replay** (`view_sim.py`, `replay_sim.py`) = the arm *retracing the human demos* (kinematic playback).
- **Eval** (Step 6) = the trained policy *deciding for itself* — the real "robot working in sim".

`view_sim.py`: `--in` with a dir picks the first segment; `--speed 0.5` slows it; `--loop`
repeats. The live viewer needs a display; `--video` renders offscreen (works over SSH).

---

## Day-1 hardware bring-up (parallel track, when the arm arrives)

```bash
# 1. Flash Damiao motor IDs FIRST (Windows + UART @921600) — sender 0x0N / master 0x1N
# 2. CAN-FD up
sudo add-apt-repository -y ppa:openarm/main && sudo apt update
sudo apt install -y libopenarm-can-dev openarm-can-utils can-utils
openarm-can-cli -i can0 can_configure          # 1 Mbps / 5 Mbps FD
openarm-can-cli -i can0 discover && openarm-can-cli -i can0 set_zero --arm
openarm-can-demo                                # arm moves
# 3. Cameras: set unique Arducam serials + udev symlinks; ZED USB-C is orientation-sensitive
```

## Honest risks (read before committing months)

- **Vision sim2real with zero real frames is the hard part.** DR helps but the first
  reliable real success may still want a *handful* of real images. The pipeline is built so
  adding them later is a drop-in, not a rewrite.
- **Gripper scope:** only pick / place / push-class tasks. ~60–70% of the dataset (finger
  tasks) is unusable on a parallel gripper. Adding a LEAP-style hand later unlocks it (and
  brings back dexterous retargeting via `dex-retargeting`).
- **Version lock:** OpenArm converter → LeRobotDataset **v2.1** only → LeRobot **0.3.3**.
  Don't pull a newer LeRobot expecting v3 to load.
- **Per-take world frame** is arbitrary; frame anchoring (Step 2) is a real design choice,
  not a detail. Get it wrong and every demo lands in a different spot.

## Gotchas (from OpenArm docs)

Motor IDs must be flashed before any code runs · CAN-FD bitrate must match flashed motor
baud or you get silent no-comms · Arducams ship with identical serials (collision) · ZED
USB-C orientation-sensitive · gripper is just joint 8 (no separate signal).
