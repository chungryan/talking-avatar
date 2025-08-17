import os
import io
import json
from typing import Optional, Tuple

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from PIL import Image
import numpy as np

# Resolve region robustly
_REGION = (
    os.getenv("AWS_REGION")
    or os.getenv("AWS_DEFAULT_REGION")
    or boto3.session.Session().region_name
    or "us-east-1"
)

_s3 = boto3.client(
    "s3",
    region_name=_REGION,
    config=Config(retries={"max_attempts": 5, "mode": "standard"}),
)

# -----------------------
# Core byte helpers
# -----------------------
def get_bytes(bucket: str, key: str) -> bytes:
    """
    Fetch s3://bucket/key as raw bytes.
    Raises RuntimeError with a clear message on failure.
    """
    try:
        resp = _s3.get_object(Bucket=bucket, Key=key)
        return resp["Body"].read()
    except ClientError as e:
        msg = e.response.get("Error", {}).get("Message", str(e))
        raise RuntimeError(f"S3 get_object failed for s3://{bucket}/{key}: {msg}") from e


def put_bytes(bucket: str, key: str, data: bytes, content_type: Optional[str] = None) -> None:
    """
    Upload raw bytes to s3://bucket/key. Optionally set ContentType.
    """
    extra = {}
    if content_type:
        extra["ContentType"] = content_type
    try:
        _s3.put_object(Bucket=bucket, Key=key, Body=data, **extra)
    except ClientError as e:
        msg = e.response.get("Error", {}).get("Message", str(e))
        raise RuntimeError(f"S3 put_object failed for s3://{bucket}/{key}: {msg}") from e


# -----------------------
# JSON helpers
# -----------------------
def get_json(bucket: str, key: str):
    data = get_bytes(bucket, key)
    return json.loads(data.decode("utf-8"))


def put_json(bucket: str, key: str, obj: dict) -> None:
    put_bytes(bucket, key, json.dumps(obj).encode("utf-8"), content_type="application/json")


# -----------------------
# Image helper
# -----------------------
def load_avatar_rgb(bucket: str, key: str, width: int, height: int) -> np.ndarray:
    """
    Load an image from S3, convert to RGB, resize to (width,height),
    return uint8 array HxWx3.
    """
    data = get_bytes(bucket, key)
    im = Image.open(io.BytesIO(data)).convert("RGB")
    im = im.resize((width, height), Image.LANCZOS)
    return np.asarray(im, dtype=np.uint8)


# -----------------------
# Misc utilities
# -----------------------
def parse_s3_url(url: str) -> Tuple[str, str]:
    """
    Parse 's3://bucket/key' -> (bucket, key)
    """
    if not url.startswith("s3://"):
        raise ValueError("S3 URL must start with s3://")
    rest = url[5:]
    parts = rest.split("/", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise ValueError("Invalid S3 URL; expected s3://bucket/key")
    return parts[0], parts[1]
