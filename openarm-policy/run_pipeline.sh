#!/usr/bin/env bash
# End-to-end driver for the no-teleop pipeline: human dataset -> OpenArm ACT policy.
# Stages 1-1.5 run anywhere with R2 creds (bun). Stages 2-4 need OpenArm's stack (H200 box).
#
#   ./openarm-policy/run_pipeline.sh PICK_SMALL_OBJECTS            # all stages
#   STAGES="1 1.5" ./openarm-policy/run_pipeline.sh PICK_SMALL_OBJECTS   # laptop-side only
#   LIMIT=300 STAGES="1 1.5" ./openarm-policy/run_pipeline.sh PICK_SMALL_OBJECTS
set -euo pipefail

TASK="${1:-PICK_SMALL_OBJECTS}"
LIMIT="${LIMIT:-300}"
DR="${DR:-4}"
STAGES="${STAGES:-1 1.5 2 3 4}"
ROOT="openarm-policy/data/${TASK}"
has() { [[ " ${STAGES} " == *" $1 "* ]]; }

# Activate the venv if present so uv run / python resolve correctly from any CWD
VENV="$(dirname "$0")/.venv"
if [[ -f "${VENV}/bin/activate" ]]; then
  # shellcheck disable=SC1090
  source "${VENV}/bin/activate"
fi
PYTHON="${VENV}/bin/python"
[[ -x "${PYTHON}" ]] || PYTHON=python3

if has 1; then
  echo "== Stage 1: export human takes -> EEF+grasp trajectories =="
  bun scripts/export_task.ts "${TASK}" --limit "${LIMIT}" --concurrency 8
fi
if has 1.5; then
  echo "== Stage 1.5: segment into pick cycles =="
  bun scripts/segment_task.ts "${TASK}"
fi
if has 2; then
  echo "== Stage 2: retarget -> OpenArm joint space (needs openarm_control) =="
  "${PYTHON}" openarm-policy/retarget.py --in "${ROOT}/segments" --out "${ROOT}/retargeted" --arm auto
fi
if has 3; then
  echo "== Stage 3: MuJoCo replay + re-render -> OpenArmDataset (needs openarm_mujoco) =="
  "${PYTHON}" openarm-policy/replay_sim.py --in "${ROOT}/retargeted" --out "${ROOT}" --randomize "${DR}"
fi
if has 4; then
  echo "== Stage 4: convert v2.1 + train ACT =="
  bash openarm-policy/train_act.sh "${TASK}"
fi
echo "pipeline done for ${TASK} (stages: ${STAGES})"
