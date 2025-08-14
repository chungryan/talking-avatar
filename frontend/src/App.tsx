import React, { useState } from 'react'
import UploadPanel from './components/UploadPanel'
import ChatPanel from './components/ChatPanel'

export default function App() {
  const [avatarKey, setAvatarKey] = useState<string | null>(null)

  return (
    <div className="container">
      <header>
        <h1>Talking Avatar (MJPEG)</h1>
        <div className="envs">
          <code>API: {import.meta.env.VITE_API_BASE}</code>
          <code>Renderer: {import.meta.env.VITE_RENDER_BASE}</code>
        </div>
      </header>

      <main>
        <UploadPanel onAvatarReady={setAvatarKey} />
        <ChatPanel avatarKey={avatarKey} />
      </main>

      <footer>
        <small>Built with Vite + React • MJPEG streaming (no WebRTC)</small>
      </footer>
    </div>
  )
}
