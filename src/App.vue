<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import AppFooter from './components/AppFooter.vue'
import AppHeader from './components/AppHeader.vue'
import { useStudio } from './stores/studio'

// 网站外壳：导航栏、页面内容、页脚，以及“生成好了”的提示。
const studio = useStudio()
const route = useRoute()
void studio.init()
const toast = computed(() => studio.unseen.value && route.name !== 'studio')
// 真实生成进行中关闭或刷新页面会丢掉这次结果（但可能已经扣费），先提醒一下。
function warnBeforeLeave(event: BeforeUnloadEvent) {
  if (studio.busy.value && studio.modelName.value) event.preventDefault()
}
onMounted(() => window.addEventListener('beforeunload', warnBeforeLeave))
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeLeave))
</script>

<template>
  <a class="skip-link" href="#main-content">跳到正文</a>
  <AppHeader />
  <main id="main-content" tabindex="-1">
    <RouterView />
  </main>
  <AppFooter />
  <div v-if="toast" class="toast" role="status">
    <strong>你的公仔生成好了</strong>
    <RouterLink class="btn btn-primary" to="/studio">去看看</RouterLink>
    <button type="button" class="toast-close" aria-label="关闭提示" @click="studio.unseen.value = false">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" /></svg>
    </button>
  </div>
</template>
