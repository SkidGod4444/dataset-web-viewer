#!/usr/bin/env python3
"""
Step 2 — retarget human EEF trajectories to OpenArm joint space (RUN ON THE H200 BOX).

Input : Step-1/1.5 `.npy` trajectories, columns
        t | R_pos(3) R_quat(4) R_grasp | L_pos(3) L_quat(4) L_grasp   (world frame, m, +Y up)
Output: OpenArm joint trajectories, `.npy` (T, 16):
        right_arm[7] right_grip[1] left_arm[7] left_grip[1]           (the OpenArm action layout)
        + retarget_manifest.jsonl with per-segment IK success rate (= reachability filter).

This needs `openarm_control` (IK on the OpenArm MJCF, via mink/daqp) installed:
    pip install openarm-mujoco
    git clone https://github.com/enactic/openarm_control && pip install -e openarm_control
It CANNOT run on the dataset-web-viewer laptop. The math below (quat->R, frame transform,
gripper map, 16-DoF packing, temporal IK seeding) is complete; only `solve_ik()` and the
three CONFIG transforms must be matched to your installed API + measured workspace.

    python openarm-policy/retarget.py --in openarm-policy/data/PICK_SMALL_OBJECTS/segments \
        --out openarm-policy/data/PICK_SMALL_OBJECTS/retargeted --arm auto
"""
import argparse, glob, json, os
import numpy as np

# ───────────────────────── CONFIG — calibrate these to your real cell ─────────────────────────
# 1) Human(ARKit, +Y up) → OpenArm base(+Z up, +X forward) axis remap. Right-handed.
#    Default: ARKit +Y(up) -> robot +Z(up); ARKit -Z(toward user) -> robot +X(forward);
#             ARKit +X(right) -> robot -Y. VERIFY against where the arm actually reaches.
R_HUMAN_TO_ROBOT = np.array([
    [0.0,  0.0, -1.0],   # robot X (forward) =  -ARKit Z
    [-1.0, 0.0,  0.0],   # robot Y (left)    =  -ARKit X
    [0.0,  1.0,  0.0],   # robot Z (up)      =   ARKit Y
])
# 2) Where the human-anchored origin lands in the OpenArm base frame (m). A reachable spot
#    in front of the arm. Tune so trajectories sit inside the workspace.
T_WORKSPACE_OFFSET = np.array([0.40, 0.0, 0.20])
# 3) Scale human reach -> robot reach (human arm span ~0.6 m; OpenArm ~0.5-0.7 m). 1.0 = identity.
POS_SCALE = 1.0
# Gripper joint (joint 8) positions — SET from the OpenArm URDF limits.
GRIPPER_OPEN, GRIPPER_CLOSED = 0.0, 0.85
# Rest pose for the non-dominant arm when running single-arm (7 joints).
ARM_REST = np.zeros(7)
# IK acceptance: reject a frame if position error exceeds this (m) after solving.
IK_POS_TOL = 0.02
# Reject a whole segment if fewer than this fraction of frames solve.
MIN_SEG_SUCCESS = 0.85
# ───────────────────────────────────────────────────────────────────────────────────────────────

COLS = 17


def quat_to_R(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w),     2 * (x * z + y * w)],
        [2 * (x * y + z * w),     1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w),     2 * (y * z + x * w),     1 - 2 * (x * x + y * y)],
    ])


def human_pose_to_robot_T(pos, quat):
    """4x4 SE(3) target in the OpenArm base frame from a human-frame pos(3)+quat(4)."""
    R_h = quat_to_R(quat)
    R_r = R_HUMAN_TO_ROBOT @ R_h
    p_r = R_HUMAN_TO_ROBOT @ (POS_SCALE * np.asarray(pos)) + T_WORKSPACE_OFFSET
    T = np.eye(4)
    T[:3, :3], T[:3, 3] = R_r, p_r
    return T


def load_kinematics():
    """ADAPT to the installed openarm_control API."""
    from openarm_control import Kinematics  # noqa
    # The MJCF ships with openarm_mujoco; point Kinematics at the OpenArm 2.0 model.
    return Kinematics(model="openarm_v2")  # <-- verify constructor / model name


def solve_ik(kin, T_target, q_seed, side):
    """
    Return a 7-vector of joint angles for `side` ('right'|'left') reaching SE(3) T_target,
    seeded with q_seed for temporal continuity, or None if IK fails.
    ADAPT these two lines to your installed openarm_control signature (research surfaced
    `Kinematics.solve` + `IKParams` over a daqp QP):
    """
    from openarm_control import IKParams  # noqa
    q = kin.solve(target_pose=T_target, seed=q_seed, side=side, params=IKParams())
    return None if q is None else np.asarray(q, dtype=np.float64)[:7]


def fk_pos(kin, q, side):
    """End-effector position for joint vector q (for the reachability error check)."""
    T = kin.fk(q, side=side)  # <-- verify fk signature
    return np.asarray(T)[:3, 3]


def retarget_file(path, kin):
    a = np.load(path).astype(np.float64)
    if a.ndim != 2 or a.shape[1] != COLS:
        return None
    T = a.shape[0]
    rN = int(np.sum(~np.isnan(a[:, 1]))); lN = int(np.sum(~np.isnan(a[:, 9])))
    side = "right" if rN >= lN else "left"
    base = 1 if side == "right" else 9          # pos start col
    qcol = 4 if side == "right" else 12         # quat start col
    gcol = 8 if side == "right" else 16         # grasp col

    out = np.zeros((T, 16), dtype=np.float32)
    seed = np.zeros(7)
    last_arm = ARM_REST.copy()
    solved = 0
    grasp_ff = 0.0
    for i in range(T):
        pos = a[i, base:base + 3]
        quat = a[i, qcol:qcol + 4]
        g = a[i, gcol]
        grasp_ff = grasp_ff if np.isnan(g) else g     # forward-fill grasp across gaps
        grip = GRIPPER_CLOSED if grasp_ff >= 0.5 else GRIPPER_OPEN
        ok = False
        if not np.isnan(pos[0]) and not np.isnan(quat[0]):
            T_tgt = human_pose_to_robot_T(pos, quat)
            q = solve_ik(kin, T_tgt, seed, side)
            if q is not None and np.linalg.norm(fk_pos(kin, q, side) - T_tgt[:3, 3]) <= IK_POS_TOL:
                last_arm, seed, ok, solved = q, q, True, solved + 1
        arm = last_arm                                # hold last good pose on a miss
        if side == "right":
            out[i, 0:7], out[i, 7], out[i, 8:15], out[i, 15] = arm, grip, ARM_REST, GRIPPER_OPEN
        else:
            out[i, 0:7], out[i, 7], out[i, 8:15], out[i, 15] = ARM_REST, GRIPPER_OPEN, arm, grip
    return out, side, solved / T


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True, help="dir of Step-1/1.5 .npy trajectories")
    ap.add_argument("--out", required=True)
    ap.add_argument("--arm", default="auto", choices=["auto", "right", "left"])
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    kin = load_kinematics()
    files = sorted(glob.glob(os.path.join(args.inp, "*.npy")))
    print(f"Retargeting {len(files)} trajectories → OpenArm joint space")
    rows, kept = [], 0
    for f in files:
        r = retarget_file(f, kin)
        if r is None:
            continue
        out, side, rate = r
        status = "ok" if rate >= MIN_SEG_SUCCESS else "rejected"
        if status == "ok":
            np.save(os.path.join(args.out, os.path.basename(f)), out)
            kept += 1
        rows.append({"file": os.path.basename(f), "side": side, "ik_success": round(rate, 3), "status": status})
        print(f"  {os.path.basename(f)[:48]:48s} {side:5s} IK={rate:5.1%} {status}")

    with open(os.path.join(args.out, "retarget_manifest.jsonl"), "w") as fh:
        fh.write("\n".join(json.dumps(r) for r in rows) + "\n")
    ok = [r for r in rows if r["status"] == "ok"]
    print(f"\nkept {kept}/{len(rows)} segments  | median IK success "
          f"{np.median([r['ik_success'] for r in ok]) if ok else 0:.1%}")
    print("Next (Step 3): replay these joint trajectories in openarm_mujoco, render the "
          "wrist+ceiling cameras, and write an OpenArmDataset episode per segment.")


if __name__ == "__main__":
    main()
