#!/usr/bin/env python3
"""
Watch the OpenArm sim — interactive 3D viewer or MP4 export (RUN ON THE H200 BOX).

This is the "see the robot working" tool. It reuses replay_sim.py's exact scene (same MJCF +
object inject + grasp-weld), so what you watch is the real Step-3 render path — just live.

    # live 3D window, orbit with the mouse, no data needed (canned arm sweep):
    python openarm-policy/view_sim.py --synthetic

    # watch a real human-derived trajectory play on the arm (+ object pick):
    python openarm-policy/view_sim.py --in openarm-policy/data/PICK_SMALL_OBJECTS/retargeted

    # export a shareable video instead of opening a window (headless-friendly):
    python openarm-policy/view_sim.py --in .../retargeted --video /tmp/openarm_replay.mp4

Needs a display for the live viewer; --video works headless (offscreen render).
For the trained POLICY driving the arm (closed-loop autonomy), that's Step 6 eval, not this.
"""
import argparse, glob, os, sys, time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import mujoco
    from replay_sim import (
        load_model_with_object, set_arm, eef_pose, set_object, active_side,
        RIGHT_JOINTS, LEFT_JOINTS, GRASP_THRESH, OBJ_HALF, FPS, IMG_W, IMG_H, CAMERAS,
    )
    from replay_smoke_test import synthetic_traj
except ImportError as e:
    raise SystemExit(f"missing dep ({e}); pip install -r openarm-policy/requirements.txt")


def load_traj(args):
    if args.synthetic or not args.inp:
        return synthetic_traj(), "synthetic"
    path = args.inp if args.inp.endswith(".npy") else sorted(glob.glob(os.path.join(args.inp, "*.npy")))[0]
    return np.load(path).astype(np.float64), os.path.basename(path)


def setup(model, traj):
    """Place the arm at frame 0 and drop the object at the first-grasp EEF position."""
    data = mujoco.MjData(model)
    side = active_side(traj)
    gcol = 7 if side == "right" else 15
    grasp = traj[:, gcol] >= GRASP_THRESH
    first = int(np.argmax(grasp)) if grasp.any() else 0
    set_arm(model, data, RIGHT_JOINTS, traj[first, 0:8])
    set_arm(model, data, LEFT_JOINTS, traj[first, 8:16])
    mujoco.mj_forward(model, data)
    obj_pos, _ = eef_pose(model, data, side)
    obj_pos[2] = max(OBJ_HALF, obj_pos[2] - 0.02)
    return data, side, grasp, obj_pos, np.array([1.0, 0, 0, 0])


def step(model, data, traj, t, side, grasp, obj):
    set_arm(model, data, RIGHT_JOINTS, traj[t, 0:8])
    set_arm(model, data, LEFT_JOINTS, traj[t, 8:16])
    if grasp[t]:                                   # object follows the gripper while grasped
        mujoco.mj_forward(model, data)
        obj[0], obj[1] = eef_pose(model, data, side)
    set_object(model, data, obj[0], obj[1])
    mujoco.mj_forward(model, data)


def run_video(model, traj, out):
    import cv2
    renderer = mujoco.Renderer(model, IMG_H, IMG_W)
    data, side, grasp, op, oq = setup(model, traj)
    obj = [op, oq]
    vw = cv2.VideoWriter(out, cv2.VideoWriter_fourcc(*"mp4v"), FPS, (IMG_W, IMG_H))
    for t in range(traj.shape[0]):
        step(model, data, traj, t, side, grasp, obj)
        renderer.update_scene(data)                          # overview (free) camera
        vw.write(cv2.cvtColor(renderer.render(), cv2.COLOR_RGB2BGR))
    vw.release()
    print(f"wrote {out}  ({traj.shape[0]} frames @ {FPS}fps)")


def run_viewer(model, traj, speed, loop):
    import mujoco.viewer
    data, side, grasp, op, oq = setup(model, traj)
    obj = [op, oq]
    dt = 1.0 / (FPS * speed)
    print("live viewer — orbit with the mouse, Esc/close to quit")
    with mujoco.viewer.launch_passive(model, data) as viewer:
        while viewer.is_running():
            for t in range(traj.shape[0]):
                if not viewer.is_running():
                    break
                step(model, data, traj, t, side, grasp, obj)
                viewer.sync()
                time.sleep(dt)
            if not loop:
                break


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", help="retargeted .npy file or dir (first used)")
    ap.add_argument("--synthetic", action="store_true", help="canned arm sweep, no data")
    ap.add_argument("--video", help="render to MP4 (headless) instead of opening a window")
    ap.add_argument("--speed", type=float, default=1.0, help="playback speed multiplier")
    ap.add_argument("--loop", action="store_true", help="loop the trajectory in the viewer")
    args = ap.parse_args()

    traj, src = load_traj(args)
    if traj.ndim != 2 or traj.shape[1] != 16:
        raise SystemExit(f"expected (T,16) retargeted joints, got {traj.shape}")
    print(f"source: {src}  | frames: {traj.shape[0]}  | active arm: {active_side(traj)}")

    model = load_model_with_object()
    if args.video:
        run_video(model, traj, args.video)
    else:
        run_viewer(model, traj, args.speed, args.loop)


if __name__ == "__main__":
    main()
