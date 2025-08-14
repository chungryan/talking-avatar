export type Viseme = { timeMs: number; type: string }

export type UploadUrlResponse = {
  url: string
  key: string
}

export type AvatarGenerateResponse = {
  avatarKey: string
  width: number
  height: number
}

export type ChatResponse = {
  replyText: string
  audioBase64: string // MP3 base64
  visemes: Viseme[]
}

export type RenderStartResponse = {
  streamUrl: string // e.g. /stream/<id>
}
