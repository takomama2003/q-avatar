<script setup lang="ts">
import { computed, ref } from 'vue'
import { MAX_WORKS, useHistory, type Work } from '../stores/history'
import { STYLES, type StyleId } from '../../shared/options'
import Modal from '../components/Modal.vue'
import OptionChips from '../components/OptionChips.vue'
import WorkCard from '../components/WorkCard.vue'
import WorkViewer from '../components/WorkViewer.vue'
import { SAMPLES } from '../content/samples'

// 作品画廊：这个浏览器里保存的作品，按风格筛选；还没有作品时展示示例。
const { works, available, clearWorks } = useHistory()
const filter = ref<'all' | StyleId>('all')
const filters = [{ id: 'all' as const, name: '全部' }, ...STYLES.map(style => ({ id: style.id, name: style.name }))]
const shown = computed(() => filter.value === 'all' ? works : works.filter(work => work.options.style === filter.value))
const viewing = ref<Work | null>(null)
const confirming = ref(false)
async function clearAll() { await clearWorks(); confirming.value = false }
</script>

<template>
  <div class="container ui-page">
    <header class="ui-page-head reveal" style="--i: 0">
      <div>
        <h1>作品画廊</h1>
        <p>在这个浏览器里做过的公仔都在这里。只保存生成的图片和当时的设置，不保存原照片。</p>
      </div>
      <RouterLink class="ui-btn ui-btn-primary" to="/studio">再做一个</RouterLink>
    </header>

    <div v-if="!available" class="ui-card gallery-empty">
      <strong>这个浏览器不能保存作品</strong>
      <p>可能是无痕模式或关闭了网站存储。生成和下载不受影响，只是不会留下记录。</p>
    </div>

    <template v-else-if="works.length">
      <div class="gallery-bar">
        <OptionChips v-model="filter" label="按风格筛选" :options="filters" />
        <span class="ui-meta">共 {{ works.length }} 张</span>
      </div>
      <div v-if="shown.length" class="work-grid">
        <WorkCard v-for="work in shown" :key="work.id" :work="work" @open="viewing = work" />
      </div>
      <p v-else class="ui-empty">这个风格还没有作品。</p>
      <div class="gallery-note">
        <span>最多保留最近 {{ MAX_WORKS }} 张。换浏览器或清除浏览器数据后会消失，喜欢的记得下载。</span>
        <button type="button" class="ui-btn ui-btn-danger ui-btn-sm" @click="confirming = true">清空全部</button>
      </div>
    </template>

    <template v-else>
      <div class="ui-card gallery-empty">
        <strong>还没有作品</strong>
        <p>去创作工坊做第一个公仔，做好后会自动保存到这里。下面是示例作品。</p>
        <RouterLink class="ui-btn ui-btn-primary" to="/studio">去创作工坊</RouterLink>
      </div>
      <div class="work-grid samples-grid">
        <figure v-for="sample in SAMPLES" :key="sample.src" class="sample-card">
          <div class="work-thumb"><img :src="sample.src" :alt="`示例作品：${sample.title}`"><span class="work-badge">示例</span></div>
          <figcaption class="work-meta"><strong>{{ sample.title }}</strong></figcaption>
        </figure>
      </div>
    </template>

    <WorkViewer :work="viewing" @close="viewing = null" />
    <Modal :open="confirming" title="清空全部作品？" :description="`会删除这个浏览器里的 ${works.length} 张作品，删除后不能恢复。`" @close="confirming = false">
      <p class="ui-hint">还想留着的，请先打开大图下载。</p>
      <template #foot>
        <button type="button" class="ui-btn ui-btn-secondary" @click="confirming = false">取消</button>
        <button type="button" class="ui-btn ui-btn-danger" @click="clearAll">确认清空</button>
      </template>
    </Modal>
  </div>
</template>
