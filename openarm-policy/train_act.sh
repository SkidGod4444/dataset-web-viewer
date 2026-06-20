#!/usr/bin/env bash
# Step 4 — convert OpenArmDataset -> LeRobotDataset v2.1 and train ACT (RUN ON THE H200 BOX).
# LeRobot is pinned to 0.3.3 because OpenArm's converter only emits v2.1.
set -euo pipefail

TASK="${1:-PICK_SMALL_OBJECTS}"
ROOT="openarm-policy/data/${TASK}"
: "${HF_USER:?set HF_USER (your HF username / namespace for the dataset+policy repo_id)}"
REPO_ID="${HF_USER}/openarm-$(echo "$TASK" | tr '[:upper:]_' '[:lower:]-')"
OUT="${ROOT}/lerobot"
STEPS="${STEPS:-100000}"

echo "[1/3] validate OpenArmDataset"
uv run openarm-dataset-validate "${ROOT}/openarm_dataset"

echo "[2/3] convert -> LeRobotDataset v2.1  (${REPO_ID})"
uv run openarm-dataset-convert "${ROOT}/openarm_dataset" "${OUT}" \
  --format lerobot_v2.1 --fps 30 --train-split 0.9 --success-only

echo "[3/3] train ACT on $(nvidia-smi -L | wc -l) GPU(s)"
# 2× H200 is wildly over-provisioned for ACT; single-GPU is fine. For multi-GPU:
#   accelerate launch --multi_gpu $(command -v lerobot-train) ...
lerobot-train \
  --dataset.repo_id="${REPO_ID}" \
  --dataset.root="${OUT}" \
  --policy.type=act \
  --output_dir="${ROOT}/train/act" \
  --policy.device=cuda \
  --steps="${STEPS}" \
  --batch_size=64 \
  --wandb.enable=false \
  --policy.push_to_hub=false

echo "done → ${ROOT}/train/act    (deploy with policy_server.py)"
