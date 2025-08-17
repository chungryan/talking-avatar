# AI path + fallback
import os, time, io
import numpy as np
from PIL import Image

_USE_W2L = False
try:
    import torch  # noqa: F401
    import sys
    from pathlib import Path
    sys.path.append(str(Path(__file__).parent / "third_party" / "wav2lip"))
    from wav2lip_infer import Wav2LipWrapper
    _USE_W2L = True
except Exception as e:
    print("Wav2Lip not available, using fallback:", e)

def encode_jpeg(rgb: np.ndarray, quality=85) -> bytes:
    im = Image.fromarray(rgb, "RGB")
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()

def energy_mouth(rgb: np.ndarray, energy: float) -> np.ndarray:
    """Simple mouth bar driven by audio energy (fallback)."""
    out = rgb.copy()
    h, w, _ = out.shape
    cx, cy = w//2, int(h*0.68)
    mouth_w = int(w*0.22)
    mouth_h = max(2, int(h*0.02 + energy * h * 0.06))
    y0, y1 = max(0, cy - mouth_h//2), min(h, cy + mouth_h//2)
    x0, x1 = max(0, cx - mouth_w//2), min(w, cx + mouth_w//2)
    out[y0:y1, x0:x1, :] = [170, 20, 20]
    return out

def mjpeg_frames_ai(avatar_rgb: np.ndarray, audio_pcm: np.ndarray, sample_rate: int, fps: int):
    model_path = os.getenv("WAV2LIP_WEIGHTS", "/models/wav2lip.pth")
    assert os.path.exists(model_path), f"Missing weights at {model_path}"
    device = "cuda" if os.getenv("CUDA_VISIBLE_DEVICES", "") != "" else "cpu"
    w2l = Wav2LipWrapper(model_path=model_path, device=device, fps=fps)
    for rgb in w2l.generate(avatar_rgb, audio_pcm, sample_rate):
        yield encode_jpeg(rgb, quality=85)

def mjpeg_frames_fallback(avatar_rgb: np.ndarray, audio_pcm: np.ndarray, sample_rate: int, fps: int):
    hop = int(sample_rate / fps)
    total = max(1, len(audio_pcm) // hop)
    t0 = time.time()
    for i in range(total):
        seg = audio_pcm[i*hop:(i+1)*hop]
        energy = float(np.sqrt(np.mean(seg**2)) if seg.size else 0.0)
        frame = energy_mouth(avatar_rgb, min(1.0, energy*6))
        yield encode_jpeg(frame, quality=85)
        # pace
        elapsed = time.time() - t0
        target = (i+1) / fps
        if target > elapsed:
            time.sleep(target - elapsed)

def choose_mjpeg_generator(use_ai: bool):
    return mjpeg_frames_ai if (_USE_W2L and use_ai) else mjpeg_frames_fallback
