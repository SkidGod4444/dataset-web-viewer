#!/usr/bin/env python3
"""
Smoke test — render ONE episode to a PNG contact sheet so you can eyeball the sim before
committing to a full Step-3 batch (RUN ON THE H200 BOX).

It reuses replay_sim.py's exact scene setup (same MJCF + object inject + grasp-weld + DR),
so what you see here is the real render path. Run it FIRST on the box: with --synthetic it
needs no data and verifies the MJCF loads, the object injects, the cameras are framed, and
the workspace transform is sane — before you've even run retarget.

    # before any data (just exercise the scene):
    python openarm-policy/replay_smoke_test.py --synthetic --out /tmp/openarm_smoke
    # on a real retargeted segment:
    python openarm-policy/replay_smoke_test.py \
        --in openarm-policy/data/PICK_SMALL_OBJECTS/retargeted --out /tmp/openarm_smoke

Output: <out>/smoke_montage.png (rows = timesteps, cols = overview | wrist | ceiling)
        + per-camera frame PNGs. Eyeball: arm in sensible poses? object visible & picked up
        while grasped? cameras pointed at the work area? If the arm flails or the object
        floats/teleports, fix R_HUMAN_TO_ROBOT / T_WORKSPACE_OFFSET / joint names first.
"""
import argparse, glob, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import mujoco
    import cv2
    from replay_sim import (
        load_model_with_object, set_arm, eef_pose, set_object, active_side, randomize,
        RIGHT_JOINTS, LEFT_JOINTS, CAMERAS, GRASP_THRESH, OBJ_HALF, IMG_W, IMG_H,
        GRIPPER_OPEN, GRIPPER_CLOSED,
    )
except ImportError as e:
    raise SystemExit(f"missing dep ({e}); pip install -r openarm-policy/requirements.txt")


def synthetic_traj(T=120):
    """A gentle right-arm reach with a grasp in the middle — exercises render+object, no data."""
    traj = np.zeros((T, 16), dtype=np.float64)
    s = np.sin(np.linspace(0, np.pi, T))                      # 0→1→0 ease
    for j, amp in enumerate([0.4, -0.6, 0.3, -0.9, 0.2, 0.5, 0.1]):
        traj[:, j] = amp * s                                   # right_joint1..7
    traj[:, 7] = np.where((np.arange(T) > T * 0.35) & (np.arange(T) < T * 0.8),
                          GRIPPER_CLOSED, GRIPPER_OPEN)         # right gripper close mid-reach
    traj[:, 15] = GRIPPER_OPEN
    return traj


def label(img, text):
    out = img.copy()
    cv2.putText(out, text, (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 1, cv2.LINE_AA)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", help="retargeted .npy file or dir (first file used)")
    ap.add_argument("--synthetic", action="store_true", help="use a canned arm sweep, no data")
    ap.add_argument("--out", default="/tmp/openarm_smoke")
    ap.add_argument("--frames", type=int, default=6, help="timesteps to sample for the montage")
    ap.add_argument("--randomize", action="store_true")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    if args.synthetic:
        traj, src = synthetic_traj(), "synthetic"
    else:
        if not args.inp:
            raise SystemExit("give --in <retargeted .npy|dir> or --synthetic")
        path = args.inp if args.inp.endswith(".npy") else sorted(glob.glob(os.path.join(args.inp, "*.npy")))[0]
        traj, src = np.load(path).astype(np.float64), os.path.basename(path)
    if traj.ndim != 2 or traj.shape[1] != 16:
        raise SystemExit(f"expected (T,16) retargeted joints, got {traj.shape}")
    T = traj.shape[0]

    model = load_model_with_object()
    renderer = mujoco.Renderer(model, IMG_H, IMG_W)
    data = mujoco.MjData(model)
    side = active_side(traj)
    gcol = 7 if side == "right" else 15
    grasp = traj[:, gcol] >= GRASP_THRESH

    # object init = EEF at first grasp frame, dropped to table (mirrors replay_sim.replay_one)
    first = int(np.argmax(grasp)) if grasp.any() else 0
    set_arm(model, data, RIGHT_JOINTS, traj[first, 0:8])
    set_arm(model, data, LEFT_JOINTS, traj[first, 8:16])
    mujoco.mj_forward(model, data)
    obj_pos, _ = eef_pose(model, data, side)
    obj_pos[2] = max(OBJ_HALF, obj_pos[2] - 0.02)
    obj_quat = np.array([1.0, 0, 0, 0])
    if args.randomize:
        import random
        randomize(model, random.Random(args.seed))

    sample = set(np.linspace(0, T - 1, args.frames).astype(int).tolist())
    rows, jmin, jmax = [], traj[:, 0:7].min(0), traj[:, 0:7].max(0)
    for t in range(T):
        set_arm(model, data, RIGHT_JOINTS, traj[t, 0:8])
        set_arm(model, data, LEFT_JOINTS, traj[t, 8:16])
        if grasp[t]:
            mujoco.mj_forward(model, data)
            obj_pos, obj_quat = eef_pose(model, data, side)
        set_object(model, data, obj_pos, obj_quat)
        mujoco.mj_forward(model, data)
        if t not in sample:
            continue
        g = "CLOSED" if grasp[t] else "open"
        renderer.update_scene(data)                                   # default/overview cam
        tiles = [label(renderer.render().copy(), f"overview t={t} {g}")]
        for logical, cam in CAMERAS.items():
            renderer.update_scene(data, camera=cam)
            img = label(renderer.render().copy(), f"{logical} t={t}")
            tiles.append(img)
            cv2.imwrite(os.path.join(args.out, f"{logical}_{t:04d}.jpg"),
                        cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
        rows.append(np.hstack(tiles))

    montage = np.vstack(rows)
    cv2.imwrite(os.path.join(args.out, "smoke_montage.png"), cv2.cvtColor(montage, cv2.COLOR_RGB2BGR))

    print(f"source: {src}  | frames: {T}  | active arm: {side}  | grasp frames: {int(grasp.sum())}")
    print(f"right joint ranges: min={np.round(jmin,2)}  max={np.round(jmax,2)}")
    print(f"object start: {np.round(obj_pos,3)}")
    print(f"wrote {os.path.join(args.out,'smoke_montage.png')}  (rows=timesteps, cols=overview|wrist|ceiling)")
    print("eyeball: arm sensible? object picked while grasp=CLOSED? cameras framed on the work area?")


if __name__ == "__main__":
    main()
