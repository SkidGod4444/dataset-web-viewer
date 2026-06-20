#!/usr/bin/env python3
"""
Step 3 — replay retargeted joint trajectories in the OpenArm MuJoCo sim, RE-RENDER the
robot's own cameras, and write one OpenArmDataset episode per segment (RUN ON THE H200 BOX).

This is THE step that turns human demos into *robot* demos: we discard the human RGB and
render observations from OpenArm's real camera poses, with a sim object that gets picked.

Input : Step-2 retargeted `.npy` (T,16) = right_arm[7] rgrip[1] left_arm[7] lgrip[1]
Output: <out>/openarm_dataset/episodes/<i>/ {obs,action}/arms/{right,left}/*.npy + cameras/*.jpg
        + metadata.yaml   (feed to `openarm-dataset-convert ... --format lerobot_v2.1`)

Needs: mujoco>=3, opencv-python, openarm-mujoco (ships the MJCF). Cannot run on the laptop.

    python openarm-policy/replay_sim.py \
      --in  openarm-policy/data/PICK_SMALL_OBJECTS/retargeted \
      --out openarm-policy/data/PICK_SMALL_OBJECTS --randomize 4
"""
import argparse, glob, os, random
import numpy as np

try:
    import mujoco
    import cv2
except ImportError as e:  # keep import-time failure actionable on the box
    raise SystemExit(f"missing runtime dep ({e}); pip install -r openarm-policy/requirements.txt")

# ───────────────────────── CONFIG — match to the installed OpenArm MJCF ─────────────────────────
import openarm_mujoco  # noqa  — provides the MJCF path
MJCF_PATH = os.path.join(os.path.dirname(openarm_mujoco.__file__), "assets", "openarm_v2.xml")  # verify
CAMERAS = {"wrist": "wrist_right", "ceiling": "ceiling"}   # logical -> MJCF camera names (verify)
IMG_W, IMG_H = 320, 240
FPS = 30
# qpos joint names in the MJCF, in OpenArm action order (verify against the model):
RIGHT_JOINTS = [f"right_joint{i}" for i in range(1, 8)] + ["right_gripper"]
LEFT_JOINTS = [f"left_joint{i}" for i in range(1, 8)] + ["left_gripper"]
EEF_BODY = {"right": "right_gripper", "left": "left_gripper"}  # body whose xpos/xmat = EEF (verify)
GRIPPER_OPEN, GRIPPER_CLOSED = 0.0, 0.85                       # must match retarget.py
GRASP_THRESH = 0.5 * (GRIPPER_OPEN + GRIPPER_CLOSED)
OBJ_HALF = 0.02                                               # 2 cm cube "small object"
# ─────────────────────────────────────────────────────────────────────────────────────────────────


def load_model_with_object():
    """Load the OpenArm MJCF and inject a free-joint object + table so picks are visible."""
    with open(MJCF_PATH) as f:
        xml = f.read()
    inject = f"""
      <body name="obj" pos="0 0 0">
        <freejoint name="obj_free"/>
        <geom name="obj_geom" type="box" size="{OBJ_HALF} {OBJ_HALF} {OBJ_HALF}" rgba="0.8 0.2 0.2 1" mass="0.05"/>
      </body>
    </worldbody>"""
    xml = xml.replace("</worldbody>", inject, 1)
    model = mujoco.MjModel.from_xml_string(xml)
    return model


def jaddr(model, name):
    jid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name)
    return None if jid < 0 else model.jnt_qposadr[jid]


def set_arm(model, data, names, q):
    for name, v in zip(names, q):
        a = jaddr(model, name)
        if a is not None:
            data.qpos[a] = v


def eef_pose(model, data, side):
    bid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, EEF_BODY[side])
    pos = data.xpos[bid].copy()
    quat = np.zeros(4)
    mujoco.mju_mat2Quat(quat, data.xmat[bid])       # (w,x,y,z)
    return pos, quat


def set_object(model, data, pos, quat_wxyz):
    a = jaddr(model, "obj_free")
    data.qpos[a:a + 3] = pos
    data.qpos[a + 3:a + 7] = quat_wxyz


def randomize(model, rng):
    """Light visual domain randomization — the bridge to sim2real with zero real frames."""
    if model.nlight:
        model.light_pos[:] += rng.uniform(-0.3, 0.3, model.light_pos.shape)
        model.light_diffuse[:] = np.clip(model.light_diffuse + rng.uniform(-0.2, 0.2, model.light_diffuse.shape), 0.1, 1)
    oid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_GEOM, "obj_geom")
    if oid >= 0:
        model.geom_rgba[oid, :3] = rng.uniform(0.2, 0.9, 3)


def active_side(traj):
    r = traj[:, 0:7].std(0).mean()
    l = traj[:, 8:15].std(0).mean()
    return "right" if r >= l else "left"


def replay_one(model, renderer, traj, rng):
    data = mujoco.MjData(model)
    side = active_side(traj)
    gcol = 7 if side == "right" else 15
    arm_cols = slice(0, 7) if side == "right" else slice(8, 15)
    grasp = traj[:, gcol] >= GRASP_THRESH
    T = traj.shape[0]

    # object start = EEF position at the first grasp frame, dropped to table
    first = int(np.argmax(grasp)) if grasp.any() else 0
    set_arm(model, data, RIGHT_JOINTS, traj[first, 0:8])
    set_arm(model, data, LEFT_JOINTS, traj[first, 8:16])
    mujoco.mj_forward(model, data)
    obj_pos, _ = eef_pose(model, data, side)
    obj_pos[2] = max(OBJ_HALF, obj_pos[2] - 0.02)
    obj_quat = np.array([1.0, 0, 0, 0])

    qpos_r, qpos_l, qvel_r, qvel_l, frames = [], [], [], [], {k: [] for k in CAMERAS}
    randomize(model, rng)
    for t in range(T):
        set_arm(model, data, RIGHT_JOINTS, traj[t, 0:8])
        set_arm(model, data, LEFT_JOINTS, traj[t, 8:16])
        if grasp[t]:                                  # weld object to the gripper while grasped
            mujoco.mj_forward(model, data)
            obj_pos, obj_quat = eef_pose(model, data, side)
        set_object(model, data, obj_pos, obj_quat)
        mujoco.mj_forward(model, data)
        qpos_r.append(traj[t, 0:8]); qpos_l.append(traj[t, 8:16])
        for logical, cam in CAMERAS.items():
            renderer.update_scene(data, camera=cam)
            frames[logical].append(renderer.render().copy())
    qpos_r, qpos_l = np.asarray(qpos_r), np.asarray(qpos_l)
    dt = 1.0 / FPS
    qvel_r = np.vstack([np.zeros((1, 8)), np.diff(qpos_r, axis=0) / dt])
    qvel_l = np.vstack([np.zeros((1, 8)), np.diff(qpos_l, axis=0) / dt])
    return dict(side=side, qpos_r=qpos_r, qpos_l=qpos_l, qvel_r=qvel_r, qvel_l=qvel_l, frames=frames)


def write_episode(root, idx, ep):
    d = os.path.join(root, "episodes", f"{idx:06d}")
    for arm, qp, qv in [("right", ep["qpos_r"], ep["qvel_r"]), ("left", ep["qpos_l"], ep["qvel_l"])]:
        for kind, base in [("obs", None), ("action", None)]:
            os.makedirs(os.path.join(d, kind, "arms", arm), exist_ok=True)
        np.save(os.path.join(d, "obs", "arms", arm, "qpos.npy"), qp.astype(np.float32))
        np.save(os.path.join(d, "obs", "arms", arm, "qvel.npy"), qv.astype(np.float32))
        np.save(os.path.join(d, "obs", "arms", arm, "qtorque.npy"), np.zeros_like(qp, np.float32))
        np.save(os.path.join(d, "action", "arms", arm, "qpos.npy"), qp.astype(np.float32))  # action = next qpos
    for logical, imgs in ep["frames"].items():
        cdir = os.path.join(d, "cameras", logical); os.makedirs(cdir, exist_ok=True)
        for i, im in enumerate(imgs):
            cv2.imwrite(os.path.join(cdir, f"{i:06d}.jpg"), cv2.cvtColor(im, cv2.COLOR_RGB2BGR))
    np.save(os.path.join(d, "timestamps.npy"), (np.arange(len(ep["qpos_r"])) / FPS).astype(np.float64))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True, help="dir of Step-2 retargeted .npy")
    ap.add_argument("--out", required=True, help="task dir; writes <out>/openarm_dataset/")
    ap.add_argument("--randomize", type=int, default=1, help="DR variants rendered per segment")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    model = load_model_with_object()
    renderer = mujoco.Renderer(model, IMG_H, IMG_W)
    root = os.path.join(args.out, "openarm_dataset")
    files = sorted(glob.glob(os.path.join(args.inp, "*.npy")))
    print(f"Replaying {len(files)} segments × {args.randomize} DR variants in MuJoCo → {root}")

    idx = 0
    for f in files:
        traj = np.load(f).astype(np.float64)
        if traj.ndim != 2 or traj.shape[1] != 16:
            continue
        for v in range(args.randomize):
            ep = replay_one(model, renderer, traj, random.Random(args.seed + idx))
            write_episode(root, idx, ep)
            idx += 1
        print(f"  {os.path.basename(f)[:48]:48s} → {args.randomize} episodes")

    with open(os.path.join(root, "metadata.yaml"), "w") as fh:
        fh.write(
            f"version: 0.3.0\nfps: {FPS}\nepisodes: {idx}\n"
            f"cameras: [{', '.join(CAMERAS)}]\nimage_size: [{IMG_H}, {IMG_W}]\n"
            "obs: {arms: {right: [qpos, qvel, qtorque], left: [qpos, qvel, qtorque]}}\n"
            "action: {arms: {right: [qpos], left: [qpos]}}\n"
        )
    print(f"\nWrote {idx} OpenArmDataset episodes → {root}")
    print("Validate:  openarm-dataset-validate " + root)
    print("Next (Step 4):  openarm-policy/train_act.sh")


if __name__ == "__main__":
    main()
