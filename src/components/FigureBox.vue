<script setup lang="ts">
// 盲盒包装式的展示盒：上下两条印刷带、中间拱形展示窗、右上角贴纸。首页和工坊共用。
defineProps<{
  src: string
  alt: string
  imageKey?: string
  loading?: boolean
  background?: string
  topLeft: string
  topRight: string
  bottomLeft: string
  bottomRight: string
  sticker: [string, string]
  live?: boolean
}>()
</script>

<template>
  <div class="box" :class="{ loading }" :aria-busy="loading">
    <div class="box-band"><span>{{ topLeft }}</span><span>{{ topRight }}</span></div>
    <div class="window" :class="background ? `bg-${background}` : ''">
      <img :key="imageKey ?? src" class="figure" :src="src" :alt="alt">
      <slot />
    </div>
    <span :key="sticker[0]" class="sticker" :class="{ live }" aria-hidden="true"><strong>{{ sticker[0] }}</strong><small>{{ sticker[1] }}</small></span>
    <div class="box-band bottom">
      <span>{{ bottomLeft }}</span>
      <span class="art-note">{{ bottomRight }}</span>
    </div>
  </div>
</template>
