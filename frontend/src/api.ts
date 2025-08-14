import { AvatarGenerateResponse, ChatResponse, RenderStartResponse, UploadUrlResponse, Viseme } from './types'

const API_BASE = import.meta.env.VITE_API_BASE
const RENDER_BASE = import.meta.env.VITE_RENDER_BASE

export async function getUploadUrl(contentType: string): Promise<UploadUrlResponse> {
  const res = await fetch(`${API_BASE}/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType })
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function putToSignedUrl(url: string, file: File, contentType: string) {
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file })
  if (!res.ok) throw new Error(`S3 PUT failed: ${res.status}`)
}

export async function generateAvatar(s3Key: string, style: string): Promise<AvatarGenerateResponse> {
  const res = await fetch(`${API_BASE}/avatar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ s3Key, style })
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function chat(userText: string): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userText })
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function startRender(avatarKey: string, visemes: Viseme[], width = 512, height = 512, fps = 15): Promise<string> {
  const res = await fetch(`${RENDER_BASE}/render/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ avatarKey, visemes, width, height, fps })
  })
  if (!res.ok) throw new Error(await res.text())
  const data = (await res.json()) as RenderStartResponse
  // prepend base since API returns relative stream path
  return `${RENDER_BASE}${data.streamUrl}?ts=${Date.now()}`
}
