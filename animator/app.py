from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import numpy as np

from s3util import load_avatar_rgb
from audio import decode_audio_base64_to_pcm16
from lip_sync import choose_mjpeg_generator

app = FastAPI()

class RenderReq(BaseModel):
    bucket: str
    avatarKey: str
    audioBase64: str | None = None
    width: int = 512
    height: int = 512
    fps: int = 15
    useAI: bool = True

@app.get("/")
def health(): return {"ok": True}

@app.post("/mjpeg")
def mjpeg(req: RenderReq):
    w = max(64, min(1920, int(req.width)))
    h = max(64, min(1080, int(req.height)))
    fps = max(1, min(30, int(req.fps)))
    sr = 16000

    base = load_avatar_rgb(req.bucket, req.avatarKey, w, h)
    pcm = decode_audio_base64_to_pcm16(req.audioBase64, sr) if req.audioBase64 else np.zeros((int(sr*1.5),), dtype=np.float32)

    gen_fn = choose_mjpeg_generator(bool(req.useAI))
    boundary = "frame"

    def body():
        for jpg in gen_fn(base, pcm, sr, fps):
            yield (f"--{boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: {len(jpg)}\r\n\r\n").encode()
            yield jpg
            yield b"\r\n"

    headers = {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Content-Type": f"multipart/x-mixed-replace; boundary={boundary}"
    }
    return StreamingResponse(body(), headers=headers, media_type=f"multipart/x-mixed-replace; boundary={boundary}")
