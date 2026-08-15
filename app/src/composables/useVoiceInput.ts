export type VoicePhase = 'idle' | 'recording' | 'recognizing'

export type VoiceStopReason = 'tooShort' | 'swiped'

export interface VoiceStopOutcome {
  cancelled: boolean
  reason?: VoiceStopReason
}

const MIN_RECORD_SECONDS = 1
const MOCK_RECOGNIZE_DELAY = 900
// 接口未接入前的固定回填文本，便于验收「识别中 → 回填」完整链路
const MOCK_RESULT_TEXT = '帮我梳理一下这个项目的节能改造方案'

/**
 * 语音输入状态机：idle → recording → recognizing → idle。
 * 本期录音与 ASR 接口全部留桩，仅在 mock 阶段推进状态与回填文本。
 */
export function useVoiceInput(options: {
  onResult: (text: string) => void
}) {
  const phase = ref<VoicePhase>('idle')
  const duration = ref(0)
  /** 上滑意图：UI 据此切换“松开取消”提示，并决定最终是否取消 */
  const cancelIntent = ref(false)

  let timer: ReturnType<typeof setInterval> | null = null

  function clearTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function startRecord() {
    // #ifdef MP-WEIXIN
    // TODO: 接入录音 + ASR 接口。使用 uni.getRecorderManager() 录音后上传后端。
    // #endif
    // #ifdef APP-PLUS
    // TODO: 接入录音 + ASR 接口。使用 uni.getRecorderManager() 录音后上传后端。
    // #endif
  }

  function stopRecord() {
    // #ifdef MP-WEIXIN
    // TODO: 停止录音，获取临时文件后进入识别。
    // #endif
    // #ifdef APP-PLUS
    // TODO: 停止录音，获取临时文件后进入识别。
    // #endif
  }

  async function recognize(): Promise<string> {
    // TODO: 上传音频并调用后端 ASR 接口，返回识别文本。
    await new Promise(resolve => setTimeout(resolve, MOCK_RECOGNIZE_DELAY))
    return MOCK_RESULT_TEXT
  }

  function start() {
    if (phase.value !== 'idle') {
      return
    }
    cancelIntent.value = false
    duration.value = 0
    phase.value = 'recording'
    startRecord()

    timer = setInterval(() => {
      duration.value += 1
    }, 1000)
  }

  async function stop(): Promise<VoiceStopOutcome> {
    if (phase.value !== 'recording') {
      return { cancelled: true, reason: 'tooShort' }
    }

    clearTimer()
    stopRecord()

    if (cancelIntent.value) {
      phase.value = 'idle'
      cancelIntent.value = false
      return { cancelled: true, reason: 'swiped' }
    }

    if (duration.value < MIN_RECORD_SECONDS) {
      phase.value = 'idle'
      return { cancelled: true, reason: 'tooShort' }
    }

    phase.value = 'recognizing'
    const text = await recognize()
    options.onResult(text)
    phase.value = 'idle'
    return { cancelled: false }
  }

  function markCancelIntent(active: boolean) {
    cancelIntent.value = active
  }

  function reset() {
    clearTimer()
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