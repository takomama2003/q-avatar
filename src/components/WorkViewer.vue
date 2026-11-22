<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { BACKGROUNDS, COMPOSITIONS, EXPRESSIONS, POSES, PROPORTIONS, RATIOS, STYLES, nameOf } from '../../shared/options'
import { removeWork, type Work } from '../stores/history'
import { useStudio } from '../stores/studio'

// 查看一张作品：大图、当时的设置，以及下载、套用设置、删除。用原生 <dialog>，自带焦点管理和 Esc 关闭。
const props = defineProps<{ work: Work | null }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
const confirming = ref(false)
const router = useRouter()
const studio = useStudio()

watch(() => props.work, work => {
  confirming.value = false
  if (work && !dialog.value?.open) dialog.value?.showModal()
  if (!work && dialog.value?.open) dialog.value.close()
}, { flush: 'post' })

const details = computed(() => {
  const work = props.work
  if (!work) return []
  const o = work.options
  return [
    ['构图', nameOf(COMPOSITIONS, o.composition)],
    ['比例', nameOf(RATIOS, o.ratio)],
    // 加入头身比之前保存的作品没有这一项
    ...(o.composition === 'full' && o.proportion ? [['头身比', nameOf(PROPORTIONS, o.proportion)]] : []),
    ['表情', nameOf(EXPRESSIONS, o.expression)],
    ...(o.composition === 'full' ? [['姿势', nameOf(POSES, o.pose)]] : []),
    ['背景', nameOf(BACKGROUNDS, o.background)],
    ['描述', o.description || '（没有填写）'],
    ['来源', work.source === 'model' ? 'AI 生成' : '旧版示例图'],
    ['时间', new Date(work.createdAt).toLocaleString('zh-CN')],
  ]
})
const fileName = computed(() => props.work ? `Tim_pet-${props.work.source === 'demo' ? 'demo-' : ''}${props.work.options.style}-${props.work.options.composition}.${props.work.extension}` : '')

function onBackdrop(event: MouseEvent) {
  if (event.target === dialog.value) emit('close')
}
function reuse() {
  if (!props.work) return
  studio.applyOptions(props.work.options)
  emit('close')
  void router.push({ name: 'studio' })
}
async function remove() {
  if (!props.work) return
  await removeWork(props.work.id)
  emit('close')
}
</script>

<template>
  <dialog ref="dialog" class="viewer" aria-labelledby="viewer-title" @click="onBackdrop" @close="emit('close')">
    <div v-if="work" class="viewer-body">
      <div class="viewer-image" :class="work.options.background === 'transparent' ? 'checker' : `bg-${work.options.background}`">
        <img :src="work.url" :alt="`${nameOf(STYLES, work.options.style)}作品大图`">
        <span v-if="work.source === 'model'" class="ai-mark">AI 生成</span>
      </div>
      <div class="viewer-info">
        <header>
          <div>
            <span class="ui-tag">{{ work.source === 'model' ? 'AI 生成' : '示例' }}</span>
            <h2 id="viewer-title">{{ nameOf(STYLES, work.options.style) }}</h2>
          </div>
          <button type="button" class="viewer-close" aria-label="关闭" @click="emit('close')">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" /></svg>
          </button>
        </header>
        <dl><template v-for="[term, value] in details" :key="term"><dt>{{ term }}</dt><dd>{{ value }}</dd></template></dl>
        <div class="viewer-actions">
          <a class="ui-btn ui-btn-primary ui-btn-sm" :href="work.url" :download="fileName">下载这张</a>
          <button type="button" class="ui-btn ui-btn-secondary ui-btn-sm" @click="reuse">用同样的设置再做</button>
          <button v-if="!confirming" type="button" class="ui-btn ui-btn-danger ui-btn-sm" @click="confirming = true">删除</button>
          <span v-else class="confirm-row">
            <button type="button" class="ui-btn ui-btn-danger ui-btn-sm" @click="remove">确认删除</button>
            <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" @click="confirming = false">取消</button>
          </span>
        </div>
      </div>
    </div>
  </dialog>
</template>
