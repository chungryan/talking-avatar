# MP3 base64 → mono 16k PCM float32
import base64, subprocess, numpy as np, tempfile, os

def decode_audio_base64_to_pcm16(audio_b64: str, target_hz=16000) -> np.ndarray:
    """Return mono float32 PCM in [-1,1] at target_hz from base64 MP3."""
    raw = base64.b64decode(audio_b64)
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        f.write(raw); mp3_path = f.name
    try:
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-i", mp3_path, "-ac", "1", "-ar", str(target_hz),
            "-f", "s16le", "pipe:1"
        ]
        pcm = subprocess.check_output(cmd)
        audio_i16 = np.frombuffer(pcm, dtype=np.int16)
        return (audio_i16.astype(np.float32) / 32768.0)
    finally:
        try: os.remove(mp3_path)
        except: pass
