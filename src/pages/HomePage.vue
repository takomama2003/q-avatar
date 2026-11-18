<script setup lang="ts">
import { computed, ref } from 'vue'
import { STYLES } from '../../shared/options'
import FigureBox from '../components/FigureBox.vue'
import StyleSwatch from '../components/StyleSwatch.vue'
import WorkCard from '../components/WorkCard.vue'
import WorkViewer from '../components/WorkViewer.vue'
import { FAQ } from '../content/faq'
import { SAMPLES } from '../content/samples'
import { useHistory, type Work } from '../stores/history'
import { useStudio } from '../stores/studio'

const base = import.meta.env.BASE_URL
const studio = useStudio()
void studio.init()
const { works } = useHistory()
const shelf = computed(() => works.slice(0, 4))
const viewing = ref<Work | null>(null)
const trust = computed(() => [
  {
    title: '照片不保存',
    text: studio.modelName.value
      ? '照片只在点击生成时经你配置的接口发给模型服务，本页不保存，刷新就清除。'
      : '演示模式下照片只在你的浏览器里预览，不会上传，刷新就清除。',
    link: '/help#privacy',
    icon: 'M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z M9 12l2 2 4-4',
  },
  { title: '每张单独计费', text: '真实生成按张计费，一次出几张就是几张的费用；失败不会自动重试，不会悄悄多扣。演示模式不花钱。', link: '/help#billing', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v10 M9 9.5c0-1 1.3-1.8 3-1.8s3 .8 3 1.8-1.3 1.6-3 2-3 1-3 2 1.3 1.8 3 1.8 3-.8 3-1.8' },
  { title: '作品存在本机', text: '生成的结果图存在这台电脑的浏览器里，可以随时回看、下载或清空；原照片不会被存下来。', link: '/gallery', icon: 'M4 8l8-4 8 4-8 4z M4 8v8l8 4 8-4V8 M12 12v8' },
])
const steps = [
  { title: '上传照片', text: '一张清晰的单人照，正脸效果最好。', icon: 'M4 8h3l2-3h6l2 3h3v11H4z M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z' },
  { title: '选一个系列', text: '五种风格：公仔、潮玩、黏土、像素、水彩。', icon: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.4-1.1-1.6-1.1-2.9 0-1 .8-1.5 1.8-1.5H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z M7.5 11.5h.01 M10 7.5h.01 M14.5 7.5h.01' },
  { title: '调一调细节', text: '构图、比例、表情、姿势、背景，再写一句想象。', icon: 'M4 7h10 M18 7h2 M4 17h4 M12 17h8 M14 4v6 M8 14v6' },
  { title: '拆开盲盒', text: '一次 1 到 4 张，挑最喜欢的下载收藏。', icon: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z' },
]
</script>

<template>
  <div class="container">
    <section class="hero" aria-labelledby="hero-title">
      <div class="reveal" style="--i: 0">
        <p class="eyebrow">MAKE A LITTLE YOU</p>
        <h1 id="hero-title"><span class="nowrap">把日常的你，</span><mark class="hl nowrap">装进小小世界</mark>。</h1>
        <p class="subtitle">上传一张照片，选一个系列，Tim_pet 帮你做成一个可以收藏的 Q 版公仔。不用注册，照片不保存。</p>
        <div class="hero-actions">
          <RouterLink class="btn btn-primary" to="/studio">开始创作 <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5l5 5-5 5" /></svg></RouterLink>
          <RouterLink class="btn btn-secondary" to="/gallery">看看作品</RouterLink>
        </div>
        <ul class="hero-facts">
          <li><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9" /></svg>5 个风格系列</li>
          <li><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9" /></svg>一次 1–4 张</li>
          <li><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9" /></svg>作品只存在本机</li>
        </ul>
      </div>
      <div class="hero-visual reveal" style="--i: 1" aria-hidden="true">
        <FigureBox :src="`${base}samples/full.png`" alt="" top-left="TIM_PET / LITTLE COLLECTION" top-right="No.01 · 示例" bottom-left="3D 公仔 · 全身款" bottom-right="HELLO, LITTLE ME." :sticker="['示例款', 'SAMPLE']" />
        <div class="hero-photo"><figure class="polaroid small"><svg viewBox="0 0 112 132" width="112" height="132"><rect width="112" height="132" rx="3" fill="#d9cbee" /><circle cx="56" cy="54" r="24" fill="#f5d2ae" /><path d="M32 50c2-16 12-24 24-24s22 8 24 24c-7-6-15-9-24-9s-17 3-24 9z" fill="#3b2c35" /><path d="M22 132c3-28 16-40 34-40s31 12 34 40z" fill="#6f52a8" /></svg><figcaption>你的照片</figcaption></figure></div>
        <svg class="hero-arrow" viewBox="0 0 88 48"><path d="M4 40c16-26 44-34 74-22" /><path d="m70 9 9 9-12 5" /></svg>
        <span class="hero-chip one">照片 → 公仔</span>
        <span class="hero-chip two">示例款 · 非真实生成</span>
      </div>
    </section>

    <section class="section" aria-labelledby="steps-title">
      <div class="section-head reveal" style="--i: 2">
        <div><p class="eyebrow">HOW IT WORKS</p><h2 id="steps-title">四步，拆开你的小盲盒</h2></div>
      </div>
      <ol class="steps">
        <li v-for="(step, index) in steps" :key="step.title" class="step-card reveal" :style="{ '--i': 3 + index }">
          <span class="step-no">0{{ index + 1 }}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="step.icon" /></svg>
          <h3>{{ step.title }}</h3>
          <p>{{ step.text }}</p>
        </li>
      </ol>
    </section>

    <section class="section" aria-labelledby="series-title">
      <div class="section-head">
        <div><p class="eyebrow">THE COLLECTION</p><h2 id="series-title">五个系列，挑一个你喜欢的</h2><p>每个系列一种材质和画风。图里是风格示意，实际效果以生成结果为准。</p></div>
        <RouterLink class="link-more" to="/help#styles">每个系列有什么不同 →</RouterLink>
      </div>
      <div class="series">
        <RouterLink v-for="(style, index) in STYLES" :key="style.id" class="series-card" :to="{ path: '/studio', query: { style: style.id } }" :aria-label="`用${style.name}系列开始创作`">
          <span class="series-no">No.0{{ index + 1 }}</span>
          <span class="series-window"><StyleSwatch :style="style.id" /></span>
          <h3>{{ style.name }}</h3>
          <p>{{ style.tagline }}</p>
          <span class="series-cta">试试这个 <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5l5 5-5 5" /></svg></span>
        </RouterLink>
      </div>
    </section>

    <section class="section" aria-labelledby="shelf-title">
      <div class="section-head">
        <div><p class="eyebrow">ON THE SHELF</p><h2 id="shelf-title">展示柜</h2><p>{{ shelf.length ? '你最近做的几个小公仔。' : '做好的公仔会摆在这里。现在架子上还空着。' }}</p></div>
        <RouterLink class="link-more" to="/gallery">打开作品画廊 →</RouterLink>
      </div>
      <div class="shelf">
        <WorkCard v-for="work in shelf" :key="work.id" :work="work" @open="viewing = work" />
        <template v-if="!shelf.length">
          <figure v-for="sample in SAMPLES" :key="sample.src" class="sample-card">
            <div class="work-thumb"><img :src="sample.src" :alt="sample.title"><span class="work-badge">示例</span></div>
            <figcaption class="work-meta"><strong>{{ sample.title }}</strong></figcaption>
          </figure>
        </template>
        <RouterLink v-if="shelf.length < 4" class="shelf-slot" to="/studio">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          {{ shelf.length ? '再做一个' : '做你的第一个' }}
        </RouterLink>
      </div>
    </section>

    <section class="section" aria-labelledby="trust-title">
      <div class="section-head"><div><p class="eyebrow">PLAY SAFE</p><h2 id="trust-title">放心玩</h2></div></div>
      <div class="trust">
        <article v-for="card in trust" :key="card.title" class="trust-card">
          <span class="trust-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="card.icon" /></svg></span>
          <h3>{{ card.title }}</h3>
          <p>{{ card.text }}</p>
          <RouterLink :to="card.link">了解更多 →</RouterLink>
        </article>
      </div>
    </section>

    <section class="section faq-preview" aria-labelledby="faq-title">
      <div class="section-head"><div><p class="eyebrow">QUESTIONS</p><h2 id="faq-title">常见问题</h2></div><RouterLink class="link-more" to="/help#faq">全部问题 →</RouterLink></div>
      <div class="faq">
        <details v-for="item in FAQ.slice(0, 3)" :key="item.q"><summary>{{ item.q }}</summary><p>{{ item.a }}</p></details>
      </div>
    </section>

    <section class="cta-band" aria-labelledby="cta-title">
      <div><h2 id="cta-title">准备好拆开你的小盲盒了吗？</h2><p>挑一张喜欢的照片，几分钟就好。</p></div>
      <RouterLink class="btn" to="/studio">去创作工坊</RouterLink>
    </section>
    <WorkViewer :work="viewing" @close="viewing = null" />
  </div>
</template>
