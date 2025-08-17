# load portrait from S3
import boto3, io, os
from PIL import Image
import numpy as np

_s3 = boto3.client("s3", region_name=os.getenv("AWS_REGION"))

def load_avatar_rgb(bucket: str, key: str, width: int, height: int) -> np.ndarray:
    obj = _s3.get_object(Bucket=bucket, Key=key)
    im = Image.open(io.BytesIO(obj["Body"].read())).convert("RGB")
    im = im.resize((width, height), Image.LANCZOS)
    return np.array(im)  # HxWx3 uint8
