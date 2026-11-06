"""Speech-to-text worker: keeps Whisper warm. On Apple Silicon: MLX (mlx_whisper); elsewhere (Linux, Windows in WSL):
faster-whisper, on the GPU when there's an NVIDIA one, else on the CPU (int8, smaller models so a talk stays quick).

Protocol: one JSON object per line on stdin {"id", "path", "prompt", "quick", "language"} ->
one JSON line on stdout {"id", "text", "language", "ms"} or {"id", "error"}.
language: "en", "ru", … when the owner chose one (Settings → Voice), else null (Whisper detects it).
A 16-bit PCM WAV (what the app sends) is read here; anything else goes through ffmpeg.
GUBERNOS_WHISPER_MODEL / GUBERNOS_WHISPER_QUICK_MODEL: other faster-whisper models ("medium", "large-v3-turbo"…).
"""
import json
import os
import sys
import time
import wave

import numpy as np

try:
    import mlx_whisper
    import importlib
    from mlx_whisper.load_models import load_model
    ENGINE = "mlx"
except ImportError:
    from faster_whisper import WhisperModel
    ENGINE = "faster-whisper"

if ENGINE == "mlx":
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
else:
    def _gpu():
        try:
            import ctranslate2
            return ctranslate2.get_cuda_device_count() > 0
        except Exception:  # noqa: BLE001 — no CUDA is the usual case
            return False
    GPU = _gpu()
    # on a CPU large models take longer than the talk itself: small for dictation, base for short commands
    MODEL = os.environ.get("GUBERNOS_WHISPER_MODEL") or ("large-v3-turbo" if GPU else "small")
    QUICK_MODEL = os.environ.get("GUBERNOS_WHISPER_QUICK_MODEL") or ("small" if GPU else "base")
    _fw = {}

    def _faster(name):
        if name not in _fw:
            _fw[name] = WhisperModel(name, device="cuda" if GPU else "cpu", compute_type="float16" if GPU else "int8")
        return _fw[name]


def audio_of(path):
    """16 kHz mono float32 for Whisper: a 16 kHz 16-bit WAV without ffmpeg, else the path (mlx_whisper runs ffmpeg)"""
    if not path.endswith(".wav"):
        return path
    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2 or w.getframerate() != 16000:
            return path
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        if w.getnchannels() > 1:
            pcm = pcm.reshape(-1, w.getnchannels()).mean(axis=1)
    return pcm.astype(np.float32) / 32768.0


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
        if ENGINE == "mlx":
            r = mlx_whisper.transcribe(audio_of(req["path"]), path_or_hf_repo=model, initial_prompt=req.get("prompt") or None,
                                       language=req.get("language") or None)
            text, lang = r["text"], r.get("language")
        else:
            segments, info = _faster(model).transcribe(audio_of(req["path"]), initial_prompt=req.get("prompt") or None,
                                                       language=req.get("language") or None, beam_size=1)
            text, lang = "".join(seg.text for seg in segments), info.language
        out = {"id": req.get("id"), "text": text.strip(), "language": lang, "ms": int((time.time() - t) * 1000)}
    except Exception as e:  # noqa: BLE001 — report any decode/model failure to the caller
        out = {"id": req.get("id"), "error": str(e)[:500]}
    sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
    sys.stdout.flush()
