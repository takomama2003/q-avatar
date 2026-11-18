<script setup lang="ts">
import { computed, ref } from 'vue'
import { MAX_WORKS, useHistory, type Work } from '../stores/history'
import { STYLES, type StyleId } from '../../shared/options'
import OptionChips from '../components/OptionChips.vue'
import WorkCard from '../components/WorkCard.vue'
import WorkViewer from '../components/WorkViewer.vue'

import { SAMPLES } from '../content/samples'

const { works, available, clearWorks } = useHistory()
const tab = ref<'mine' | 'samples'>('mine')
const filter = ref<'all' | StyleId>('all')
const filters = [{ id: 'all' as const, name: '全部' }, ...STYLES.map(style => ({ id: style.id, name: style.name }))]
const shown = computed(() => filter.value === 'all' ? works : works.filter(work => work.options.style === filter.value))
const viewing = ref<Work | null>(null)
const confirming = ref(false)
async function clearAll() { await clearWorks(); confirming.value = false }
</script>

<template>
  <div class="container">
    <header class="page-head reveal" style="--i: 0">
      <p class="eyebrow">THE DISPLAY CABINET</p>
      <h1>作品<mark class="hl">画廊</mark></h1>
      <p class="subtitle">你在这台电脑上做过的公仔都摆在这里。只保存生成的结果图和当时的设置，不保存原照片。</p>
    </header>

    <div class="gallery-bar">
      <div class="tabs" role="group" aria-label="切换">
        <button type="button" :class="{ selected: tab === 'mine' }" :aria-pressed="tab === 'mine'" @click="tab = 'mine'">我的作品<span class="count">{{ works.length }}</span></button>
        <button type="button" :class="{ selected: tab === 'samples' }" :aria-pressed="tab === 'samples'" @click="tab = 'samples'">官方示例</button>
      </div>
      <RouterLink class="btn btn-primary btn-small" to="/studio">再做一个</RouterLink>
    </div>

    <template v-if="tab === 'mine'">
      <div v-if="!available" class="empty">
        <strong>这个浏览器不能保存作品</strong>
        <p>可能是无痕模式或关闭了网站存储。生成和下载不受影响，只是不会留下记录。</p>
      </div>
      <template v-else-if="works.length">
        <OptionChips v-model="filter" class="gallery-filters" label="按风格筛选" :options="filters" />
        <div v-if="shown.length" class="work-grid">
          <WorkCard v-for="work in shown" :key="work.id" :work="work" @open="viewing = work" />
        </div>
        <p v-else class="empty">这个系列还没有作品。</p>
        <div class="gallery-note">
          <span>共 {{ works.length }} 张，最多保留最近 {{ MAX_WORKS }} 张；换浏览器或清除浏览器数据后会消失，喜欢的记得下载。</span>
          <button v-if="!confirming" type="button" class="btn btn-danger btn-small" @click="confirming = true">清空全部</button>
          <span v-else class="confirm-row">确定删除全部 {{ works.length }} 张？
            <button type="button" class="btn btn-danger btn-small" @click="clearAll">确认清空</button>
            <button type="button" class="btn btn-ghost btn-small" @click="confirming = false">取消</button>
          </span>
        </div>
      </template>
      <div v-else class="empty">
        <svg viewBox="0 0 120 100" aria-hidden="true"><path d="M14 40 60 22l46 18-46 18z" /><path d="M14 40v34l46 18 46-18V40M60 58v34" /><path d="M14 40 4 26l46-18 10 14M106 40l10-14-46-18-10 14" stroke-dasharray="4 4" /></svg>
        <strong>展示柜还是空的</strong>
        <p>去创作工坊做第一个公仔吧，做好后会自动摆到这里。</p>
        <RouterLink class="btn btn-primary" to="/studio">去创作工坊</RouterLink>
      </div>
    </template>

    <template v-else>
      <div class="work-grid">
        <figure v-for="sample in SAMPLES" :key="sample.src" class="sample-card">
          <div class="work-thumb"><img :src="sample.src" :alt="sample.title"><span class="work-badge">示例</span></div>
          <figcaption><span class="work-meta"><strong>{{ sample.title }}</strong></span><p>{{ sample.note }}</p></figcaption>
        </figure>
      </div>
      <p class="gallery-note">其他系列（盲盒潮玩、黏土、像素、水彩）暂时没有固定示例图，配置模型后用自己的照片试一试。</p>
    </template>
    <WorkViewer :work="viewing" @close="viewing = null" />
  </div>
</template>
