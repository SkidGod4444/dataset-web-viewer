#!/usr/bin/env python3
"""
Step 5 — serve a trained ACT policy to OpenArm over its documented policy-server contract
(RUN ON THE H200 BOX / robot host). This is the one piece OpenArm doesn't ship for the real
robot (only the MuJoCo inference dataflow exists) — but the contract IS documented, so this
is wiring, not research.

Contract (from dora-openarm-inference / local_policy_server):
  - A unix socket. Each request = one JSON line pointing at an Arrow IPC file in /dev/shm
    holding camera frames (H×W×3 uint8) + `position` (float32, current 16-DoF qpos).
  - Reply = one JSON line:
      {"interval": <ns>, "cutoff_hz": 15, "positions": [[16 floats], ...]}
    `positions` is the predicted action chunk (16-DoF = right_arm[7] rgrip[1] left_arm[7] lgrip[1]);
    `cutoff_hz` applies a Butterworth low-pass on the output; empty positions skips a tick.

Deploy loop:
  python openarm-policy/policy_server.py --policy $HF_USER/act-openarm-pick \
      --socket /dev/shm/policy-server.socket
  # then, in the dora world, run the real-robot inference dataflow that talks to this socket
  # (swap dora-openarm-mujoco -> dora-openarm + real camera nodes -> dora-openarm-observer).

VERIFY against the exact framing in enactic/dora-openarm-inference/src/local_policy_server.py
(line-delimited JSON over SOCK_STREAM, Arrow schema field names). Those two specifics are the
only adaptation points.
"""
import argparse, json, os, socket, time
import numpy as np

try:
    import pyarrow as pa
    import torch
    from lerobot.common.policies.factory import make_policy  # lerobot 0.3.3
except ImportError as e:
    raise SystemExit(f"missing dep ({e}); pip install lerobot==0.3.3 pyarrow torch")


def load_policy(path, device):
    # ADAPT to the lerobot 0.3.3 loading API you trained with. Two common forms:
    #   policy = make_policy(hydra_cfg, pretrained_policy_name_or_path=path)
    #   policy = ACTPolicy.from_pretrained(path)
    from lerobot.common.policies.act.modeling_act import ACTPolicy
    policy = ACTPolicy.from_pretrained(path)
    policy.to(device).eval()
    return policy


def read_obs(arrow_path):
    """Read the Arrow IPC obs file → dict of camera tensors + position vector."""
    with pa.memory_map(arrow_path, "r") as src:
        table = pa.ipc.open_file(src).read_all().to_pydict()
    obs = {}
    for k, v in table.items():
        arr = np.asarray(v[0])
        if k == "position":
            obs["position"] = arr.astype(np.float32)
        else:  # camera frame H×W×3 uint8 → CHW float [0,1] under the key lerobot expects
            obs[f"observation.images.{k}"] = arr
    return obs


def to_batch(obs, device):
    batch = {}
    for k, v in obs.items():
        if k.startswith("observation.images."):
            t = torch.from_numpy(v).float().permute(2, 0, 1) / 255.0
            batch[k] = t.unsqueeze(0).to(device)
    batch["observation.state"] = torch.from_numpy(obs["position"]).unsqueeze(0).to(device)
    return batch


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--policy", required=True, help="trained ACT checkpoint / repo_id")
    ap.add_argument("--socket", default="/dev/shm/policy-server.socket")
    ap.add_argument("--cutoff-hz", type=int, default=15)
    ap.add_argument("--device", default="cuda")
    args = ap.parse_args()

    policy = load_policy(args.policy, args.device)
    if os.path.exists(args.socket):
        os.remove(args.socket)
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    srv.bind(args.socket); srv.listen(1)
    print(f"ACT policy server listening on {args.socket}")
    conn, _ = srv.accept()
    buf = b""
    while True:
        chunk = conn.recv(65536)
        if not chunk:
            break
        buf += chunk
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            req = json.loads(line)
            obs = read_obs(req["arrow_path"] if "arrow_path" in req else req["path"])
            t0 = time.time_ns()
            with torch.no_grad():
                action = policy.select_action(to_batch(obs, args.device))
            positions = action.squeeze(0).cpu().numpy().astype(float).tolist()
            positions = positions if isinstance(positions[0], list) else [positions]  # ensure chunk shape
            resp = {"interval": time.time_ns() - t0, "cutoff_hz": args.cutoff_hz, "positions": positions}
            conn.sendall((json.dumps(resp) + "\n").encode())


if __name__ == "__main__":
    main()
