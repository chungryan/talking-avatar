import React, { useRef, useState } from 'react'
import { generateAvatar, getUploadUrl, putToSignedUrl } from '../api'

type Props = {
  onAvatarReady: (avatarKey: string) => void
}

export default function UploadPanel({ onAvatarReady }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [sourceKey, setSourceKey] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('stylized portrait, soft background, pleasant lighting')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUpload() {
    try {
      setError(null)
      const f = fileRef.current?.files?.[0]
      if (!f) return
      setUploading(true)
      const contentType = f.type || 'application/octet-stream'
      const { url, key } = await getUploadUrl(contentType)
      await putToSignedUrl(url, f, contentType)
      setSourceKey(key)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally { setUploading(false) }
  }

  async function handleGenerate() {
    if (!sourceKey) return
    try {
      setError(null); setGenerating(true)
      const out = await generateAvatar(sourceKey, prompt)
      onAvatarReady(out.avatarKey)
    } catch (e: any) { setError(e.message || String(e)) }
    finally { setGenerating(false) }
  }

  return (
    <div className="card">
      <h2>1) Upload & Generate Avatar</h2>
      <input ref={fileRef} type="file" accept="image/*" />
      <button onClick={handleUpload} disabled={uploading}>
        {uploading ? 'Uploading…' : 'Upload photo'}
      </button>

      <label className="mt">Avatar style prompt</label>
      <input value={prompt} onChange={e=>setPrompt(e.target.value)} />
      <button onClick={handleGenerate} disabled={!sourceKey || generating}>
        {generating ? 'Generating…' : 'Generate Avatar'}
      </button>

      {sourceKey && <p className="hint">Uploaded: <code>{sourceKey}</code></p>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
