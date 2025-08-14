import express from "express";
import { createCanvas, loadImage, ImageData } from "canvas";
import { nanoid } from "nanoid";
import { s3GetBuffer } from "./s3.js";
import { currentViseme, visemeOpenAmount, Viseme } from "./visemes.js";

const BUCKET = process.env.ASSETS_BUCKET || "";
const WIDTH  = parseInt(process.env.WIDTH  || "512", 10);
const HEIGHT = parseInt(process.env.HEIGHT || "512", 10);
const FPS    = parseInt(process.env.FPS    || "15", 10);

type Session = {
  id: string;
  avatarImg: any | null;
  visemes: Viseme[];
  startTs: number;
  width: number;
  height: number;
  fps: number;
  closing: boolean;
};

const sessions = new Map<string, Session>();
const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => res.send("ok"));

/**
 * POST /render/start
 * body: { avatarKey?: string, visemes: Viseme[], width?, height?, fps? }
 * returns: { streamUrl: `/stream/<id>` }
 */
app.post("/render/start", async (req, res) => {
  try {
    const { avatarKey = "", visemes = [], width = WIDTH, height = HEIGHT, fps = FPS } = req.body || {};
    let avatarImg: any = null;
    if (BUCKET && avatarKey) {
      try { const buf = await s3GetBuffer(BUCKET, avatarKey); avatarImg = await loadImage(buf); }
      catch (e: any) { console.warn("avatar load failed:", e?.message); }
    }
    const id = nanoid(10);
    sessions.set(id, {
      id, avatarImg, visemes,
      startTs: Date.now(),
      width: Math.max(64, Math.min(1920, width|0)),
      height: Math.max(64, Math.min(1080, height|0)),
      fps: Math.max(1, Math.min(30, fps|0)),
      closing: false
    });
    res.json({ streamUrl: `/stream/${id}` });
  } catch (e: any) {
    console.error(e);
    res.status(500).send(String(e?.message || e));
  }
});

/**
 * GET /stream/:id  => multipart/x-mixed-replace MJPEG
 */
app.get("/stream/:id", (req, res) => {
  const id = req.params.id;
  const sess = sessions.get(id);
  if (!sess) return res.status(404).send("no such session");

  const boundary = "frame";
  res.writeHead(200, {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Connection": "keep-alive",
    "Content-Type": `multipart/x-mixed-replace; boundary=${boundary}`
  });

  const { avatarImg, visemes, startTs, width, height, fps } = sess;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  let running = true;
  req.on("close", () => { running = false; sess.closing = true; sessions.delete(id); });

  const draw = () => {
    if (!running) return;
    const tMs = Date.now() - startTs;
    const v = currentViseme(visemes, tMs);

    // background + avatar
    ctx.fillStyle = "#0b0b0d"; ctx.fillRect(0, 0, width, height);
    if (avatarImg) ctx.drawImage(avatarImg, 0, 0, width, height);

    // subtle idle motion
    ctx.save();
    const t = tMs / 1000;
    ctx.translate(Math.sin(t*0.6)*3, Math.sin(t*0.9)*2);
    ctx.translate(width*0.5, height*0.65);
    ctx.rotate(Math.sin(t*0.7)*0.03);
    ctx.translate(-width*0.5, -height*0.65);

    // mouth ellipse based on viseme openness
    const baseW = width * 0.22;
    const baseH = height * 0.035;
    const open  = visemeOpenAmount(v);
    const h     = baseH * (0.5 + 1.8*open);
    ellipse(ctx, width*0.5, height*0.7, baseW, h);
    ctx.fillStyle = "#a11";
    ctx.fill();
    ctx.restore();

    const jpg = canvas.toBuffer("image/jpeg", { quality: 0.85 });
    res.write(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`);
    res.write(jpg);
    res.write("\r\n");

    setTimeout(draw, 1000 / fps);
  };
  draw();
});

function ellipse(ctx: any, cx: number, cy: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  ctx.arc(0, 0, 1, 0, Math.PI*2);
  ctx.restore();
}

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`render-service (2D MJPEG) on :${port}`));
