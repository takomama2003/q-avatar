<script setup lang="ts">
import { computed } from 'vue'
import { COMPOSITIONS, STYLES, nameOf } from '../../shared/options'
import type { Work } from '../stores/history'

const props = defineProps<{ work: Work }>()
defineEmits<{ open: [] }>()
const style = computed(() => nameOf(STYLES, props.work.options.style))
const date = computed(() => new Date(props.work.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))
</script>

<template>
  <button type="button" class="work-card" :aria-label="`查看作品：${style}，${date}`" @click="$emit('open')">
    <span class="work-thumb">
      <img :src="work.url" alt="">
      <span class="work-badge" :class="{ ai: work.source === 'model' }">{{ work.source === 'model' ? 'AI 生成' : '示例' }}</span>
    </span>
    <span class="work-meta"><strong>{{ style }}</strong><span>{{ date }}</span></span>
    <span class="work-sub">{{ nameOf(COMPOSITIONS, work.options.composition) }}</span>
  </button>
</template>
