<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BACKGROUNDS, COMPOSITIONS, EXPRESSIONS, MAX_COUNT, MAX_DESCRIPTION, POSES, PROPORTIONS, RATIOS, STYLES, nameOf } from '../../shared/options'
import FigureBox from '../components/FigureBox.vue'
import OptionChips from '../components/OptionChips.vue'
import StyleSwatch from '../components/StyleSwatch.vue'
import { useHistory } from '../stores/history'
import { useStudio } from '../stores/studio'

// 创作工坊页面只负责显示和交互；照片、选项和生成状态在 stores/studio.ts，切换页面不会丢。
const studio = useStudio()
const { photo, photoUrl, options, busy, validating, locked, error, failed, status, result, selected, current, elapsed, modelName, modeReady, charCount, needsCode, accessCode } = studio
const { works } = useHistory()
const route = useRoute()
const router = useRouter()
const base = import.meta.env.BASE_URL
const fileInput = ref<HTMLInputElement>()
const resultPanel = ref<HTMLElement>()
const dragging = ref(false)
let dragDepth = 0
const counts = Array.from({ length: MAX_COUNT }, (_, index) => index + 1)

const photoSize = computed(() => {
  const size = photo.value?.size ?? 0
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(2)} MiB` : `${Math.max(1, Math.round(size / 1024))} KiB`
})
const aiResult = computed(() => result.value?.source === 'model')
const shown = computed(() => result.value?.options ?? options)
const styleInfo = computed(() => STYLES.find(style => style.id === options.style) ?? STYLES[0])
const proportionInfo = computed(() => PROPORTIONS.find(item => item.id === options.proportion) ?? PROPORTIONS[0])
const plural = computed(() => options.count > 1 ? ` ${options.count} 张` : '')
const generateLabel = computed(() => {
  if (modelName.value) return busy.value ? '正在生成…' : failed.value ? '重试生成' : result.value ? `重新生成${plural.value}` : options.count > 1 ? `生成${plural.value}公仔` : '生成我的公仔'
  return busy.value ? '正在准备示例…' : failed.value ? '重试示例生成' : result.value ? `重新生成${plural.value}示例` : options.count > 1 ? `生成${plural.value}公仔 · 示例` : '生成我的公仔 · 示例'
})
const copy = computed(() => modelName.value ? {
  photoMeta: '生成时发给模型',
  hint: `照片和描述会发给 ${modelName.value} 生成，每张按量计费。`,
  privacy: '生成时照片经你配置的接口发给模型服务；本页不保存，刷新即清除。',
  introTitle: '上传照片，生成你的公仔。',
  intro: '展示窗里现在是固定示例。\n点击生成后，照片会发给模型，按你的样子生成公仔，可能需要一两分钟。',
} : {
  photoMeta: '仅本地预览',
  hint: studio.mode.value.kind === 'demo' && studio.mode.value.problem ? `未启用真实生成：${studio.mode.value.problem}` : '演示版不根据照片或描述真实生成图片。',
  privacy: '照片不会上传或自动保存，刷新后即清除。',
  introTitle: '先体验，再想象。',
  intro: '当前展示固定人物插画，不会根据照片生成。\n你的照片只用于体验上传与原图对比。',
})
const figureAlt = computed(() => {
  const what = nameOf(COMPOSITIONS, shown.value.composition)
  if (aiResult.value) return `根据上传照片生成的${what}公仔`
  return result.value ? `固定${what}示例，非上传照片生成` : '公仔示例插画，非上传照片生成'
})
// 背景色只对真实结果生效：示例图本身是奶油灰底
const windowBackground = computed(() => aiResult.value && result.value?.options.background !== 'cream' ? result.value?.options.background : undefined)
const downloadName = computed(() => {
  if (!result.value || !current.value) return ''
  const suffix = result.value.images.length > 1 ? `-${selected.value + 1}` : ''
  const composition = result.value.options.composition
  return aiResult.value ? `Tim_pet-${composition}${suffix}.${current.value.extension}` : `Tim_pet-demo-${composition}${suffix}.png`
})
const recent = computed(() => works.slice(0, 8))

const hasFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files')
function onInput(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) void studio.choose(input.files)
  input.value = ''
}
// 用计数而不是单次 dragleave 判断离开，避免拖过子元素时高亮闪烁。
function onDragEnter(event: DragEvent) { if (!hasFiles(event)) return; dragDepth++; dragging.value = !locked.value }
function onDragLeave(event: DragEvent) { if (!hasFiles(event)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dragging.value = false }
function onDrop(event: DragEvent) {
  dragDepth = 0; dragging.value = false
  if (event.dataTransfer?.files.length) void studio.choose(event.dataTransfer.files)
}
// 文件拖到上传区以外时，阻止浏览器直接打开图片替换整个页面。
function blockStrayDrop(event: DragEvent) {
  if (event.defaultPrevented || !event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'none'
}
function onAccessCode(event: Event) {
  studio.setAccessCode((event.target as HTMLInputElement).value)
}
function onDescription(event: Event) {
  const input = event.target as HTMLTextAreaElement
  studio.setDescription(input.value)
  input.value = options.description
}
// 手机上下堆叠时结果区在设置下方，生成完成后滚过去，避免用户以为没有反应。
function revealResult() {
  const panel = resultPanel.value
  if (!panel || panel.getBoundingClientRect().top < window.innerHeight * 0.5) return
  panel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
}
async function generate() {
  if (await studio.generate()) void nextTick(revealResult)
}
// 首页的系列卡片会带上 ?style=clay 这样的参数
watch(() => route.query.style, style => {
  const match = STYLES.find(item => item.id === style)
  if (!match) return
  if (!locked.value) options.style = match.id
  void router.replace({ query: {} })
}, { immediate: true })
// 在工坊里看到了结果，就不再提示“生成好了”
watch(studio.unseen, value => { if (value) studio.unseen.value = false }, { immediate: true })
onMounted(() => {
  void studio.init()
  window.addEventListener('dragover', blockStrayDrop); window.addEventListener('drop', blockStrayDrop)
})
onBeforeUnmount(() => { window.removeEventListener('dragover', blockStrayDrop); window.removeEventListener('drop', blockStrayDrop) })
</script>

<template>
  <div class="container">
    <header class="page-head reveal" style="--i: 0">
      <p class="eyebrow">THE WORKSHOP</p>
      <h1>创作<mark class="hl">工坊</mark></h1>
      <p class="subtitle">上传照片、挑一个系列、调好细节，就可以拆盒了。照片和设置在切换页面时会保留，刷新页面才会清空。</p>
    </header>
    <div class="workspace">
      <section class="controls panel reveal" style="--i: 1" aria-labelledby="settings-heading">
        <div class="panel-heading">
          <h2 id="settings-heading">创作设置</h2>
          <span class="panel-meta">01 — 06</span>
        </div>

        <div class="step">
          <div class="field-heading">
            <h3><span class="step-no">01</span>一张你的照片</h3>
            <span class="field-meta">{{ copy.photoMeta }}</span>
          </div>
          <input ref="fileInput" class="file-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="上传照片" :disabled="locked" @change="onInput">
          <div v-if="!photo" class="dropzone" :class="{ dragging }" @dragenter="onDragEnter" @dragleave="onDragLeave" @dragover.prevent @drop.prevent="onDrop">
            <button class="upload-target" type="button" :disabled="locked" @click="fileInput?.click()">
              <span class="upload-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="14" rx="4"/><circle cx="12" cy="12.5" r="3.4"/><path d="M8.5 5.5 10 3.5h4l1.5 2"/></svg>
              </span>
              <strong>{{ validating ? '正在检查图片…' : '点击上传，或拖入照片' }}</strong>
              <span class="upload-hint">JPG / PNG / WebP · 最大 10 MiB</span>
            </button>
          </div>
          <div v-else class="photo-row" :class="{ dragging }" @dragenter="onDragEnter" @dragleave="onDragLeave" @dragover.prevent @drop.prevent="onDrop">
            <figure class="polaroid small"><img :src="photoUrl" alt="上传照片预览"></figure>
            <div class="photo-info">
              <strong>{{ photo.name }}</strong>
              <span>{{ photoSize }}</span>
              <div class="photo-actions">
                <button type="button" :disabled="locked" @click="fileInput?.click()">更换照片</button>
                <button type="button" :disabled="locked" @click="studio.removePhoto()">删除照片</button>
              </div>
            </div>
          </div>
          <p class="field-hint">建议使用清晰的单人照片，并确保你有权使用。</p>
        </div>

        <div class="step">
          <div class="field-heading"><h3><span class="step-no">02</span>选一个系列</h3><span class="field-meta">{{ STYLES.length }} 种风格</span></div>
          <div class="style-grid" role="group" aria-label="选择风格">
            <button v-for="style in STYLES" :key="style.id" type="button" class="style-card" :class="{ selected: options.style === style.id }" :aria-pressed="options.style === style.id" :disabled="locked" @click="options.style = style.id">
              <StyleSwatch :style="style.id" />{{ style.name }}
            </button>
          </div>
          <p class="style-note"><strong>{{ styleInfo.name }} · {{ styleInfo.tagline }}</strong><br>{{ styleInfo.note }}<template v-if="!modelName"><br>演示模式只有固定的 3D 公仔示例图，风格不会改变结果。</template></p>
        </div>

        <div class="step">
          <div class="field-heading"><h3><span class="step-no">03</span>构图与比例</h3></div>
          <div class="composition" role="group" aria-label="选择构图">
            <button type="button" :class="{ selected: options.composition === 'portrait' }" :aria-pressed="options.composition === 'portrait'" :disabled="locked" @click="options.composition = 'portrait'">
              <svg class="option-icon" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="13" r="7"/><path d="M5.5 28c1.6-5.4 5.6-8 10.5-8s8.9 2.6 10.5 8"/></svg>
              <strong>头像</strong><small>记录你的表情</small>
              <svg class="check" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 8.4 2.6 2.6L12 5.4"/></svg>
            </button>
            <button type="button" :class="{ selected: options.composition === 'full' }" :aria-pressed="options.composition === 'full'" :disabled="locked" @click="options.composition = 'full'">
              <svg class="option-icon" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="7.5" r="4.5"/><path d="M10.5 26.5V19c0-3.6 2.4-6 5.5-6s5.5 2.4 5.5 6v7.5M13.5 20v8.5M18.5 20v8.5"/></svg>
              <strong>全身</strong><small>收藏整个小小的你</small>
              <svg class="check" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 8.4 2.6 2.6L12 5.4"/></svg>
            </button>
          </div>
          <p class="sub-label">画面比例</p>
          <OptionChips v-model="options.ratio" label="画面比例" :options="RATIOS" :disabled="locked" />
          <p class="sub-label">头身比<template v-if="options.composition === 'portrait'">（全身构图才有）</template></p>
          <OptionChips v-model="options.proportion" label="头身比" :options="PROPORTIONS" :disabled="locked || options.composition === 'portrait'" />
          <p v-if="options.composition === 'full'" class="field-hint">{{ proportionInfo.note }}</p>
        </div>

        <div class="step">
          <div class="field-heading"><h3><span class="step-no">04</span>调一调细节</h3><span class="field-meta">可不改</span></div>
          <p class="sub-label">表情</p>
          <OptionChips v-model="options.expression" label="表情" :options="EXPRESSIONS" :disabled="locked" />
          <p class="sub-label">姿势<template v-if="options.composition === 'portrait'">（全身构图才有）</template></p>
          <OptionChips v-model="options.pose" label="姿势" :options="POSES" :disabled="locked || options.composition === 'portrait'" />
          <p class="sub-label">背景</p>
          <OptionChips v-model="options.background" label="背景" :options="BACKGROUNDS" :disabled="locked" />
        </div>

        <div class="step">
          <div class="field-heading"><h3><span class="step-no">05</span>加一点想象</h3><label class="field-meta" for="description">选填</label></div>
          <div class="textarea-wrap" :class="{ full: charCount >= MAX_DESCRIPTION }">
            <textarea id="description" aria-label="补充描述" :value="options.description" :disabled="locked" placeholder="比如：奶油色毛衣，手里抱着一只小猫…" @input="onDescription"></textarea>
            <span class="counter">{{ charCount }} / {{ MAX_DESCRIPTION }}</span>
          </div>
          <p class="field-hint">{{ copy.hint }}</p>
        </div>

        <div class="step last">
          <div class="field-heading"><h3><span class="step-no">06</span>一次做几个</h3><span class="field-meta">{{ modelName ? '每张单独计费' : '演示模式不花钱' }}</span></div>
          <div class="segmented" role="group" aria-label="生成数量">
            <button v-for="n in counts" :key="n" type="button" :class="{ selected: options.count === n }" :aria-pressed="options.count === n" :disabled="locked" @click="options.count = n">{{ n }} 张</button>
          </div>
        </div>

        <div v-if="needsCode" class="access">
          <div class="field-heading"><label for="access-code"><h3>邀请码</h3></label><span class="field-meta">{{ accessCode ? '已填写 · 真实生成' : '未填写 · 演示模式' }}</span></div>
          <input id="access-code" class="access-input" type="password" autocomplete="off" :value="accessCode" :disabled="locked" placeholder="输入邀请码后才会真实生成" @change="onAccessCode">
          <p class="field-hint">真实生成按张计费，所以需要邀请码，每个邀请码有自己的额度。没有邀请码也可以体验演示模式。</p>
        </div>

        <p v-if="error" :key="error" class="error" role="alert">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M10 6.2v4.6M10 13.6v.2"/></svg>
          <span>{{ error }}</span>
        </p>
        <button class="generate" type="button" :class="{ busy }" :disabled="locked || !photo || !modeReady" @click="generate">
          <span v-if="busy" class="spinner" aria-hidden="true"></span>
          <span class="generate-label">{{ generateLabel }}</span>
          <svg v-if="!busy" class="generate-arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 14 14 6M7.5 6H14v6.5"/></svg>
        </button>
        <p class="privacy">
          <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="9" width="11" height="8" rx="2.5"/><path d="M7 9V7a3 3 0 0 1 6 0v2"/></svg>
          {{ copy.privacy }}
        </p>
      </section>

      <section ref="resultPanel" class="result-panel panel reveal" style="--i: 2" aria-labelledby="result-heading">
        <div class="panel-heading">
          <h2 id="result-heading">{{ aiResult ? '你的公仔' : result ? '你的示例结果' : '小小的你，即将登场' }}</h2>
          <span class="sample-label" :class="{ live: aiResult }">{{ aiResult ? 'AI 生成' : '示例展示' }}</span>
        </div>
        <FigureBox
          :src="current?.url || `${base}samples/full.png`" :image-key="current?.url || 'placeholder'" :alt="figureAlt" :loading="busy" :background="windowBackground"
          top-left="TIM_PET / LITTLE COLLECTION" :top-right="`No.0${STYLES.findIndex(style => style.id === shown.style) + 1} · ${aiResult ? 'AI' : '示例'}`"
          :bottom-left="`${nameOf(STYLES, shown.style)} · ${nameOf(COMPOSITIONS, shown.composition)}款`"
          :bottom-right="busy ? (modelName ? '模型正在制作' : '正在准备你的体验') : aiResult ? 'AI 生成' : result ? 'DEMO / 非真实生成' : 'HELLO, LITTLE ME.'"
          :sticker="aiResult ? ['AI 款', 'NEW'] : ['示例款', 'SAMPLE']" :live="aiResult"
        >
          <div v-if="busy" class="unboxing" aria-hidden="true"><span class="spinner"></span>{{ modelName ? `生成中 · ${elapsed}s` : '拆盒中…' }}</div>
        </FigureBox>
        <div v-if="result && result.images.length > 1" class="thumbs" role="group" aria-label="选择一张">
          <button v-for="(image, index) in result.images" :key="image.url" type="button" class="thumb" :class="{ selected: selected === index }" :aria-pressed="selected === index" :aria-label="`第 ${index + 1} 张`" @click="selected = index">
            <img :src="image.url" alt=""><span>{{ index + 1 }}</span>
          </button>
        </div>
        <div v-if="result && photo && current" class="comparison">
          <figure class="polaroid"><img :src="photoUrl" alt="原图对比"><figcaption>你的原图</figcaption></figure>
          <svg class="compare-arrow" viewBox="0 0 48 24" aria-hidden="true"><path d="M3 15c9-9 24-11 39-4"/><path d="m35.5 5.2 7 5.9-8 3.6"/></svg>
          <figure class="polaroid tilt">
            <img :src="current.url" :alt="aiResult ? '公仔结果对比' : '固定示例对比'">
            <figcaption v-if="aiResult">AI 生成</figcaption>
            <figcaption v-else><span>固定示例 ·</span> <span>非真实生成</span></figcaption>
          </figure>
          <a class="download" :href="current.url" :download="downloadName">
            {{ aiResult ? '下载图片' : '下载示例' }}
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v9M6 9.5l4 4 4-4M5 16.5h10"/></svg>
          </a>
        </div>
        <div v-else class="result-description">
          <svg class="tiny-spark" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3c1.2 7 3.5 9.6 13 13-9.5 3.4-11.8 6-13 13-1.2-7-3.5-9.6-13-13 9.5-3.4 11.8-6 13-13Z"/></svg>
          <div><strong>{{ copy.introTitle }}</strong><p>{{ copy.intro }}</p></div>
        </div>
        <p class="status" role="status" aria-live="polite">{{ status }}</p>
      </section>
    </div>

    <section v-if="recent.length" class="recent" aria-labelledby="recent-title">
      <div class="recent-head"><h2 id="recent-title">最近作品</h2><RouterLink class="link-more" to="/gallery">全部作品 →</RouterLink></div>
      <div class="recent-strip">
        <RouterLink v-for="work in recent" :key="work.id" class="recent-item" to="/gallery" :aria-label="`${nameOf(STYLES, work.options.style)}作品，在画廊查看`"><img :src="work.url" alt=""></RouterLink>
      </div>
    </section>
  </div>
</template>
