<script setup lang="ts">
import { useId } from 'vue'
import type { StyleId } from '../../shared/options'

// 风格示意小插画（不是生成结果），用纯 SVG 画出每个系列的材质感。
defineProps<{ style: StyleId }>()
const id = useId() // 同一页面有多个插画时，渐变和滤镜的 id 不能重复
// 像素小人的点阵：H 头发 S 皮肤 E 眼睛 W 高光 B 腮红 M 嘴 C 衣服
const PIXELS = [
  '....HHHHHH....', '...HHHHHHHH...', '..HHHHHHHHHH..', '..HSSSSSSSSH..', '..HSSSSSSSSH..', '..SSEWSSEWSS..', '..SSEESSEESS..',
  '..SBSSSSSSBS..', '..SSSSMMSSSS..', '...SSSSSSSS...', '....CCCCCC....', '...CCCCCCCC...', '..CCCCCCCCCC..', '..CCCCCCCCCC..',
]
const COLORS: Record<string, string> = { H: '#3b2c35', S: '#f7d2b4', E: '#2b2337', W: '#ffffff', B: '#f4a3a8', M: '#c76b74', C: '#8f74c6' }
const cells = PIXELS.flatMap((row, y) => [...row].map((key, x) => ({ x, y, fill: COLORS[key] })).filter(cell => cell.fill))
</script>

<template>
  <svg class="swatch" viewBox="0 0 120 120" aria-hidden="true">
    <template v-if="style === 'figure'">
      <defs>
        <radialGradient :id="`${id}-skin`" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#ffe6d2" /><stop offset="1" stop-color="#f0c3a4" /></radialGradient>
        <linearGradient :id="`${id}-body`" x2="0" y2="1"><stop offset="0" stop-color="#cbb8ec" /><stop offset="1" stop-color="#9a80cf" /></linearGradient>
      </defs>
      <ellipse cx="60" cy="112" rx="30" ry="5" fill="#2b2337" opacity=".12" />
      <path d="M38 112c0-20 9-31 22-31s22 11 22 31z" :fill="`url(#${id}-body)`" />
      <circle cx="60" cy="52" r="32" :fill="`url(#${id}-skin)`" />
      <path d="M28 52c0-22 14-34 32-34s32 12 32 34c-7-11-18-16-32-16S35 41 28 52z" fill="#4a3a44" />
      <circle cx="49" cy="57" r="3.5" fill="#2b2337" /><circle cx="71" cy="57" r="3.5" fill="#2b2337" />
      <ellipse cx="42" cy="66" rx="5" ry="3" fill="#f4a3a8" opacity=".7" /><ellipse cx="78" cy="66" rx="5" ry="3" fill="#f4a3a8" opacity=".7" />
      <path d="M55 68q5 4 10 0" stroke="#c76b74" stroke-width="2.4" />
      <ellipse cx="46" cy="40" rx="8" ry="4" fill="#fff" opacity=".35" transform="rotate(-20 46 40)" />
    </template>
    <template v-else-if="style === 'blindbox'">
      <defs><linearGradient :id="`${id}-hair`" x2="1" y2="1"><stop offset="0" stop-color="#9a80cf" /><stop offset="1" stop-color="#6f52a8" /></linearGradient></defs>
      <ellipse cx="60" cy="108" rx="34" ry="8" fill="#e6d6f5" /><path d="M26 108v4c0 4 15 8 34 8s34-4 34-8v-4" fill="#cbb8ec" />
      <path d="M42 106c0-17 8-26 18-26s18 9 18 26z" fill="#f3d56b" />
      <circle cx="60" cy="52" r="31" fill="#ffe1cf" />
      <path d="M29 50c0-21 13-33 31-33s31 12 31 33c-4-6-9-9-14-10 1 5-1 9-5 11-2-6-7-10-12-11-5 3-13 4-31 10z" :fill="`url(#${id}-hair)`" />
      <ellipse cx="48" cy="58" rx="6" ry="7.5" fill="#2b2337" /><ellipse cx="72" cy="58" rx="6" ry="7.5" fill="#2b2337" />
      <circle cx="50" cy="55" r="2.4" fill="#fff" /><circle cx="74" cy="55" r="2.4" fill="#fff" /><circle cx="46.5" cy="61" r="1.2" fill="#fff" /><circle cx="70.5" cy="61" r="1.2" fill="#fff" />
      <path d="M56 70q4 3 8 0" stroke="#c76b74" stroke-width="2.2" />
      <path d="M34 36q6-12 18-15" stroke="#fff" stroke-width="3.5" opacity=".55" />
      <path d="M95 22l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#f3d56b" />
    </template>
    <template v-else-if="style === 'clay'">
      <defs><filter :id="`${id}-lumpy`"><feTurbulence type="fractalNoise" baseFrequency=".055" numOctaves="2" seed="4" /><feDisplacementMap in="SourceGraphic" scale="5" /></filter></defs>
      <g :filter="`url(#${id}-lumpy)`">
        <path d="M37 113c0-20 10-30 23-30s23 10 23 30z" fill="#e48f6f" />
        <circle cx="60" cy="54" r="31" fill="#f3c9a4" />
        <path d="M30 50c2-20 15-30 30-30s29 9 31 29c-9-8-19-11-31-11-11 0-21 4-30 12z" fill="#8a5a44" />
      </g>
      <circle cx="49" cy="58" r="3.8" fill="#3b2c35" /><circle cx="71" cy="58" r="3.8" fill="#3b2c35" />
      <ellipse cx="43" cy="67" rx="5" ry="3.4" fill="#e9898a" opacity=".55" /><ellipse cx="77" cy="67" rx="5" ry="3.4" fill="#e9898a" opacity=".55" />
      <path d="M54 69q6 5 12 0" stroke="#9b4f4a" stroke-width="2.6" />
      <path d="M44 96l4 3M70 98l5-2" stroke="#c97556" stroke-width="2" opacity=".7" />
    </template>
    <template v-else-if="style === 'pixel'">
      <rect x="4" y="4" width="112" height="112" rx="16" fill="#efe9fb" />
      <rect v-for="cell in cells" :key="`${cell.x}-${cell.y}`" :x="4 + cell.x * 8" :y="4 + cell.y * 8" width="8" height="8" :fill="cell.fill" shape-rendering="crispEdges" />
    </template>
    <template v-else>
      <defs><filter :id="`${id}-wash`"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="3" seed="9" /><feDisplacementMap in="SourceGraphic" scale="7" /><feGaussianBlur stdDeviation=".7" /></filter></defs>
      <path d="M38 109c-3-18 6-30 22-31 17 1 26 13 22 31z" fill="#fff" />
      <circle cx="60" cy="52" r="35" fill="#fff" />
      <g :filter="`url(#${id}-wash)`" opacity=".85">
        <path d="M42 106c0-16 8-24 18-24s18 8 18 24z" fill="#9ec5e8" />
        <circle cx="60" cy="53" r="29" fill="#fbd9c2" />
        <path d="M32 50c2-18 13-27 28-27s26 9 28 27c-8-7-17-10-28-10s-20 3-28 10z" fill="#7d6aa8" />
      </g>
      <path d="M50 57q2-2 4 0M66 57q2-2 4 0" stroke="#4a3a44" stroke-width="2" />
      <path d="M56 68q4 3 8 0" stroke="#c76b74" stroke-width="2" />
      <circle cx="44" cy="65" r="4" fill="#f4a3a8" opacity=".5" /><circle cx="76" cy="65" r="4" fill="#f4a3a8" opacity=".5" />
    </template>
  </svg>
</template>

<style>
.swatch { fill: none; stroke: none; stroke-linecap: round; }
</style>
