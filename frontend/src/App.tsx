import React, { useEffect, useRef, useState } from 'react'

type Viseme = { timeMs: number; type: string }

type ChatResp = { replyText: string; audioBase64: string; visemes: Viseme[] }

const API_BASE = import.meta.env.VITE_API_BASE as string

export default function App() {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [userText, setUserText] = useState('')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const visemesRef = useRef<Viseme[]>([])

  useEffect(() => {
    let raf = 0
    const ctx = canvasRef.current?.getContext('2d')

    function draw() {
      if (!ctx) { raf = requestAnimationFrame(draw); return }
      const W = canvasRef.current!.width
      const H = canvasRef.current!.height
      ctx.clearRect(0,0,W,H)
      if (image) {
        ctx.drawImage(image, 0, 0, W, H)
      } else {
        ctx.fillStyle = '#222'; ctx.fillRect(0,0,W,H)
        ctx.fillStyle = '#bbb'; ctx.fillText('Upload a face photo →', 24, 40)
      }
      const tMs = (audioRef.current?.currentTime || 0) * 1000
      const v = currentViseme(visemesRef.current, tMs)
      drawMouth(ctx, W, H, v)
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [image])

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const img = new Image()
    img.onload = () => setImage(img)
    img.src = URL.createObjectURL(f)
  }

  async function send() {
    if (!userText.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userText })
      })
      const data: ChatResp = await res.json()
      setReply(data.replyText)
      visemesRef.current = data.visemes

      // play audio
      const bin = atob(data.audioBase64)
      const buf = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
      const blob = new Blob([buf], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      if (audioRef.current) {
        audioRef.current.src = url
        await audioRef.current.play()
      }
    } finally { setBusy(false) }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Talking Avatar (AWS)</h1>
      <p>Upload a face photo, type a prompt, and the avatar replies with voice + mouth animation.</p>
      <input type="file" accept="image/*" onChange={onFile} />
      <div style={{ display: 'grid', gridTemplateColumns:'1fr 1fr', gap: 16, marginTop: 16 }}>
        <canvas ref={canvasRef} width={512} height={512} style={{ width:'100%', background:'#111', borderRadius: 12 }} />
        <div>
          <textarea rows={6} value={userText} onChange={e=>setUserText(e.target.value)} style={{ width:'100%' }} placeholder="Say something…" />
          <button onClick={send} disabled={busy} style={{ marginTop: 8 }}>{busy ? 'Talking…' : 'Send'}</button>
          <p><strong>Avatar:</strong> {reply}</p>
          <audio ref={audioRef} />
        </div>
      </div>
    </div>
  )
}

function currentViseme(marks: Viseme[], tMs: number): string {
  if (!marks || marks.length === 0) return 'rest'
  let last = 'rest'
  for (const m of marks) { if (tMs >= m.timeMs) last = m.type; else break }
  return last
}

function drawMouth(ctx: CanvasRenderingContext2D, W: number, H: number, viseme: string) {
  const cx = W * 0.5
  const cy = H * 0.7
  const baseW = W * 0.22
  const baseH = H * 0.035
  const openness = visemeToOpen(viseme)
  const h = baseH * (0.5 + 1.8 * openness)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.beginPath()
  ctx.ellipse(0, 0, baseW, h, 0, 0, Math.PI * 2)
  ctx.fillStyle = '#a11'
  ctx.fill()
  ctx.restore()
}

function visemeToOpen(v: string): number {
  switch (v) {
    case 'p': case 'b': case 'm': return 0.1
    case 't': case 'd': case 's': case 'z': return 0.25
    case 'aa': case 'ae': case 'ah': return 1.0
    case 'ao': case 'ow': return 0.8
    case 'iy': case 'ih': return 0.4
    case 'uh': case 'uw': return 0.6
    case 'SIL': return 0.05
    default: return 0.5
  }
}
