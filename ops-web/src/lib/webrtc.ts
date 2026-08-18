import type { IceServer } from './repo'

export async function createAudioPeer(iceServers: IceServer[]): Promise<{
  pc: RTCPeerConnection
  local: MediaStream
}> {
  const pc = new RTCPeerConnection({
    iceServers: iceServers as RTCIceServer[],
    iceCandidatePoolSize: 8,
  })
  const local = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  for (const track of local.getAudioTracks()) pc.addTrack(track, local)
  return { pc, local }
}

export async function enableVideoOnPeer(pc: RTCPeerConnection, local: MediaStream): Promise<void> {
  if (local.getVideoTracks().some((track) => track.readyState === 'live')) return
  const cam = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  })
  for (const track of cam.getVideoTracks()) {
    local.addTrack(track)
    pc.addTrack(track, local)
  }
}

export async function disableVideoOnPeer(pc: RTCPeerConnection, local: MediaStream): Promise<void> {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'video') continue
    sender.track.stop()
    await sender.replaceTrack(null)
  }
  for (const track of [...local.getVideoTracks()]) {
    track.stop()
    local.removeTrack(track)
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop())
}

export function remoteStreamOf(pc: RTCPeerConnection): MediaStream | null {
  const tracks = pc.getReceivers().map((r) => r.track).filter((t): t is MediaStreamTrack => Boolean(t))
  if (tracks.length === 0) return null
  return new MediaStream(tracks)
}

export type MixRecorder = {
  start: () => void
  stop: () => Promise<Blob>
}

export function mixCallRecorder(local: MediaStream, remote: MediaStream | null): MixRecorder {
  const ctx = new AudioContext()
  const dest = ctx.createMediaStreamDestination()
  const tap = (stream: MediaStream | null) => {
    if (!stream?.getAudioTracks().length) return
    ctx.createMediaStreamSource(stream).connect(dest)
  }
  tap(local)
  tap(remote)
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
  const chunks: Blob[] = []
  let recorder: MediaRecorder | null = null
  return {
    start() {
      void ctx.resume()
      recorder = new MediaRecorder(dest.stream, { mimeType: mime })
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.start(1000)
    },
    stop() {
      return new Promise((resolve, reject) => {
        const finish = () => {
          void ctx.close().catch(() => undefined)
          resolve(new Blob(chunks, { type: mime }))
        }
        if (!recorder || recorder.state === 'inactive') {
          finish()
          return
        }
        recorder.onerror = () => reject(new Error('Recording failed.'))
        recorder.onstop = finish
        recorder.stop()
      })
    },
  }
}
