<script setup lang="ts">
import { STYLES } from '../../shared/options'
import ContactCard from '../components/ContactCard.vue'
import StyleSwatch from '../components/StyleSwatch.vue'
import { FAQ } from '../content/faq'
import { SAMPLES } from '../content/samples'
import { currentUser } from '../services/auth'

// 首页：讲清楚做什么（照片 → Q 版公仔）、示例作品、怎么开始、怎么买张数、照片怎么处理。
const base = import.meta.env.BASE_URL
const steps = [
  { title: '注册账号', text: '只要用户名和密码，不需要手机号。' },
  { title: '兑换张数', text: '加客服微信购买兑换码，在“我的账户”输入。' },
  { title: '上传照片', text: '选风格、构图、表情和背景，一两分钟出图。' },
  { title: '下载收藏', text: '一次 1 到 4 张，挑喜欢的下载。' },
]
const promises = [
  { title: '照片不保存', text: '照片只在生成时发给图像模型，本站服务器不保存照片，也不保存生成的图片。', link: '/privacy' },
  { title: '没出图自动退回', text: '1 张额度生成 1 张图，没生成出来的张数自动退回账户，不用找客服。', link: '/help#billing' },
  { title: '作品只在你手里', text: '作品存在你自己的浏览器里，随时下载或删除；图片带有“AI 生成”标识。', link: '/help#privacy' },
]
</script>

<template>
  <div class="container home">
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-text reveal" style="--i: 0">
        <span class="hero-tag">AI 照片转 Q 版公仔</span>
        <h1 id="hero-title">一张照片，<br>做成你的 Q 版公仔</h1>
        <p class="hero-lead">上传一张清晰的照片，选一个风格：3D 公仔、盲盒潮玩、黏土、像素或水彩。一两分钟拿到可以收藏的小小的你。</p>
        <div class="hero-actions">
          <RouterLink class="ui-btn ui-btn-primary ui-btn-lg" to="/studio">开始制作</RouterLink>
          <RouterLink v-if="!currentUser" class="ui-btn ui-btn-secondary ui-btn-lg" :to="{ name: 'login', query: { mode: 'register', redirect: '/studio' } }">免费注册</RouterLink>
          <RouterLink v-else class="ui-btn ui-btn-secondary ui-btn-lg" to="/account">剩余 {{ currentUser.credits }} 张</RouterLink>
        </div>
        <ul class="hero-points">
          <li>5 种风格</li><li>一次 1–4 张</li><li>照片不保存</li>
        </ul>
      </div>
      <div class="hero-visual reveal" style="--i: 1">
        <figure class="hero-main">
          <img :src="`${base}samples/full.png`" alt="示例作品：3D 公仔风格的全身 Q 版人物">
          <figcaption>示例作品 · 3D 公仔 · 全身</figcaption>
        </figure>
        <figure class="hero-side">
          <img :src="`${base}samples/portrait.png`" alt="示例作品：3D 公仔风格的头像">
          <figcaption>头像款</figcaption>
        </figure>
      </div>
    </section>

    <section id="samples" class="home-section" aria-labelledby="styles-title">
      <div class="home-head">
        <h2 id="styles-title">五种风格</h2>
        <p>每种风格一种材质和画风。下面是风格示意，实际效果以生成结果为准。</p>
      </div>
      <div class="series">
        <RouterLink v-for="style in STYLES" :key="style.id" class="series-card" :to="{ path: '/studio', query: { style: style.id } }" :aria-label="`用${style.name}风格开始制作`">
          <span class="series-art"><StyleSwatch :style="style.id" /></span>
          <strong>{{ style.name }}</strong>
          <span>{{ style.tagline }}</span>
        </RouterLink>
      </div>
      <div class="samples">
        <figure v-for="sample in SAMPLES" :key="sample.src" class="sample">
          <img :src="sample.src" :alt="`示例作品：${sample.title}`" loading="lazy">
          <figcaption>{{ sample.title }}</figcaption>
        </figure>
      </div>
    </section>

    <section class="home-section" aria-labelledby="steps-title">
      <div class="home-head"><h2 id="steps-title">怎么开始</h2></div>
      <ol class="steps">
        <li v-for="(step, index) in steps" :key="step.title">
          <span class="step-num">{{ index + 1 }}</span>
          <strong>{{ step.title }}</strong>
          <p>{{ step.text }}</p>
        </li>
      </ol>
    </section>

    <section class="home-section home-buy" aria-labelledby="buy-title">
      <div class="home-head">
        <h2 id="buy-title">购买张数</h2>
        <p>和充值卡一样：先买兑换码，再到网站兑换张数。1 张额度生成 1 张图。</p>
      </div>
      <div class="ui-card"><div class="ui-card-body"><ContactCard /></div></div>
    </section>

    <section class="home-section" aria-labelledby="promise-title">
      <div class="home-head"><h2 id="promise-title">放心用</h2></div>
      <div class="promises">
        <article v-for="item in promises" :key="item.title" class="promise">
          <h3>{{ item.title }}</h3>
          <p>{{ item.text }}</p>
          <RouterLink class="link-inline" :to="item.link">了解更多</RouterLink>
        </article>
      </div>
    </section>

    <section class="home-section home-faq" aria-labelledby="faq-title">
      <div class="home-head"><h2 id="faq-title">常见问题</h2><RouterLink class="link-inline" to="/help#faq">全部问题</RouterLink></div>
      <div class="faq">
        <details v-for="item in FAQ.slice(0, 4)" :key="item.q"><summary>{{ item.q }}</summary><p>{{ item.a }}</p></details>
      </div>
    </section>

    <section class="home-cta" aria-labelledby="cta-title">
      <div><h2 id="cta-title">挑一张喜欢的照片，现在就试试</h2><p>注册免费，兑换张数后就能生成。</p></div>
      <RouterLink class="ui-btn ui-btn-lg home-cta-btn" to="/studio">去创作工坊</RouterLink>
    </section>
  </div>
</template>
