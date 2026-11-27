"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// A voice conversation with the speech-to-speech service over the OpenAI Realtime protocol
// (WebRTC): the microphone and the spoken answer are audio tracks, events (transcripts, turn
// changes) go over the "oai-events" data channel. The handshake goes through
// /api/speech-to-speech/calls; the service detects turns itself (VAD), and speaking while it
// answers interrupts it.

type Message = {
  id: number
  role: "user" | "assistant" | "note"
  text: string
  pending?: boolean
  meta?: string
}

type State = "idle" | "connecting" | "listening" | "speaking" | "thinking" | "answering" | "muted"

const STATES: Record<State, { label: string; dot: string }> = {
  idle: { label: "Not connected", dot: "bg-muted-foreground/40" },
  connecting: { label: "Connecting…", dot: "bg-amber-400 animate-pulse" },
  listening: { label: "Listening", dot: "bg-emerald-500" },
  speaking: { label: "You are speaking", dot: "bg-sky-500" },
  thinking: { label: "Thinking", dot: "bg-amber-400 animate-pulse" },
  answering: { label: "Assistant speaking", dot: "bg-sky-500" },
  muted: { label: "Microphone muted", dot: "bg-muted-foreground/40" },
}

type Connection = {
  pc: RTCPeerConnection
  dc: RTCDataChannel
  audio: HTMLAudioElement
  audioContext: AudioContext
  analyser: AnalyserNode | null
  mic: MediaStream | null
  callId: string | null
}

// what the service sends; only the fields used here
type ServerEvent = {
  type: string
  delta?: string
  transcript?: string
  response?: { status?: string }
  error?: { type?: string; message?: string }
}

const CONNECT_TIMEOUT_MS = 10_000

export function ConversationView() {
  const [state, setState] = useState<State>("idle")
  const [messages, setMessages] = useState<Message[]>([])
  const [answering, setAnswering] = useState(false)
  const [muted, setMuted] = useState(false)
  const [hasMic, setHasMic] = useState(false)
  const [text, setText] = useState("")

  const connection = useRef<Connection | null>(null)
  const nextId = useRef(0)
  // the messages being filled in by the current turn
  const userMessage = useRef<number | null>(null)
  const assistantMessage = useRef<number | null>(null)
  // when the user stopped speaking and the answer started, for the latency under the answer
  const turn = useRef<{ stoppedAt?: number; firstOutputAt?: number }>({})
  const chat = useRef<HTMLDivElement>(null)
  const meter = useRef<HTMLDivElement>(null)
  const mutedRef = useRef(false)

  const add = useCallback((message: Omit<Message, "id">) => {
    const id = nextId.current++
    setMessages((list) => [...list, { id, ...message }])
    return id
  }, [])

  const change = useCallback((id: number, update: (m: Message) => Partial<Message>) => {
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...update(m) } : m)))
  }, [])

  const note = useCallback((text: string) => add({ role: "note", text }), [add])

  // newest message in view
  useEffect(() => {
    chat.current?.scrollTo({ top: chat.current.scrollHeight })
  }, [messages])

  const disconnect = useCallback((reason?: string) => {
    const c = connection.current
    if (!c) return
    connection.current = null
    c.pc.close()
    c.audio.srcObject = null
    void c.audioContext.close()
    c.mic?.getTracks().forEach((t) => t.stop())
    if (c.callId) {
      void fetch(`/api/speech-to-speech/calls/${encodeURIComponent(c.callId)}`, { method: "DELETE", keepalive: true }).catch(() => {})
    }
    userMessage.current = null
    assistantMessage.current = null
    mutedRef.current = false
    setMuted(false)
    setAnswering(false)
    setHasMic(false)
    setState("idle")
    if (reason) note(reason)
  }, [note])

  // leaving the page ends the conversation, so the service's only slot frees up
  useEffect(() => () => disconnect(), [disconnect])

  const listening = useCallback(() => setState(mutedRef.current ? "muted" : "listening"), [])

  const onEvent = useCallback((event: ServerEvent) => {
    const firstOutput = () => {
      turn.current.firstOutputAt ??= performance.now()
    }
    switch (event.type) {
      case "session.created":
        listening()
        note("Connected. Start talking.")
        break
      case "input_audio_buffer.speech_started":
        // barge-in: the service cancels its answer itself
        turn.current = {}
        userMessage.current = add({ role: "user", text: "…", pending: true })
        setState("speaking")
        break
      case "input_audio_buffer.speech_stopped":
        turn.current.stoppedAt = performance.now()
        setState("thinking")
        break
      case "conversation.item.input_audio_transcription.delta":
        if (userMessage.current !== null && event.delta) {
          const delta = event.delta
          change(userMessage.current, (m) => ({ text: (m.text === "…" ? "" : m.text) + delta }))
        }
        break
      case "conversation.item.input_audio_transcription.completed": {
        const id = userMessage.current ?? add({ role: "user", text: "" })
        const stoppedAt = turn.current.stoppedAt
        change(id, () => ({
          text: event.transcript?.trim() || "(nothing recognized)",
          pending: false,
          meta: stoppedAt ? `transcribed after ${seconds(performance.now() - stoppedAt)}` : undefined,
        }))
        userMessage.current = null
        break
      }
      case "response.created":
        assistantMessage.current = add({ role: "assistant", text: "", pending: true })
        setAnswering(true)
        break
      case "response.output_audio_transcript.delta":
      case "response.output_text.delta": {
        const delta = event.delta ?? ""
        assistantMessage.current ??= add({ role: "assistant", text: "" })
        change(assistantMessage.current, (m) => ({ text: m.text + delta, pending: false }))
        firstOutput()
        setState("answering")
        break
      }
      case "output_audio_buffer.started":
        setState("answering")
        break
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        listening()
        break
      case "response.done": {
        const status = event.response?.status
        const { stoppedAt, firstOutputAt } = turn.current
        if (assistantMessage.current !== null) {
          change(assistantMessage.current, (m) => ({
            pending: false,
            text: m.text || (status === "cancelled" ? "(interrupted)" : "(no answer)"),
            meta: [
              firstOutputAt && stoppedAt ? `answer started ${seconds(firstOutputAt - stoppedAt)} after you stopped` : null,
              status && status !== "completed" ? status : null,
            ].filter(Boolean).join(" · ") || undefined,
          }))
        }
        assistantMessage.current = null
        setAnswering(false)
        // the service plays out its buffer and sends no output_audio_buffer.stopped
        listening()
        break
      }
      case "error":
        note(event.error?.type === "session_limit_reached"
          ? "The service is busy with another conversation. Try again in a few seconds."
          : `Error: ${event.error?.message ?? "unknown"}`)
        break
    }
  }, [add, change, listening, note])

  async function connect() {
    setState("connecting")
    let mic: MediaStream | null = null
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        })
      } catch {
        note("No access to the microphone. You can still type; answers are spoken.")
      }
    } else {
      note("The microphone needs a secure connection (HTTPS). You can still type; answers are spoken.")
    }

    const pc = new RTCPeerConnection()
    const audio = new Audio()
    audio.autoplay = true
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0] ?? new MediaStream([e.track])
    }
    if (mic) mic.getAudioTracks().forEach((track) => pc.addTrack(track, mic))
    else pc.addTransceiver("audio", { direction: "recvonly" })
    const dc = pc.createDataChannel("oai-events")
    dc.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data))
      } catch {
        // not JSON
      }
    }

    try {
      await pc.setLocalDescription(await pc.createOffer())
      const response = await fetch("/api/speech-to-speech/calls", {
        method: "POST",
        headers: { "content-type": "application/sdp" },
        body: pc.localDescription?.sdp,
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.detail ?? `The app answered with ${response.status}.`)
      }
      const callId = response.headers.get("x-call-id")
      await pc.setRemoteDescription({ type: "answer", sdp: await response.text() })
      await new Promise<void>((resolve, reject) => {
        if (dc.readyState === "open") return resolve()
        const timer = setTimeout(
          () => reject(new Error("The audio connection did not open within 10 s. Audio goes directly to the service over UDP, so this computer must reach it (e.g. over Tailscale) and no firewall may block it.")),
          CONNECT_TIMEOUT_MS,
        )
        dc.onopen = () => {
          clearTimeout(timer)
          resolve()
        }
      })
      const audioContext = new AudioContext()
      let analyser: AnalyserNode | null = null
      if (mic) {
        analyser = audioContext.createAnalyser()
        analyser.fftSize = 512
        audioContext.createMediaStreamSource(mic).connect(analyser)
      }
      connection.current = { pc, dc, audio, audioContext, analyser, mic, callId }
      pc.onconnectionstatechange = () => {
        if (connection.current?.pc === pc && (pc.connectionState === "failed" || pc.connectionState === "closed")) {
          disconnect(`The connection was lost (${pc.connectionState}).`)
        }
      }
      setHasMic(mic !== null)
      // session.created usually arrives before the channel reports open
      setState((s) => (s === "connecting" ? "listening" : s))
    } catch (e) {
      pc.close()
      mic?.getTracks().forEach((t) => t.stop())
      setState("idle")
      note(`Could not connect: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // microphone level while connected
  const connected = state !== "idle" && state !== "connecting"
  useEffect(() => {
    if (!connected) return
    const bar = meter.current
    const buffer = new Float32Array(512)
    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const analyser = connection.current?.analyser
      let level = 0
      if (analyser && !mutedRef.current) {
        analyser.getFloatTimeDomainData(buffer)
        level = Math.sqrt(buffer.reduce((sum, v) => sum + v * v, 0) / buffer.length)
      }
      if (bar) bar.style.width = `${Math.min(100, level * 400)}%`
    }
    draw()
    return () => {
      cancelAnimationFrame(frame)
      if (bar) bar.style.width = "0%"
    }
  }, [connected])

  function send(event: object) {
    const dc = connection.current?.dc
    if (dc?.readyState === "open") dc.send(JSON.stringify(event))
  }

  function interrupt() {
    send({ type: "response.cancel" })
    listening()
  }

  function toggleMute() {
    const next = !mutedRef.current
    mutedRef.current = next
    setMuted(next)
    connection.current?.mic?.getAudioTracks().forEach((t) => (t.enabled = !next))
    setState(next ? "muted" : "listening")
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const message = text.trim()
    if (!message || !connected) return
    setText("")
    add({ role: "user", text: message })
    turn.current = { stoppedAt: performance.now() }
    send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: message }] } })
    send({ type: "response.create" })
    setState("thinking")
  }

  const { label, dot } = STATES[state]

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-wrap items-center gap-2 bg-muted/60 py-3">
        {connected
          ? <Button variant="outline" onClick={() => disconnect("Conversation ended.")}>End conversation</Button>
          : <Button onClick={connect} disabled={state === "connecting"}>Start conversation</Button>}
        <Button variant="outline" onClick={interrupt} disabled={!answering} title="Stop the current answer">Interrupt</Button>
        <Button variant="outline" onClick={toggleMute} disabled={!connected || !hasMic}>{muted ? "Unmute" : "Mute"}</Button>
        <div className="ml-auto flex items-center gap-2 text-sm" aria-live="polite">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-border" aria-hidden>
            <div ref={meter} className="h-full w-0 bg-emerald-500 transition-[width] duration-75" />
          </div>
          <span className={cn("size-2.5 shrink-0 rounded-full", dot)} aria-hidden />
          <span className="text-muted-foreground">{label}</span>
        </div>
      </CardHeader>

      <div ref={chat} className="flex h-[28rem] max-h-[60vh] flex-col gap-2.5 overflow-y-auto border-t p-4">
        {messages.length === 0 && (
          <p className="m-auto max-w-sm text-center text-sm text-muted-foreground">
            Start the conversation and allow the microphone. Use headphones, otherwise the assistant may hear itself.
          </p>
        )}
        {messages.map((m) => m.role === "note"
          ? <p key={m.id} className="self-center text-center text-xs text-muted-foreground">{m.text}</p>
          : (
            <div
              key={m.id}
              className={cn(
                "max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap",
                m.role === "user" ? "self-end rounded-br-sm bg-primary text-primary-foreground" : "self-start rounded-bl-sm bg-muted",
                m.pending && "italic opacity-60",
              )}
            >
              {m.text || "…"}
              {m.meta && <small className={cn("mt-1 block text-xs not-italic", m.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground")}>{m.meta}</small>}
            </div>
          ))}
      </div>

      <CardContent className="border-t py-3">
        <form onSubmit={submit} className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="…or type a message"
            autoComplete="off"
            disabled={!connected}
            aria-label="Message"
          />
          <Button type="submit" variant="outline" disabled={!connected || !text.trim()}>Send</Button>
        </form>
      </CardContent>
    </Card>
  )
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}
