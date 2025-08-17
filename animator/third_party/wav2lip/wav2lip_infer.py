# Minimal Wav2Lip wrapper. Place alongside official Wav2Lip files (models.py, hparams.py, audio.py).
import os, sys, cv2, numpy as np, torch, librosa
from models import Wav2Lip
from hparams import hparams as hp
from audio import melspectrogram as w2l_melspec

def _normalize(img_u8): return img_u8.astype(np.float32)/255.0*2.0-1.0
def _denorm(img_pm1):   return ((np.clip(img_pm1,-1,1)+1.0)*0.5*255.0+0.5).astype(np.uint8)
def _resample(y, sr, target): return y.astype(np.float32) if sr==target else librosa.resample(y.astype(np.float32), orig_sr=sr, target_sr=target)

class Wav2LipWrapper:
    def __init__(self, model_path: str, device: str="cuda", fps: int=15):
        self.device = torch.device("cuda" if (device=="cuda" and torch.cuda.is_available()) else "cpu")
        self.fps = max(1,min(30,int(fps)))
        self.mel_step_size = 16
        self.model = self._load(model_path).to(self.device).eval()

    def _load(self, path):
        m = Wav2Lip()
        sd = torch.load(path, map_location="cpu")
        if isinstance(sd, dict) and "state_dict" in sd:
            sd = {k.replace("module.",""): v for k,v in sd["state_dict"].items()}
        m.load_state_dict(sd, strict=False)
        return m

    def _center_crop(self, rgb):
        h,w,_ = rgb.shape
        size = int(min(h,w)*0.62)
        x0 = max(0, w//2 - size//2); y0 = max(0, int(h*0.38) - size//2)
        x0 = min(x0, w-size); y0 = min(y0, h-size)
        return rgb[y0:y0+size, x0:x0+size].copy(), (x0,y0,size)

    def generate(self, avatar_rgb: np.ndarray, audio_pcm_mono_f32: np.ndarray, sr: int):
        face, (x0,y0,S) = self._center_crop(avatar_rgb)
        y = _resample(audio_pcm_mono_f32, sr, hp.sample_rate)
        mel = w2l_melspec(y)  # (80,T)
        mel = (mel - mel.min()) / (mel.max() - mel.min() + 1e-8)

        H=W=96
        face96 = cv2.resize(face, (W,H))
        masked = face96.copy()
        masked[H//2:,:,:] = 0

        img_full = _normalize(face96)[None,...]   # (1,96,96,3)
        img_mask = _normalize(masked)[None,...]   # (1,96,96,3)

        mel_idx_multiplier = 80.0 / float(self.fps)
        i = 0
        while True:
            m0 = int(i*mel_idx_multiplier); m1 = m0 + self.mel_step_size
            if m1 >= mel.shape[1]: break
            mel_chunk = mel[:, m0:m1][None,None,...].astype(np.float32)     # (1,1,80,16)
            img6 = np.concatenate([img_mask.transpose(0,3,1,2), img_full.transpose(0,3,1,2)], axis=1)  # (1,6,96,96)

            with torch.no_grad():
                img_t = torch.from_numpy(img6).to(self.device)
                mel_t = torch.from_numpy(mel_chunk).to(self.device)
                out = self.model(mel_t, img_t).squeeze(0).permute(1,2,0).cpu().numpy()  # (96,96,3) [-1,1]

            out_u8 = cv2.resize(_denorm(out), (S,S), interpolation=cv2.INTER_CUBIC)
            frame = avatar_rgb.copy(); frame[y0:y0+S, x0:x0+S] = out_u8
            yield frame
            i += 1
