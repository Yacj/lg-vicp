import type { ApiEnvelope, TranscribeVoiceResult } from '@/api/types'
import { aiApi } from '@/api/modules/ai'

export type VoicePhase = 'idle' | 'recording' | 'recognizing'

export type VoiceStopReason = 'tooShort' | 'swiped'

export interface VoiceStopOutcome {
  cancelled: boolean
  reason?: VoiceStopReason
}

const MIN_RECORD_SECONDS = 1
const MAX_RECORD_MS = 60_000

/**
 * 语音输入状态机：idle → recording → recognizing → idle。
 * 录音通过 uni.getRecorderManager() 完成，识别由后端转发百度短语音识别极速版。
 * 小程序录音用 aac（对应后端 m4a），App 端用 wav（PCM 容器），采样率均固定 16000。
 */
export function useVoiceInput(options: {
  onResult: (text: string) => void
}) {
  const phase = ref<VoicePhase>('idle')
  const duration = ref(0)
  /** 上滑意图：UI 据此切换“松开取消”提示，并决定最终是否取消 */
  const cancelIntent = ref(false)

  const toast = useGlobalToast()

  let timer: ReturnType<typeof setInterval> | null = null
  let recorder: UniApp.RecorderManager | null = null
  let pendingFile: string | null = null
  /** 取消/过短时标记丢弃，避免 onStop 仍然触发识别 */
  let shouldDiscard = false
  /** recorder.start() 已调用且 onStart 已回调，表示底层真正进入录音态 */
  let recordingStarted = false
  /** 用户在录音真正开始前已松手，需等 onStart 后再补执行 stop */
  let stopPending = false
  /** recorder.stop() 已调用但 onStop 尚未回调，期间禁止再次 start/stop */
  let isStopping = false

  function clearTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  /** 后端识别使用的音频格式：小程序 aac 对应 m4a，App 端为 wav */
  function resolveAsrFormat(): 'm4a' | 'wav' {
    let format: 'm4a' | 'wav' = 'wav'
    // #ifdef MP-WEIXIN
    format = 'm4a'
    // #endif
    return format
  }

  function ensureRecorder() {
    if (!recorder) {
      recorder = uni.getRecorderManager()
      recorder.onStart(handleRecordStart)
      recorder.onStop(handleRecordStop)
      recorder.onError(handleRecordError)
    }
    return recorder
  }

  function handleRecordStart() {
    recordingStarted = true
    // 用户在录音真正开始前就松手了，此时才能安全调用 stop，避免 stop 被底层忽略
    if (stopPending) {
      stopPending = false
      isStopping = true
      recorder?.stop()
    }
  }

  function handleRecordStop(event: { tempFilePath: string }) {
    isStopping = false
    stopPending = false
    recordingStarted = false
    if (shouldDiscard) {
      shouldDiscard = false
      pendingFile = null
      phase.value = 'idle'
      return
    }

    pendingFile = event.tempFilePath
    void finalizeRecording()
  }

  function handleRecordError(error: { errMsg?: string }) {
    isStopping = false
    stopPending = false
    recordingStarted = false
    clearTimer()
    shouldDiscard = false
    pendingFile = null
    cancelIntent.value = false
    phase.value = 'idle'
    toast.error(error.errMsg || '录音失败，请检查麦克风权限')
  }

  async function finalizeRecording() {
    if (!pendingFile) {
      phase.value = 'idle'
      return
    }

    phase.value = 'recognizing'
    try {
      const speech = await readFileAsBase64(pendingFile)
      const response = await aiApi.transcribeVoice({
        speech,
        format: resolveAsrFormat(),
        rate: 16000,
        channel: 1,
        durationMs: duration.value * 1000,
      }).send() as ApiEnvelope<TranscribeVoiceResult>

      const text = response.data.text?.trim() ?? ''
      if (!text) {
        toast.info('未识别到语音内容')
      }
      else {
        options.onResult(text)
      }
    }
    catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : '语音识别失败，请重试')
    }
    finally {
      pendingFile = null
      phase.value = 'idle'
    }
  }

  function readFileAsBase64(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      uni.getFileSystemManager().readFile({
        filePath,
        encoding: 'base64',
        success: (result) => resolve(result.data as string),
        fail: () => reject(new Error('读取录音文件失败')),
      })
    })
  }

  function start() {
    if (phase.value !== 'idle' || isStopping || stopPending) {
      return
    }

    cancelIntent.value = false
    shouldDiscard = false
    duration.value = 0
    pendingFile = null
    recordingStarted = false
    stopPending = false
    phase.value = 'recording'

    const recordOptions: UniApp.RecorderManagerStartOptions = {
      duration: MAX_RECORD_MS,
      sampleRate: 16000,
      numberOfChannels: 1,
      format: resolveAsrFormat() === 'm4a' ? 'aac' : 'wav',
    }
    // #ifdef MP-WEIXIN
    recordOptions.encodeBitRate = 48000
    // #endif

    ensureRecorder().start(recordOptions)

    timer = setInterval(() => {
      duration.value += 1
    }, 1000)
  }

  async function stop(): Promise<VoiceStopOutcome> {
    // 非录音态或已进入停止流程时，忽略重复 stop，防止 recorder 在停止过程中被再次 start/stop
    if (phase.value !== 'recording' || isStopping) {
      return { cancelled: true }
    }

    clearTimer()

    const cancelledBySwipe = cancelIntent.value
    const tooShort = duration.value < MIN_RECORD_SECONDS

    if (cancelledBySwipe || tooShort) {
      shouldDiscard = true
    }

    // 录音尚未真正开始（start 异步未完成）时立即 stop 会被底层忽略，
    // 导致 recorder 卡在 recording/paused 态，后续 start 报 "is recording or paused"。
    // 改为记录待停止意图，等 onStart 回调后再补执行 stop。
    if (!recordingStarted) {
      stopPending = true
      if (cancelledBySwipe) {
        cancelIntent.value = false
        return { cancelled: true, reason: 'swiped' }
      }
      if (tooShort) {
        return { cancelled: true, reason: 'tooShort' }
      }
      return { cancelled: false }
    }

    isStopping = true
    recorder?.stop()

    if (cancelledBySwipe) {
      cancelIntent.value = false
      phase.value = 'idle'
      return { cancelled: true, reason: 'swiped' }
    }

    if (tooShort) {
      phase.value = 'idle'
      return { cancelled: true, reason: 'tooShort' }
    }

    // 正常结束：停止录音，onStop 回调触发识别并回填
    return { cancelled: false }
  }

  function markCancelIntent(active: boolean) {
    cancelIntent.value = active
  }

  function reset() {
    clearTimer()
    recorder = null
    recordingStarted = false
    stopPending = false
    isStopping = false
    shouldDiscard = false
    pendingFile = null
    cancelIntent.value = false
    duration.value = 0
    phase.value = 'idle'
  }

  return {
    phase,
    duration,
    cancelIntent,
    start,
    stop,
    markCancelIntent,
    reset,
  }
}