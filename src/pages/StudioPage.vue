<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BACKGROUNDS, COMPOSITIONS, EXPRESSIONS, MAX_COUNT, MAX_DESCRIPTION, POSES, PROPORTIONS, RATIOS, STYLES, nameOf } from '../../shared/options'
import ContactCard from '../components/ContactCard.vue'
import OptionChips from '../components/OptionChips.vue'
import StyleSwatch from '../components/StyleSwatch.vue'
import { currentUser } from '../services/auth'
import { useHistory } from '../stores/history'
import { useStudio } from '../stores/studio'

// 创作工坊页面只负责显示和交互；照片、选项和生成状态在 stores/studio.ts，切换页面不会丢。
const studio = useStudio()
const { photo, photoUrl, options, busy, validating, locked, error, failed, status, result, selected, current, elapsed, modeReady, available, charCount, accounts, signedIn, accountProblem } = studio
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
const shown = computed(() => result.value?.options ?? options)
const styleInfo = computed(() => STYLES.find(style => style.id === options.style) ?? STYLES[0])
const proportionInfo = computed(() => PROPORTIONS.find(item => item.id === options.proportion) ?? PROPORTIONS[0])
const needsLogin = computed(() => accounts.value && !signedIn.value)
const credits = computed(() => currentUser.value?.credits ?? 0)
const short = computed(() => accounts.value && signedIn.value && credits.value < options.count)
const generateLabel = computed(() => {
  if (!modeReady.value) return '正在准备…'
  if (!available.value) return '暂时不能生成'
  if (busy.value) return `正在生成 · ${elapsed.value}s`
  if (needsLogin.value) return '登录后生成'
  const n = options.count > 1 ? ` ${options.count} 张` : ''
  return failed.value ? '重新生成' : result.value ? `再生成${n}` : `生成${n || '我的公仔'}`
})
// 背景色跟着生成结果；还没生成时展示示例
const stageBackground = computed(() => result.value && result.value.options.background !== 'cream' ? result.value.options.background : '')
const downloadName = computed(() => {
  if (!result.value || !current.value) return ''
  const suffix = result.value.images.length > 1 ? `-${selected.value + 1}` : ''
  return `Tim_pet-${result.value.options.style}-${result.value.options.composition}${suffix}.${current.value.extension}`
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
  // 没登录：直接去登录页，登录完回到工坊（照片和设置在内存里保留）
  if (needsLogin.value) return void router.push({ name: 'login', query: { redirect: '/studio' } })
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
  <div class="container ui-page studio-page">
    <header class="ui-page-head reveal" style="--i: 0">
      <div>
        <h1>创作工坊</h1>
        <p>上传一张照片，选好风格和细节，一两分钟拿到你的 Q 版公仔。</p>
      </div>
      <RouterLink v-if="signedIn" class="studio-credits" to="/account" :class="{ low: short }">
        剩余 <strong>{{ credits }}</strong> 张
      </RouterLink>
    </header>

    <div class="workspace">
      <section class="ui-card studio-settings reveal" style="--i: 1" aria-label="创作设置">
        <div class="setting">
          <div class="setting-head"><h2><span class="setting-no">1</span>上传照片</h2><span class="ui-meta">JPG / PNG / WebP，最大 10 MiB</span></div>
          <input ref="fileInput" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" aria-label="上传照片" :disabled="locked" @change="onInput">
          <div v-if="!photo" class="dropzone" :class="{ dragging }" @dragenter="onDragEnter" @dragleave="onDragLeave" @dragover.prevent @drop.prevent="onDrop">
            <button class="dropzone-button" type="button" :disabled="locked" @click="fileInput?.click()">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 19h14" /></svg>
              <strong>{{ validating ? '正在检查图片…' : '点击上传，或把照片拖到这里' }}</strong>
              <span>正脸、光线均匀、只有一个人的照片效果最好</span>
            </button>
          </div>
          <div v-else class="photo-row" :class="{ dragging }" @dragenter="onDragEnter" @dragleave="onDragLeave" @dragover.prevent @drop.prevent="onDrop">
            <img class="photo-thumb" :src="photoUrl" alt="上传照片预览">
            <div class="photo-info">
              <strong>{{ photo.name }}</strong>
              <span>{{ photoSize }}</span>
              <div class="photo-actions">
                <button type="button" class="ui-btn ui-btn-secondary ui-btn-sm" :disabled="locked" @click="fileInput?.click()">更换</button>
                <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" :disabled="locked" @click="studio.removePhoto()">删除</button>
              </div>
            </div>
          </div>
        </div>

        <div class="setting">
          <div class="setting-head"><h2><span class="setting-no">2</span>选择风格</h2></div>
          <div class="style-grid" role="group" aria-label="风格">
            <button v-for="style in STYLES" :key="style.id" type="button" class="style-card" :class="{ selected: options.style === style.id }" :aria-pressed="options.style === style.id" :disabled="locked" @click="options.style = style.id">
              <StyleSwatch :style="style.id" /><span>{{ style.name }}</span>
            </button>
          </div>
          <p class="ui-hint style-note"><strong>{{ styleInfo.tagline }}</strong> · {{ styleInfo.note }}</p>
        </div>

        <div class="setting">
          <div class="setting-head"><h2><span class="setting-no">3</span>构图和比例</h2></div>
          <div class="composition" role="group" aria-label="构图">
            <button v-for="c in COMPOSITIONS" :key="c.id" type="button" :class="{ selected: options.composition === c.id }" :aria-pressed="options.composition === c.id" :disabled="locked" @click="options.composition = c.id">
              <svg v-if="c.id === 'portrait'" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="13" r="7" /><path d="M5.5 28c1.6-5.4 5.6-8 10.5-8s8.9 2.6 10.5 8" /></svg>
              <svg v-else viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="7.5" r="4.5" /><path d="M10.5 26.5V19c0-3.6 2.4-6 5.5-6s5.5 2.4 5.5 6v7.5M13.5 20v8.5M18.5 20v8.5" /></svg>
              <span><strong>{{ c.name }}</strong><small>{{ c.id === 'portrait' ? '胸口以上，看清表情' : '从头到脚的小人' }}</small></span>
            </button>
          </div>
          <div class="field-row">
            <span class="ui-label">画面比例</span>
            <OptionChips v-model="options.ratio" label="画面比例" :options="RATIOS" :disabled="locked" />
          </div>
          <div v-if="options.composition === 'full'" class="field-row">
            <span class="ui-label">头身比</span>
            <OptionChips v-model="options.proportion" label="头身比" :options="PROPORTIONS" :disabled="locked" />
            <p class="ui-hint">{{ proportionInfo.note }}</p>
          </div>
        </div>

        <div class="setting">
          <div class="setting-head"><h2><span class="setting-no">4</span>细节</h2><span class="ui-meta">不改也可以</span></div>
          <div class="field-row">
            <span class="ui-label">表情</span>
            <OptionChips v-model="options.expression" label="表情" :options="EXPRESSIONS" :disabled="locked" />
          </div>
          <div v-if="options.composition === 'full'" class="field-row">
            <span class="ui-label">姿势</span>
            <OptionChips v-model="options.pose" label="姿势" :options="POSES" :disabled="locked" />
          </div>
          <div class="field-row">
            <span class="ui-label">背景</span>
            <OptionChips v-model="options.background" label="背景" :options="BACKGROUNDS" :disabled="locked" />
          </div>
          <label class="field-row">
            <span class="ui-label">补充描述<small>选填</small></span>
            <span class="textarea-wrap" :class="{ full: charCount >= MAX_DESCRIPTION }">
              <textarea class="ui-input" :value="options.description" :disabled="locked" rows="3" placeholder="比如：奶油色毛衣，手里抱着一只小猫" @input="onDescription"></textarea>
              <span class="counter">{{ charCount }} / {{ MAX_DESCRIPTION }}</span>
            </span>
          </label>
        </div>

        <div class="setting">
          <div class="setting-head"><h2><span class="setting-no">5</span>生成张数</h2><span class="ui-meta">每张用 1 张额度</span></div>
          <div class="segmented" role="group" aria-label="生成张数">
            <button v-for="n in counts" :key="n" type="button" :class="{ selected: options.count === n }" :aria-pressed="options.count === n" :disabled="locked" @click="options.count = n">{{ n }} 张</button>
          </div>
          <p class="ui-hint">同一组设置每次都不一样，多生成几张可以挑最喜欢的。</p>
        </div>

        <div class="studio-action">
          <p v-if="modeReady && !available" class="ui-alert warn" role="status">生成服务正在维护，暂时不能生成，请稍后再来。</p>
          <p v-else-if="error" :key="error" class="ui-alert err" role="alert">{{ error }}</p>
          <div v-if="accountProblem === 'no_credits' || (short && !busy)" class="studio-buy">
            <ContactCard compact title="张数不够了" lead="加客服微信购买兑换码，在“我的账户”里兑换后回来继续生成。">
              <RouterLink class="ui-btn ui-btn-secondary ui-btn-sm" to="/account">去输入兑换码</RouterLink>
            </ContactCard>
          </div>
          <button class="ui-btn ui-btn-primary ui-btn-lg ui-btn-block generate" type="button" :disabled="locked || !modeReady || !available || (!photo && !needsLogin)" :aria-busy="busy" @click="generate">
            <span v-if="busy" class="spinner" aria-hidden="true"></span>{{ generateLabel }}
          </button>
          <p class="studio-privacy">
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="9" width="11" height="8" rx="2.5" /><path d="M7 9V7a3 3 0 0 1 6 0v2" /></svg>
            <span>照片只在生成时发给图像模型，本站不保存。<RouterLink to="/privacy">隐私政策</RouterLink></span>
          </p>
        </div>
      </section>

      <section ref="resultPanel" class="ui-card studio-result reveal" style="--i: 2" aria-labelledby="result-heading">
        <div class="ui-card-body">
          <div class="ui-card-head">
            <h2 id="result-heading">{{ result ? '你的公仔' : '效果示例' }}</h2>
            <span v-if="!result" class="ui-tag">示例作品</span>
          </div>
          <div class="stage" :class="[stageBackground && `bg-${stageBackground}`, { loading: busy }]" :aria-busy="busy">
            <img :key="current?.url || 'sample'" class="stage-image" :src="current?.url || `${base}samples/${shown.composition === 'portrait' ? 'portrait' : 'full'}.png`" :alt="result ? `根据你的照片生成的${nameOf(STYLES, shown.style)}${nameOf(COMPOSITIONS, shown.composition)}` : '示例作品：3D 公仔风格'">
            <span v-if="result" class="ai-mark">AI 生成</span>
            <div v-if="busy" class="stage-busy" aria-hidden="true"><span class="spinner"></span>生成中 · {{ elapsed }}s</div>
          </div>
          <div v-if="result && result.images.length > 1" class="thumbs" role="group" aria-label="选择一张">
            <button v-for="(image, index) in result.images" :key="image.url" type="button" class="thumb" :class="{ selected: selected === index }" :aria-pressed="selected === index" :aria-label="`第 ${index + 1} 张`" @click="selected = index">
              <img :src="image.url" alt=""><span>{{ index + 1 }}</span>
            </button>
          </div>
          <div v-if="result && current" class="result-actions">
            <img v-if="photo" class="compare-photo" :src="photoUrl" alt="你的原图">
            <div class="result-meta">
              <strong>{{ nameOf(STYLES, shown.style) }} · {{ nameOf(COMPOSITIONS, shown.composition) }}</strong>
              <span>已存进作品画廊（只在这个浏览器）</span>
            </div>
            <a class="ui-btn ui-btn-primary" :href="current.url" :download="downloadName">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v9M6 9.5l4 4 4-4M5 16.5h10" /></svg>下载图片
            </a>
          </div>
          <p v-else class="ui-hint result-intro">上面是本站生成的示例。上传你的照片后点“生成”，结果会显示在这里。</p>
          <p class="studio-status" role="status" aria-live="polite">{{ status }}</p>
        </div>
      </section>
    </div>

    <section v-if="recent.length" class="recent" aria-labelledby="recent-title">
      <div class="recent-head"><h2 id="recent-title">最近作品</h2><RouterLink class="link-inline" to="/gallery">全部作品</RouterLink></div>
      <div class="recent-strip">
        <RouterLink v-for="work in recent" :key="work.id" class="recent-item" to="/gallery" :aria-label="`${nameOf(STYLES, work.options.style)}作品，在画廊查看`"><img :src="work.url" alt=""></RouterLink>
      </div>
    </section>
  </div>
</template>
