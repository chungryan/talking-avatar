import React, { useMemo, useRef, useState } from 'react'
import { chat } from '../api'

type Props = { avatarKey: string | null }

const ANIMATOR_BASE = import.meta.env.VITE_ANIMATOR_BASE
const ASSETS_BUCKET = import.meta.env.VITE_ASSETS_BUCKET

export default function ChatPanel({ avatarKey }: Props) {
  const [text, setText] = useState('Hi there!')
  const [loading, setLoading] = useState(false)
  const [reply, setReply] = useState('')
  const [width, setWidth] = useState(512)
  const [height, setHeight] = useState(512)
  const [fps, setFps] = useState(15)
  const [streamSrc, setStreamSrc] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const canSend = useMemo(() => Boolean(avatarKey && text.trim()), [avatarKey, text])

  function stopStream() { setStreamSrc('') }

  async function send() {
    if (!canSend) return
    setLoading(true)
    try {
      const out = await chat(text) // { replyText, audioKey, audioUrl }
      setReply(out.replyText)

      // Build GET URL (no CORS needed for <img>)
      const q = new URLSearchParams({
        bucket: ASSETS_BUCKET,
        avatarKey: avatarKey!,
        audioKey: out.audioKey,
        w: String(width),
        h: String(height),
        fps: String(fps),
        ts: String(Date.now())
      })
      setStreamSrc(`${ANIMATOR_BASE.replace(/\/+$/,'')}/mjpeg?${q.toString()}`)

      // Play audio locally
      const a = audioRef.current || new Audio()
      a.src = out.audioUrl
      await a.play()
      if (!audioRef.current) audioRef.current = a
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <h2>2) Chat</h2>
      <div className="row">
        <input value={text} onChange={e=>setText(e.target.value)} placeholder="Say something…" />
        <button onClick={send} disabled={!canSend || loading}>{loading ? '…' : 'Send'}</button>
        <button onClick={stopStream}>■ Stop</button>
      </div>
      {reply && <p className="reply">Avatar: {reply}</p>}
      <div className="stream">
        {streamSrc ? <img src={streamSrc} alt="avatar stream" /> : <div className="placeholder">Stream appears here</div>}
      </div>
      <audio ref={audioRef} hidden />
    </div>
  )
}
