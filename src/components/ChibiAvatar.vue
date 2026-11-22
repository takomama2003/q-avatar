<script setup lang="ts">
import { computed, useId } from 'vue'
import { isAvatar } from '../../shared/avatars'
import { AVATAR_LOOKS } from '../content/avatars'

// Q 版公仔头像：大圆脸、腮红，按编号换发型、发色、表情和小配饰。纯 SVG，任意尺寸都清晰。
// id 是 'upload:<时间戳>' 时显示用户自己上传的头像（只有本人能取到这张图）。
const props = withDefaults(defineProps<{ id?: string; size?: number; label?: string }>(), { id: 'bob', size: 34, label: '' })
const uploaded = computed(() => props.id.startsWith('upload:') ? `${import.meta.env.BASE_URL}api/account/avatar/image?v=${encodeURIComponent(props.id.slice(7))}` : '')
const kind = computed(() => isAvatar(props.id) ? props.id : 'bob')
const look = computed(() => AVATAR_LOOKS[kind.value])
const clip = `avatar-clip-${useId()}`
const ink = '#2b2337'
// 通用刘海：盖住额头，下沿有几处小弧，像一缕缕头发
const BANGS = 'M14 37C13 22 22 14 32 14S51 22 50 37C48 31 45 28 42 27C40 30 36 31 33 29C30 31 25 31 23 28C19 29 16 32 14 37Z'
const PARTED = 'M14 37C13 22 22 14 32 14S51 22 50 37C47 30 41 26 33 25L32 22L31 25C23 26 17 30 14 37Z'
const SWEPT = 'M14 36C13 22 22 14 32 14S51 22 50 36C47 30 42 26 34 26C28 29 20 31 14 36Z'
const SHORT = 'M15 33C15 21 23 16 32 16S49 21 49 33C45 27 39 25 32 25S19 27 15 33Z'
const front = computed(() => ({ bob: BANGS, bun: BANGS, twin: PARTED, curl: '', buzz: SHORT, pony: SWEPT, cap: SHORT, bear: '', glasses: BANGS, clip: PARTED, phones: SWEPT, bow: BANGS })[kind.value])
</script>

<template>
  <img v-if="uploaded" class="chibi-avatar" :src="uploaded" :width="size" :height="size" :alt="label" :aria-hidden="label ? undefined : 'true'">
  <svg v-else class="chibi-avatar" :width="size" :height="size" viewBox="0 0 64 64" :role="label ? 'img' : undefined" :aria-label="label || undefined" :aria-hidden="label ? undefined : 'true'">
    <defs><clipPath :id="clip"><circle cx="32" cy="32" r="32" /></clipPath></defs>
    <g :clip-path="`url(#${clip})`">
      <rect width="64" height="64" :fill="look.bg" />
      <!-- 肩膀 -->
      <path d="M12 64C13 55 21 51 32 51S51 55 52 64Z" :fill="look.accent ?? '#6f52a8'" opacity=".9" />
      <!-- 脑后的头发 -->
      <path v-if="kind === 'bob' || kind === 'glasses' || kind === 'phones' || kind === 'bow'" d="M12 38C12 20 22 12 32 12S52 20 52 38V47C52 50 50 51 47 50H17C14 51 12 50 12 47Z" :fill="look.hair" />
      <path v-else-if="kind === 'clip'" d="M12 36C12 19 22 12 32 12S52 19 52 36L55 64H9Z" :fill="look.hair" />
      <g v-else-if="kind === 'twin'" :fill="look.hair">
        <ellipse cx="11" cy="42" rx="6" ry="12" transform="rotate(12 11 42)" />
        <ellipse cx="53" cy="42" rx="6" ry="12" transform="rotate(-12 53 42)" />
      </g>
      <path v-else-if="kind === 'pony'" d="M44 17C57 17 60 34 55 48C53 41 50 33 43 26Z" :fill="look.hair" />
      <g v-else-if="kind === 'curl'" :fill="look.hair">
        <circle cx="16" cy="34" r="6" /><circle cx="48" cy="34" r="6" /><circle cx="17" cy="25" r="7" /><circle cx="47" cy="25" r="7" />
        <circle cx="24" cy="17" r="7.5" /><circle cx="40" cy="17" r="7.5" /><circle cx="32" cy="14" r="7.5" />
      </g>
      <g v-else-if="kind === 'bun'" :fill="look.hair">
        <circle cx="32" cy="11" r="7.5" />
        <path d="M13 38C13 21 22 14 32 14S51 21 51 38V42H13Z" />
      </g>
      <g v-else-if="kind === 'bear'" :fill="look.hair">
        <circle cx="17" cy="16" r="6.5" /><circle cx="47" cy="16" r="6.5" />
      </g>
      <path v-else d="M14 38C14 22 22 15 32 15S50 22 50 38V42H14Z" :fill="look.hair" />

      <!-- 脸 -->
      <ellipse cx="32" cy="37" rx="17" ry="16" :fill="look.skin" />
      <!-- 刘海 / 帽子 -->
      <path v-if="front" :d="front" :fill="look.hair" />
      <g v-if="kind === 'curl'" :fill="look.hair"><circle cx="23" cy="25" r="5.5" /><circle cx="32" cy="23" r="5.5" /><circle cx="41" cy="25" r="5.5" /></g>
      <g v-if="kind === 'bear'">
        <circle cx="17" cy="16" r="3" :fill="look.accent" /><circle cx="47" cy="16" r="3" :fill="look.accent" />
        <path d="M13 35C13 19 22 13 32 13S51 19 51 35C45 30 39 29 32 29S19 30 13 35Z" :fill="look.hair" />
      </g>
      <g v-if="kind === 'cap'">
        <path d="M14 29C14 17 22 11 32 11S50 17 50 29Z" :fill="look.accent" />
        <path d="M12 29.5C20 26 44 26 52 29.5C52 32.5 12 32.5 12 29.5Z" fill="#4b3780" />
        <circle cx="32" cy="11.5" r="1.6" fill="#4b3780" />
      </g>

      <!-- 眼睛 -->
      <g v-if="look.eyes === 'cool'" :fill="ink">
        <rect x="20" y="35.5" width="10" height="6.5" rx="3" /><rect x="34" y="35.5" width="10" height="6.5" rx="3" />
        <path d="M30 37.5H34" :stroke="ink" stroke-width="1.4" />
        <path d="M22 37.2l2.5-1" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".7" />
      </g>
      <g v-else-if="look.eyes === 'happy'" fill="none" :stroke="ink" stroke-width="1.9" stroke-linecap="round">
        <path d="M22.5 40.5Q25 36.8 27.5 40.5" /><path d="M36.5 40.5Q39 36.8 41.5 40.5" />
      </g>
      <g v-else>
        <ellipse cx="25" cy="39" rx="2.3" :ry="look.eyes === 'shy' ? 2.2 : 2.9" :fill="ink" />
        <circle cx="25.9" cy="37.8" r=".85" fill="#fff" />
        <path v-if="look.eyes === 'wink'" d="M36.5 40Q39 37 41.5 40" fill="none" :stroke="ink" stroke-width="1.9" stroke-linecap="round" />
        <template v-else>
          <ellipse cx="39" cy="39" rx="2.3" :ry="look.eyes === 'shy' ? 2.2 : 2.9" :fill="ink" />
          <circle cx="39.9" cy="37.8" r=".85" fill="#fff" />
        </template>
      </g>
      <!-- 腮红和嘴 -->
      <ellipse cx="20.5" cy="44.5" rx="3.2" ry="1.9" fill="#ff8fa3" :opacity="look.eyes === 'shy' ? .8 : .5" />
      <ellipse cx="43.5" cy="44.5" rx="3.2" ry="1.9" fill="#ff8fa3" :opacity="look.eyes === 'shy' ? .8 : .5" />
      <path v-if="look.eyes === 'happy' || look.eyes === 'wink'" d="M29.6 45.6Q32 49.6 34.4 45.6Z" fill="#c2564f" />
      <path v-else d="M30 46.2Q32 48 34 46.2" fill="none" stroke="#9b5144" stroke-width="1.4" stroke-linecap="round" />

      <!-- 配饰 -->
      <g v-if="kind === 'glasses'" fill="rgb(255 255 255 / .18)" :stroke="look.accent" stroke-width="1.5">
        <circle cx="25" cy="39" r="5.2" /><circle cx="39" cy="39" r="5.2" /><path d="M30.2 38.6Q32 37.4 33.8 38.6" fill="none" />
      </g>
      <g v-if="kind === 'phones'" :fill="look.accent">
        <path d="M12 34C12 13 52 13 52 34" fill="none" :stroke="look.accent" stroke-width="3.4" stroke-linecap="round" />
        <rect x="8.5" y="30" width="7.5" height="12" rx="3.5" /><rect x="48" y="30" width="7.5" height="12" rx="3.5" />
      </g>
      <g v-if="kind === 'bow'" :fill="look.accent">
        <path d="M44 16L37 11.5V20.5Z" /><path d="M44 16L51 11.5V20.5Z" /><circle cx="44" cy="16" r="2.2" />
      </g>
      <rect v-if="kind === 'clip'" x="39" y="21" width="8" height="3" rx="1.5" :fill="look.accent" transform="rotate(-20 43 22.5)" />
      <circle v-if="kind === 'twin'" cx="14.5" cy="30.5" r="2.6" :fill="look.accent" />
      <circle v-if="kind === 'twin'" cx="49.5" cy="30.5" r="2.6" :fill="look.accent" />
      <circle v-if="kind === 'pony'" cx="46" cy="19.5" r="2.6" :fill="look.accent" />
      <rect v-if="kind === 'bun'" x="27" y="16" width="10" height="2.6" rx="1.3" :fill="look.accent" />
    </g>
  </svg>
</template>

<style>
/* 全站 svg 默认带描边（图标用），头像不要：只保留模板里单独写了 stroke 的线条 */
.chibi-avatar { display: block; flex: none; fill: none; stroke: none; border-radius: 50%; }
img.chibi-avatar { object-fit: cover; background: #f1efec; }
</style>
