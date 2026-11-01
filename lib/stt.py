"""Speech-to-text worker: keeps Whisper warm on Apple Silicon (MLX).

Protocol: one JSON object per line on stdin {"id", "path", "prompt", "quick"} ->
one JSON line on stdout {"id", "text", "language", "ms"} or {"id", "error"}.
"""
import json
import sys
import time

import mlx_whisper
import importlib
from mlx_whisper.load_models import load_model

# AICODE-NOTE: mlx_whisper caches ONE model and reloads on every switch; keep both resident instead.
_models = {}


@classmethod
def _get_model(cls, model_path, dtype):
    key = (model_path, str(dtype))
    if key not in _models:
        _models[key] = load_model(model_path, dtype=dtype)
    return _models[key]


importlib.import_module('mlx_whisper.transcribe').ModelHolder.get_model = _get_model

MODEL = "mlx-community/whisper-large-v3-turbo"
# AICODE-NOTE: "quick" = short utterances that are probably commands; small is ~0.45 s vs ~2.1 s for turbo.
QUICK_MODEL = "mlx-community/whisper-small-mlx"

# argv[1] = "quick" | "full": which model this process keeps resident (see lib/voice.js).
KIND = sys.argv[1] if len(sys.argv) > 1 else "full"

for line in sys.stdin:
    try:
        req = json.loads(line)
    except ValueError:
        continue
    t = time.time()
    try:
        model = QUICK_MODEL if (req.get("quick") or KIND == "quick") else MODEL
        r = mlx_whisper.transcribe(req["path"], path_or_hf_repo=model, initial_prompt=req.get("prompt") or None)
        out = {"id": req.get("id"), "text": r["text"].strip(), "language": r.get("language"), "ms": int((time.time() - t) * 1000)}
    except Exception as e:  # noqa: BLE001 — report any decode/model failure to the caller
        out = {"id": req.get("id"), "error": str(e)[:500]}
    sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
    sys.stdout.flush()
