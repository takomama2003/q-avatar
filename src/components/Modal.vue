<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

// 通用弹窗：打开时把焦点移进来，Tab 只在弹窗里循环，Esc 或点遮罩关闭，关闭后焦点回到打开前的位置。
const props = withDefaults(defineProps<{ open: boolean; title: string; description?: string; width?: number }>(), { description: '', width: 440 })
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLElement>()
const titleId = `modal-title-${useId()}`
let opener: HTMLElement | null = null

const focusables = () => [...(dialog.value?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])]

watch(() => props.open, async open => {
  if (open) {
    opener = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    await nextTick()
    // 优先聚焦弹窗里标了 autofocus 的元素，没有就聚焦第一个可操作的元素（关闭按钮除外）
    const items = focusables()
    ;(dialog.value?.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ?? items.find(el => !el.classList.contains('ui-modal-close')) ?? items[0])?.focus()
  } else {
    document.body.style.overflow = ''
    opener?.focus?.()
    opener = null
  }
}, { immediate: true })
onBeforeUnmount(() => { document.body.style.overflow = '' })

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close'); return }
  if (event.key !== 'Tab') return
  const items = focusables()
  if (!items.length) return
  const first = items[0], last = items[items.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ui-modal-backdrop" @mousedown.self="emit('close')">
      <div ref="dialog" class="ui-modal" role="dialog" aria-modal="true" :aria-labelledby="titleId" :style="{ maxWidth: `${width}px` }" @keydown="onKey">
        <div class="ui-modal-head">
          <div>
            <h2 :id="titleId">{{ title }}</h2>
            <p v-if="description">{{ description }}</p>
          </div>
          <button type="button" class="ui-modal-close" aria-label="关闭" @click="emit('close')">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" /></svg>
          </button>
        </div>
        <div class="ui-modal-body"><slot /></div>
        <div v-if="$slots.foot" class="ui-modal-foot"><slot name="foot" /></div>
      </div>
    </div>
  </Teleport>
</template>
