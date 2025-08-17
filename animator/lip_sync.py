# lip_sync.py
import os, io, math
import numpy as np
from typing import Generator, Tuple

# Optional torch / CUDA
try:
    import torch
    _has_torch = True
    _device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
except Exception:
    _has_torch = False
    _device = None

# Mel features (pure python/numpy path); librosa does not require libsndfile if we give it raw samples
import librosa

from PIL import Image, ImageDraw

# S3 helper (we call out to s3util.get_bytes when loading a model from S3)
try:
    from s3util import get_bytes
except Exception:
    get_bytes = None  # fallback if not present

# -----------------------------
# Optional Wav2Lip integration
# -----------------------------
_W2L = None
def _maybe_load_wav2lip() -> None:
    """Try to load Wav2Lip model once (if repo files are present)."""
    global _W2L
    if _W2L is not None:
        return
    if not _has_torch:
        return

    # Try common import paths the Wav2Lip repo uses
    ModelClass = None
    for mod_name, attr in [
        ("Wav2Lip.models", "Wav2Lip"),
        ("wav2lip.models", "Wav2Lip"),
        ("models", "Wav2Lip"),
    ]:
        try:
            mod = __import__(mod_name, fromlist=[attr])
            ModelClass = getattr(mod, attr)
            break
        except Exception:
            continue

    if ModelClass is None:
        # Repo not vendored; stay in fallback mode
        return

    # Locate model weights
    model_path = os.environ.get("WAV2LIP_MODEL_PATH", "/models/wav2lip.pth")
    if not os.path.exists(model_path):
        # Optionally fetch from S3 if key is provided
        model_key = os.environ.get("WAV2LIP_MODEL_KEY", "").strip()
        assets_bucket = os.environ.get("ASSETS_BUCKET", "").strip()
        if model_key and assets_bucket and get_bytes is not None:
            os.makedirs(os.path.dirname(model_path), exist_ok=True)
            try:
                data = get_bytes(assets_bucket, model_key)
                with open(model_path, "wb") as f:
                    f.write(data)
            except Exception as e:
                # couldn't fetch; fallback will be used
                return
        # else: nothing to load

    if not os.path.exists(model_path):
        return

    try:
        model = ModelClass()
        sd = torch.load(model_path, map_location="cpu")
        # Some checkpoints store {'state_dict': ...}
        if isinstance(sd, dict) and 'state_dict' in sd:
            sd = sd['state_dict']
        model.load_state_dict(sd, strict=False)
        model = model.to(_device).eval()
        _W2L = model
    except Exception:
        _W2L = None  # fallback
        return


# -----------------------------
# Public API
# -----------------------------
def prepare_avatar_tensor(avatar_rgb: np.ndarray) -> dict:
    """
    Precompute avatar resources.

    Returns a dict with:
      - 'base': np.uint8 HxWx3 original (kept for fallback compositing)
      - 'face96_t': (optional) torch.FloatTensor [1,3,96,96] on device, if torch available
    """
    h, w, _ = avatar_rgb.shape
    out = {"base": avatar_rgb.copy()}

    if _has_torch:
        # For (potential) Wav2Lip input: 96x96 normalized to [-1,1]
        face96 = Image.fromarray(avatar_rgb).resize((96, 96), Image.LANCZOS)
        face96 = np.asarray(face96).astype(np.float32) / 255.0
        face96 = (face96 * 2.0) - 1.0
        face96 = np.transpose(face96, (2, 0, 1))  # CHW
        face96_t = torch.from_numpy(face96).unsqueeze(0).to(_device)
        out["face96_t"] = face96_t
    return out


def pcm_wav_to_mels(wav_bytes: bytes, sr: int = 16000) -> "np.ndarray | torch.Tensor":
    """
    Decode mono WAV 16-bit PCM bytes and compute log-Mel spectrogram
    with Wav2Lip-friendly params:
      n_mels=80, n_fft=400, hop_length=160, win_length=400, fmin=50, fmax=7600

    Returns:
      - numpy array [80, T] or torch.Tensor on CUDA if torch is available
    """
    # Parse wav header with the stdlib wave module
    import wave
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        ch = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        rate = wf.getframerate()
        nframes = wf.getnframes()
        raw = wf.readframes(nframes)

    if sampwidth != 2:
        # convert any non-16-bit samples by naive scaling
        # but most likely we always shipped 16-bit PCM
        raise ValueError("Expected 16-bit PCM WAV")
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch == 2:
        audio = audio.reshape(-1, 2).mean(axis=1)
    if rate != sr:
        # Resample with librosa
        audio = librosa.resample(audio, orig_sr=rate, target_sr=sr)

    # Mel spectrogram
    mels = librosa.feature.melspectrogram(
        y=audio, sr=sr, n_fft=400, hop_length=160, win_length=400,
        n_mels=80, fmin=50, fmax=7600, power=1.0
    )
    # Log compression
    mels = np.log(np.maximum(mels, 1e-6))

    if _has_torch:
        t = torch.from_numpy(mels).float().to(_device)
        return t
    return mels


def run_wav2lip_stream(avatar_resource: dict,
                       mels: "np.ndarray | torch.Tensor",
                       out_w: int, out_h: int) -> Generator[np.ndarray, None, None]:
    """
    Yield frames (np.uint8 HxWx3) synchronised with mels.

    If Wav2Lip is available, it will be used (static-face mode).
    Otherwise, a lightweight 2D fallback synthesises mouth motion
    driven by mel energy.
    """
    _maybe_load_wav2lip()

    # Normalize types across branches
    base = avatar_resource["base"]  # np.uint8 HxWx3
    if isinstance(mels, np.ndarray):
        m_np = mels
    else:
        # torch tensor -> numpy (keep on CPU copy for control)
        m_np = mels.detach().float().cpu().numpy()

    # Number of mel frames (each hop ~10 ms at 16k/160 hop)
    T = m_np.shape[1]

    if _W2L is not None and _has_torch and "face96_t" in avatar_resource:
        # --- Simple static-face Wav2Lip pass (no face detection, demo quality) ---
        # Prepare a single face tensor, reuse for all steps.
        face96_t = avatar_resource["face96_t"]  # [1,3,96,96] on device
        # Wav2Lip usually takes 16 mel frames per video frame
        mel_step_size = 16
        for i in range(0, T - mel_step_size, mel_step_size):
            mel_win = mels[:, i:i+mel_step_size] if isinstance(mels, torch.Tensor) \
                      else torch.from_numpy(m_np[:, i:i+mel_step_size]).to(_device)
            mel_win = mel_win.unsqueeze(0).unsqueeze(1).float()  # [1,1,80,16]

            # The official Wav2Lip forward expects a face stack. For static face,
            # we pass a duplicated frame pair if the model requires 6ch concat.
            # Many forks accept [B,3,96,96] and the mel chunk.
            with torch.no_grad():
                try:
                    # Try common signatures
                    out_face = _W2L(mel_win, face96_t)       # [1,3,96,96]
                except Exception:
                    # Fallback: some repos expect (face, mel)
                    out_face = _W2L(face96_t, mel_win)
            out_face = out_face.squeeze(0).detach().float().cpu().numpy()  # [3,96,96]
            out_face = np.transpose(out_face, (1, 2, 0))                   # HWC, [-1,1] or [0,1]
            # Denormalize if needed
            if out_face.min() < 0.0:
                out_face = (out_face + 1.0) * 0.5
            out_face = np.clip(out_face, 0.0, 1.0)
            out_face = (out_face * 255.0).astype(np.uint8)

            # For demo: just upscale the 96x96 face to requested size
            frame = np.asarray(Image.fromarray(out_face).resize((out_w, out_h), Image.LANCZOS))
            yield frame

        return

    # -------------------------------
    # Fallback 2D mouth-by-energy
    # -------------------------------
    # Pre-resize avatar once
    base_resized = np.asarray(Image.fromarray(base).resize((out_w, out_h), Image.LANCZOS))

    # Energy per hop (simple mean over mels)
    energy = m_np.mean(axis=0)  # [T]
    # Normalise energy to [0,1]
    e_min, e_max = float(np.percentile(energy, 10)), float(np.percentile(energy, 98))
    if e_max <= e_min:
        e_max = e_min + 1e-6
    energy_n = np.clip((energy - e_min) / (e_max - e_min), 0.0, 1.0)

    # Define a mouth region (lower-center). You can tune these for your avatar framing.
    cx, cy = out_w // 2, int(out_h * 0.66)
    base_mouth_w = int(out_w * 0.20)
    base_mouth_h = max(4, int(out_h * 0.02))

    for t in range(T):
        openness = 0.15 + 0.85 * float(energy_n[t])  # 0.15..1.0
        mouth_h = max(2, int(base_mouth_h * (0.5 + 1.6 * openness)))
        mouth_w = base_mouth_w

        frame_img = Image.fromarray(base_resized.copy())
        dr = ImageDraw.Draw(frame_img, "RGBA")

        # Outer lip (dark red)
        dr.ellipse(
            [cx - mouth_w, cy - mouth_h, cx + mouth_w, cy + mouth_h],
            outline=(180, 40, 40, 220), width=max(2, out_w // 256)
        )
        # Inner mouth (dark fill)
        inner_h = max(1, int(mouth_h * 0.8))
        dr.ellipse(
            [cx - mouth_w + 2, cy - inner_h, cx + mouth_w - 2, cy + inner_h],
            fill=(30, 10, 10, 235)
        )

        yield np.asarray(frame_img, dtype=np.uint8)
