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
  const [status, setStatus] = useState('')

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)

  const canSend = useMemo(
    () => Boolean(ASSETS_BUCKET && avatarKey && text.trim()),
    [avatarKey, text]
  )

  function stopStream() {
    if (iframeRef.current) iframeRef.current.src = 'about:blank'
    setStatus('Stopped.')
  }

  async function send() {
    if (!canSend) return
    setLoading(true); setStatus('Synthesizing…')
    try {
      const out = await chat(text) // { replyText, audioBase64, visemes }
      setReply(out.replyText)

      // Play audio locally (base64 MP3)
      const a = audioRef.current || new Audio()
      a.src = `data:audio/mpeg;base64,${out.audioBase64}`
      await a.play()
      if (!audioRef.current) audioRef.current = a

      // POST to Animator /mjpeg via hidden form -> iframe
      const form = formRef.current, frame = iframeRef.current
      if (!form || !frame) throw new Error('Form/iframe not ready')

      frame.src = 'about:blank' // force fresh connection

      form.action = `${ANIMATOR_BASE.replace(/\/+$/, '')}/mjpeg`
      form.method = 'POST'
      form.enctype = 'multipart/form-data'
      form.target = 'mjpegFrame'

      ;(form.elements.namedItem('bucket') as HTMLInputElement).value = ASSETS_BUCKET
      ;(form.elements.namedItem('avatarKey') as HTMLInputElement).value = avatarKey!
      ;(form.elements.namedItem('audioBase64') as HTMLTextAreaElement).value = out.audioBase64
      ;(form.elements.namedItem('width') as HTMLInputElement).value = String(width)
      ;(form.elements.namedItem('height') as HTMLInputElement).value = String(height)
      ;(form.elements.namedItem('fps') as HTMLInputElement).value = String(fps)

      setStatus('Streaming…')
      form.submit()
    } catch (e: any) {
      console.error(e)
      setStatus(`Error: ${e?.message || e}`)
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
      </div>

      <div className="row" style={{marginTop:8}}>
        <label>Size:&nbsp;</label>
        <input type="number" min={128} max={1024} value={width} onChange={e=>setWidth(+e.target.value)} style={{width:100}} /> ×
        <input type="number" min={128} max={1024} value={height} onChange={e=>setHeight(+e.target.value)} style={{width:100}} />
        <label style={{marginLeft:12}}>FPS:&nbsp;</label>
        <input type="number" min={5} max={30} value={fps} onChange={e=>setFps(+e.target.value)} style={{width:80}} />
        <div style={{flex:1}} />
        <button onClick={stopStream}>■ Stop</button>
      </div>

      {reply && <p className="reply">Avatar: {reply}</p>}

      <div className="stream">
        <iframe
          ref={iframeRef}
          name="mjpegFrame"
          title="MJPEG Stream"
          style={{ width:'100%', height:'100%', border:'none', background:'#000' }}
        />
      </div>

      <div className="hint" style={{marginTop:8}}>{status}</div>

      {/* hidden form used to POST into the iframe */}
      <form ref={formRef} style={{ display:'none' }} method="POST" target="mjpegFrame" encType="multipart/form-data">
        <input type="hidden" name="bucket" />
        <input type="hidden" name="avatarKey" />
        <textarea name="audioBase64" />
        <input type="hidden" name="width" />
        <input type="hidden" name="height" />
        <input type="hidden" name="fps" />
      </form>

      <audio ref={audioRef} hidden />
    </div>
  )
}
