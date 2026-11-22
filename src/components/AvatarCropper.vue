<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

// 头像裁剪：把图片放进圆形取景框，拖动调位置、滑块调大小，确认后在浏览器里画成 256×256 的 PNG。
// 重新画一遍等于重新编码：原图里的拍摄地点、相机信息都不会带上，服务器那边还会再清理一次。
const props = defineProps<{ source: Blob | null; busy?: boolean }>()
const emit = defineEmits<{ done: [png: Blob]; cancel: [] }>()
const OUTPUT = 256
const VIEW = 240 // 取景框在页面上的边长（px）
const image = ref<HTMLImageElement | null>(null)
const url = ref('')
const zoom = ref(1)
const offset = ref({ x: 0, y: 0 })
const error = ref('')
let drag: { id: number; x: number; y: number; ox: number; oy: number } | null = null

// 缩放到 1 时，图片的短边刚好铺满取景框
const base = computed(() => image.value ? VIEW / Math.min(image.value.naturalWidth, image.value.naturalHeight) : 1)
const shown = computed(() => {
  const img = image.value
  if (!img) return { w: 0, h: 0 }
  return { w: img.naturalWidth * base.value * zoom.value, h: img.naturalHeight * base.value * zoom.value }
})
// 拖动时不让图片边缘露出取景框
function clamp(x: number, y: number) {
  const maxX = Math.max(0, (shown.value.w - VIEW) / 2)
  const maxY = Math.max(0, (shown.value.h - VIEW) / 2)
  return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) }
}
watch(zoom, () => { offset.value = clamp(offset.value.x, offset.value.y) })

watch(() => props.source, async source => {
  if (url.value) URL.revokeObjectURL(url.value)
  image.value = null; url.value = ''; error.value = ''; zoom.value = 1; offset.value = { x: 0, y: 0 }
  if (!source) return
  url.value = URL.createObjectURL(source)
  const img = new Image()
  img.src = url.value
  try {
    await img.decode()
    image.value = img
    // 竖图（全身公仔、人像照片）默认放大一些、往上移，先对准头部和上半身
    if (img.naturalHeight > img.naturalWidth * 1.05) {
      zoom.value = 1.6
      offset.value = clamp(0, shown.value.h * 0.22)
    } else if (Math.abs(img.naturalHeight - img.naturalWidth) <= img.naturalWidth * 0.05) {
      zoom.value = 1.4
      offset.value = clamp(0, shown.value.h * 0.12)
    }
  } catch { error.value = '读不出这张图片，请换一张。' }
}, { immediate: true })
onBeforeUnmount(() => { if (url.value) URL.revokeObjectURL(url.value) })

function onDown(event: PointerEvent) {
  if (!image.value) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, ox: offset.value.x, oy: offset.value.y }
}
function onMove(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId) return
  offset.value = clamp(drag.ox + event.clientX - drag.x, drag.oy + event.clientY - drag.y)
}
function onUp() { drag = null }
// 键盘：方向键移动，+/- 缩放
function onKey(event: KeyboardEvent) {
  const step = event.shiftKey ? 20 : 6
  const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
  if (moves[event.key]) {
    event.preventDefault()
    offset.value = clamp(offset.value.x + moves[event.key][0], offset.value.y + moves[event.key][1])
  } else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom.value = Math.min(3, zoom.value + 0.1) }
  else if (event.key === '-') { event.preventDefault(); zoom.value = Math.max(1, zoom.value - 0.1) }
}
function onWheel(event: WheelEvent) {
  event.preventDefault()
  zoom.value = Math.min(3, Math.max(1, zoom.value - event.deltaY * 0.0015))
}

async function confirm() {
  const img = image.value
  if (!img || props.busy) return
  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT; canvas.height = OUTPUT
  const g = canvas.getContext('2d')
  if (!g) { error.value = '这个浏览器不支持裁剪，请换一个浏览器。'; return }
  // 取景框里看到的区域，换算回原图坐标
  const scale = base.value * zoom.value
  const side = VIEW / scale
  const sx = img.naturalWidth / 2 - (VIEW / 2 + offset.value.x) / scale
  const sy = img.naturalHeight / 2 - (VIEW / 2 + offset.value.y) / scale
  g.fillStyle = '#f1efec'
  g.fillRect(0, 0, OUTPUT, OUTPUT)
  g.imageSmoothingQuality = 'high'
  g.drawImage(img, sx, sy, side, side, 0, 0, OUTPUT, OUTPUT)
  const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!png) { error.value = '裁剪失败，请重试。'; return }
  emit('done', png)
}
</script>

<template>
  <div class="cropper">
    <div
      class="cropper-view" :style="{ width: `${VIEW}px`, height: `${VIEW}px` }" tabindex="0" role="application"
      aria-label="调整头像位置：拖动或用方向键移动，加号和减号缩放" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp" @keydown="onKey" @wheel="onWheel"
    >
      <img
        v-if="image" :src="url" alt="" draggable="false"
        :style="{ width: `${shown.w}px`, height: `${shown.h}px`, transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }"
      >
      <span v-else-if="!error" class="spinner cropper-loading" aria-hidden="true"></span>
      <span class="cropper-ring" aria-hidden="true"></span>
    </div>
    <label class="cropper-zoom">
      <span class="ui-label">缩放</span>
      <input v-model.number="zoom" type="range" min="1" max="3" step="0.01" :disabled="!image">
    </label>
    <p class="ui-hint">拖动图片调整位置，圆圈里的部分就是头像。</p>
    <p v-if="error" class="ui-alert err" role="alert">{{ error }}</p>
    <div class="cropper-actions">
      <button type="button" class="ui-btn ui-btn-secondary" :disabled="busy" @click="emit('cancel')">返回</button>
      <button type="button" class="ui-btn ui-btn-primary" :disabled="!image || busy" @click="confirm">{{ busy ? '正在上传…' : '用这张做头像' }}</button>
    </div>
  </div>
</template>
