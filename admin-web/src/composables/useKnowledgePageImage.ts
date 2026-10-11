import { computed, ref, watch } from 'vue'

export function useKnowledgePageImage(source: () => string | null | undefined) {
  const scale = ref(1)
  const offset = ref({ x: 0, y: 0 })
  const dragging = ref(false)
  const failed = ref(false)
  let origin = { x: 0, y: 0, ox: 0, oy: 0 }
  function reset(): void { scale.value = 1; offset.value = { x: 0, y: 0 }; dragging.value = false }
  function zoom(delta: number): void { scale.value = Math.min(5, Math.max(0.5, Number((scale.value + delta).toFixed(2)))) }
  function start(event: PointerEvent): void {
    if (event.button !== 0) return
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture?.(event.pointerId)
    dragging.value = true
    origin = { x: event.clientX, y: event.clientY, ox: offset.value.x, oy: offset.value.y }
  }
  function move(event: PointerEvent): void {
    if (dragging.value) offset.value = { x: origin.ox + event.clientX - origin.x, y: origin.oy + event.clientY - origin.y }
  }
  function stop(): void { dragging.value = false }
  const imageStyle = computed(() => ({ transform: `translate(${offset.value.x}px, ${offset.value.y}px) scale(${scale.value})` }))
  watch(source, () => { reset(); failed.value = false })
  return { scale, dragging, failed, imageStyle, reset, zoom, start, move, stop }
}
