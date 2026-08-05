import { computed, onMounted, onUnmounted, ref } from 'vue'

const keyboardHeight = ref(0)
const viewportHeight = ref(0)

interface KeyboardHeightEvent {
  height: number
}

interface WindowResizeEvent {
  size: {
    windowHeight: number
  }
}

function setKeyboardHeight(height: number) {
  keyboardHeight.value = Math.max(0, height)
}

function setViewportHeight(height: number) {
  if (height > 0) {
    viewportHeight.value = height
  }
}

export function useKeyboardVisibility() {
  const isKeyboardVisible = computed(() => keyboardHeight.value > 0)

  function handleKeyboardHeightChange(event: KeyboardHeightEvent) {
    setKeyboardHeight(event.height)
  }

  function handleWindowResize(event: WindowResizeEvent) {
    setViewportHeight(event.size.windowHeight)
  }

  // #ifdef H5
  let visualViewport: VisualViewport | null = null
  let handleViewportResize: (() => void) | null = null
  let maximumViewportHeight = 0
  // #endif

  onMounted(() => {
    setViewportHeight(uni.getSystemInfoSync().windowHeight)
    uni.onWindowResize(handleWindowResize)

    // #ifdef APP-PLUS || MP-WEIXIN
    uni.onKeyboardHeightChange(handleKeyboardHeightChange)
    // #endif

    // #ifdef H5
    visualViewport = window.visualViewport
    if (visualViewport) {
      maximumViewportHeight = Math.max(window.innerHeight, visualViewport.height)
      handleViewportResize = () => {
        const activeElement = document.activeElement
        const isEditable = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement
        if (!isEditable) {
          maximumViewportHeight = Math.max(maximumViewportHeight, visualViewport!.height)
        }
        const coveredHeight = maximumViewportHeight - visualViewport!.height + visualViewport!.offsetTop
        setViewportHeight(visualViewport!.height)
        setKeyboardHeight(isEditable && coveredHeight > 120 ? coveredHeight : 0)
      }
      visualViewport.addEventListener('resize', handleViewportResize)
      visualViewport.addEventListener('scroll', handleViewportResize)
    }
    // #endif
  })

  onUnmounted(() => {
    uni.offWindowResize(handleWindowResize)

    // #ifdef APP-PLUS || MP-WEIXIN
    uni.offKeyboardHeightChange(handleKeyboardHeightChange)
    // #endif

    // #ifdef H5
    if (visualViewport && handleViewportResize) {
      visualViewport.removeEventListener('resize', handleViewportResize)
      visualViewport.removeEventListener('scroll', handleViewportResize)
    }
    // #endif
    setKeyboardHeight(0)
  })

  return {
    keyboardHeight: computed(() => keyboardHeight.value),
    viewportHeight: computed(() => viewportHeight.value),
    isKeyboardVisible,
  }
}
