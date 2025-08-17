# app.py (only the handler & glue shown)
import asyncio, io, os
import boto3, numpy as np
from fastapi import FastAPI, Query, Response
from starlette.responses import StreamingResponse
from turbojpeg import TurboJPEG

from s3util import load_avatar_rgb, get_bytes
from lip_sync import prepare_avatar_tensor, pcm_wav_to_mels, run_wav2lip_stream

app = FastAPI()
jpeg = TurboJPEG()
s3 = boto3.client("s3", region_name=os.getenv("AWS_REGION"))
avatar_cache = {}  # small LRU in your code

def encode_jpeg(img_uint8):
  return jpeg.encode(img_uint8, quality=80, chroma_subsampling=jpeg.TJSAMP_420)

def placeholder(w, h, text="loading…"):
  # simple black frame to flush early
  arr = np.zeros((h, w, 3), dtype=np.uint8)
  return arr

@app.get("/")
def root(): return {"ok": True}

@app.get("/mjpeg")
async def mjpeg(
  bucket: str = Query(...),
  avatarKey: str = Query(...),
  audioKey: str = Query(...),
  w: int = Query(512),
  h: int = Query(512),
  fps: int = Query(15),
):
  boundary = "frame"

  async def gen():
    # 1) early flush
    yield (f"--{boundary}\r\nContent-Type: image/jpeg\r\n\r\n").encode()
    yield encode_jpeg(placeholder(w, h))
    yield b"\r\n"

    # 2) fetch inputs concurrently
    loop = asyncio.get_event_loop()
    avatar_t = avatar_cache.get((bucket, avatarKey, w, h))
    if avatar_t is None:
      avatar_np = await loop.run_in_executor(None, load_avatar_rgb, bucket, avatarKey, w, h)
      avatar_t = prepare_avatar_tensor(avatar_np)  # torch tensor on GPU
      avatar_cache[(bucket, avatarKey, w, h)] = avatar_t

    audio_bytes = await loop.run_in_executor(None, get_bytes, bucket, audioKey)
    mels = await loop.run_in_executor(None, pcm_wav_to_mels, audio_bytes)  # torch tensor on GPU

    # 3) stream frames paced at fps
    interval = 1.0 / max(1, fps)
    start = loop.time()
    i = 0
    for frame in run_wav2lip_stream(avatar_t, mels, w, h):
      target = start + i * interval; i += 1
      now = loop.time()
      if target > now:
        await asyncio.sleep(target - now)
      yield (f"--{boundary}\r\nContent-Type: image/jpeg\r\n\r\n").encode()
      yield encode_jpeg(frame)   # np.uint8 HxWx3
      yield b"\r\n"

    yield f"--{boundary}--\r\n".encode()

  headers = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  }
  return StreamingResponse(gen(), media_type=f"multipart/x-mixed-replace; boundary={boundary}", headers=headers)
