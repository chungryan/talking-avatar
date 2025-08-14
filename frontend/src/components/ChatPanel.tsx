import React, { useRef, useState } from 'react'
import { chat, startRender } from '../api'
import { Viseme } from '../types'

type Props = {
  avatarKey: string | null
}

export default function ChatPanel({ avatarKey }: Props) {
  const [text, setText] = useState('Hi there!')
  const [loading, setLoading] = useState(false)
  const [reply, setReply] = useState('')
  const [streamSrc, setStreamSrc] = useState<string>('')
  const audioRef = useRef<HTMLAudioElement | null>(null)

  async function send() {
    if (!text.trim()) return
    setLoading(true)
    try {
      const out = await chat(text)
      setReply(out.replyText)

      // Start a fresh MJPEG stream for these visemes
      const url = await startRender(avatarKey || '', out.visemes as Viseme[], 512, 512, 15)
      setStreamSrc(url)

      // Play audio
      const a = audioRef.current || new Audio()
      a.src = `data:audio/mpeg;base64,${out.audioBase64}`
      a.play()
      if (!audioRef.current) audioRef.current = a
    } catch (e: any) {
      alert(e.message || String(e))
    } finally { setLoading(false) }
  }

  return (
    <div className="card">
      <h2>2) Chat</h2>
      <div className="row">
        <input value={text} onChange={e=>setText(e.target.value)} placeholder="Say something…" />
        <button onClick={send} disabled={loading}>{loading ? '…' : 'Send'}</button>
      </div>
      {reply && <p className="reply">Avatar: {reply}</p>}

      <div className="stream">
        {streamSrc ? (
          <img src={streamSrc} alt="avatar stream" />
        ) : (
          <div className="placeholder">Stream will appear here after first reply</div>
        )}
      </div>

      <audio ref={audioRef} hidden />
    </div>
  )
}
