<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { currentUser } from '../services/auth'
import { useStudio } from '../stores/studio'

const studio = useStudio()
const route = useRoute()
const open = ref(false)
watch(() => route.fullPath, () => { open.value = false })
// 在别的页面时，工坊链接旁显示生成进度：转圈 = 正在生成，圆点 = 生成好了还没看
const flag = computed(() => route.name === 'studio' ? '' : studio.busy.value ? 'busy' : studio.unseen.value ? 'done' : '')
const links = [
  { to: '/', label: '首页' },
  { to: '/studio', label: '创作工坊' },
  { to: '/gallery', label: '作品画廊' },
  { to: '/help', label: '帮助' },
]
</script>

<template>
  <header class="site-header">
    <div class="container header-inner">
      <RouterLink class="brand" to="/" aria-label="Tim_pet 首页">
        <span class="brand-mark" aria-hidden="true">t<span>·</span></span>
        <span class="brand-name">Tim_pet</span>
        <span class="brand-note">公仔工作室</span>
      </RouterLink>
      <nav id="site-nav" class="site-nav" :class="{ open }" aria-label="主导航">
        <RouterLink v-for="link in links" :key="link.to" :to="link.to">
          {{ link.label }}
          <span v-if="link.to === '/studio' && flag" class="nav-flag" :class="flag" role="img" :aria-label="flag === 'busy' ? '正在生成' : '有新结果'"></span>
        </RouterLink>
      </nav>
      <div class="header-actions">
        <span class="demo-tag" :class="{ live: studio.modelName.value }"><span class="demo-dot"></span><span class="demo-text">{{ studio.modelName.value ? `已配置 ${studio.modelName.value}` : '前端演示版' }}</span></span>
        <RouterLink v-if="currentUser" class="account-chip" to="/account" :title="`${currentUser.username} · 剩余 ${currentUser.credits} 张`">
          <span class="account-avatar" aria-hidden="true">{{ Array.from(currentUser.username)[0] }}</span>
          <span class="account-name">{{ currentUser.username }}</span>
          <span class="account-credits">{{ currentUser.credits }} 张</span>
        </RouterLink>
        <RouterLink v-else class="btn btn-secondary btn-small" :to="{ name: 'login', query: route.name === 'login' ? route.query : { redirect: route.fullPath } }">登录</RouterLink>
        <RouterLink class="btn btn-primary btn-small" to="/studio">开始创作</RouterLink>
      </div>
      <button type="button" class="menu-toggle" :aria-expanded="open" aria-controls="site-nav" :aria-label="open ? '收起菜单' : '打开菜单'" @click="open = !open">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path v-if="!open" d="M4 7h16M4 12h16M4 17h16" /><path v-else d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>
  </header>
</template>
