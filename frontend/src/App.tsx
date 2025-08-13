import React, { useEffect, useRef, useState } from 'react'

type Viseme = { timeMs: number; type: string }

type ChatResp = { replyText: string; audioBase64: string; visemes: Viseme[] }

type UploadUrlResp = { url: string; key: string }

type AvatarResp = { avatarKey: string }

const API_BASE = import.meta.env.VITE_API_BASE as string
const RENDER_BASE = import.meta.env.VITE_RENDER_BASE as string

export default function App() {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [userText, setUserText] = useState('')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [avatarKey, setAvatarKey] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('Idle')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const visemesRef = useRef<Viseme[]>([])
  const videoRef = useRef<HTMLVideoElement>(null)

  // draw mouth animation on local canvas (fallback demo)
  useEffect(() => {
    let raf = 0
    const ctx = canvasRef.current?.getContext('2d')

    function draw() {
      if (!ctx) { raf = requestAnimationFrame(draw); return }
      const W = canvasRef.current!.width
      const H = canvasRef.current!.height
      ctx.clearRect(0,0,W,H)
      if (image) ctx.drawImage(image, 0, 0, W, H)
      else { ctx.fillStyle = '#191922'; ctx.fillRect(0,0,W,H); ctx.fillStyle = '#888'; ctx.fillText('Upload a face photo →', 24, 40) }
      const tMs = (audioRef.current?.currentTime || 0) * 1000
      const v = currentViseme(visemesRef.current, tMs)
      drawMouth(ctx, W, H, v)
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [image])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return

    // Show locally
    const img = new Image()
    img.onload = () => setImage(img)
    img.src = URL.createObjectURL(f)

    // Upload to S3 using presigned URL, then request avatar generation
    setStatus('Uploading…')
    const up = await fetch(`${API_BASE}/upload-url`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ contentType: f.type })
    }).then(r=>r.json()) as UploadUrlResp

    await fetch(up.url, { method:'PUT', headers:{ 'Content-Type': f.type }, body: f })

    setStatus('Generating avatar…')
    const av = await fetch(`${API_BASE}/avatar`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ s3Key: up.key, style: 'stylized portrait, clean background' })
    }).then(r=>r.json()) as AvatarResp

    setAvatarKey(av.avatarKey)
    setStatus('Avatar ready')
  }

  async function send() {
    if (!userText.trim()) return
    setBusy(true)
    try {
      setStatus('Calling /chat…')
      const data: ChatResp = await fetch(`${API_BASE}/chat`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userText })}).then(r=>r.json())
      setReply(data.replyText)
      visemesRef.current = data.visemes

      // Play audio
      const audioUrl = base64Mp3ToUrl(data.audioBase64)
      if (audioRef.current) { audioRef.current.src = audioUrl; await audioRef.current.play() }

      // Start streamed video if avatar ready
      if (avatarKey) {
        setStatus('Starting WebRTC stream…')
        await startStream(avatarKey, data.visemes)
        setStatus('Streaming')
      } else {
        setStatus('Avatar not ready; showing local canvas only')
      }
    } catch (e) {
      console.error(e)
      setStatus('Error')
    } finally { setBusy(false) }
  }

  async function startStream(avatarKey: string, visemes: Viseme[]) {
    const pc = new RTCPeerConnection()
    pc.ontrack = ev => { if (videoRef.current) videoRef.current.srcObject = ev.streams[0] }
    const offer = await pc.createOffer({ offerToReceiveVideo: true })
    await pc.setLocalDescription(offer)

    const answer = await fetch(`${RENDER_BASE}/webrtc/offer`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ sdp: offer.sdp, type: offer.type, avatarKey, visemes, width: 512, height: 512 })
    }).then(r=>r.json())

    await pc.setRemoteDescription(answer)
  }

  return (
    <div className="wrap">
      <h1>Talking Avatar (AWS)</h1>
      <p>Upload a face photo → we generate an avatar → type a prompt to hear a reply. A live video is streamed back via WebRTC.</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <input type="file" accept="image/*" onChange={onFile} />
        <div style={{ fontSize: 12, opacity: .8, marginTop: 6 }}>Status: {status}</div>
      </div>

      <div className="grid">
        <div className="card">
          <canvas ref={canvasRef} width={512} height={512} style={{ width:'100%', borderRadius: 12 }} />
          <video ref={videoRef} autoPlay playsInline muted style={{ width:'100%', marginTop: 8, borderRadius: 12, background:'#000' }} />
        </div>
        <div className="card">
          <textarea rows={8} value={userText} onChange={e=>setUserText(e.target.value)} style={{ width:'100%', marginBottom: 8 }} placeholder="Say something…" />
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <button onClick={send} disabled={busy || !avatarKey}>{busy? 'Talking…':'Send'}</button>
            {!avatarKey && <span style={{ fontSize:12, opacity:.8 }}>Upload a photo to generate the avatar first.</span>}
          </div>
          <p style={{ marginTop:12 }}><strong>Avatar:</strong> {reply}</p>
          <audio ref={audioRef} />
        </div>
      </div>
    </div>
  )
}

function base64Mp3ToUrl(b64: string){
  const bin = atob(b64); const buf = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i)
  return URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }))
}

function currentViseme(marks: Viseme[], tMs: number): string { let last='rest'; for (const m of marks){ if (tMs >= m.timeMs) last = m.type; else break } return last }
function drawMouth(ctx: CanvasRenderingContext2D, W: number, H: number, viseme: string){ const cx=W*.5,cy=H*.7,baseW=W*.22,baseH=H*.035; const open=visemeToOpen(viseme); const h=baseH*(.5+1.8*open); ctx.save(); ctx.translate(cx,cy); ctx.beginPath(); ctx.ellipse(0,0,baseW,h,0,0,Math.PI*2); ctx.fillStyle='#a11'; ctx.fill(); ctx.restore() }
function visemeToOpen(v: string){ switch(v){case 'p':case 'b':case 'm': return .1; case 't':case 'd':case 's':case 'z': return .25; case 'aa':case 'ae':case 'ah': return 1; case 'ao':case 'ow': return .8; case 'iy':case 'ih': return .4; case 'uh':case 'uw': return .6; case 'SIL': return .05; default: return .5 } }
