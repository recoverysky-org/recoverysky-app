import { useState, useCallback } from "react"
import { AudioModule, RecordingPresets, useAudioRecorder } from "expo-audio"

import { api } from "@/services/api"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "useVoiceInput" })

export type VoiceState = "idle" | "recording" | "processing"

export type VoiceError = "micPermissionDenied" | "recordingFailed" | "transcriptionFailed" | null

/**
 * Hook that manages voice recording and transcription for the Sky Agent input.
 *
 * Flow: startRecording → (user speaks) → stopRecording → upload → onTranscript(text)
 *
 * @param onTranscript - Called with the transcribed text when processing completes
 * @param language - BCP-47 language code to send to the transcription API (default: "en-US")
 */
export function useVoiceInput(onTranscript: (text: string) => void, language = "en-US") {
  const [state, setState] = useState<VoiceState>("idle")
  const [error, setError] = useState<VoiceError>(null)
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)

  const startRecording = useCallback(async () => {
    setError(null)
    const permission = await AudioModule.requestRecordingPermissionsAsync()
    if (!permission.granted) {
      log.warn("Microphone permission denied")
      setError("micPermissionDenied")
      return
    }
    try {
      await recorder.prepareToRecordAsync()
      recorder.record()
      setState("recording")
      log.info("Recording started")
    } catch (err) {
      log.error("Failed to start recording", { error: String(err) })
      setError("recordingFailed")
    }
  }, [recorder])

  const stopRecording = useCallback(async () => {
    setState("processing")
    try {
      await recorder.stop()
    } catch (err) {
      log.error("Failed to stop recording", { error: String(err) })
      setState("idle")
      setError("recordingFailed")
      return
    }

    const uri = recorder.uri
    if (!uri) {
      log.warn("No recording URI after stop")
      setState("idle")
      setError("recordingFailed")
      return
    }

    log.info("Uploading recording for transcription", { language })
    const result = await api.transcribeAudio(uri, language)
    setState("idle")

    if (result.kind === "ok") {
      log.info("Transcription received", { length: result.data.transcript.length })
      onTranscript(result.data.transcript)
    } else {
      log.warn("Transcription API error", { kind: result.kind })
      setError("transcriptionFailed")
    }
  }, [recorder, language, onTranscript])

  return { state, error, startRecording, stopRecording }
}
