<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { currentUser, logout } from '../services/auth'
import ChibiAvatar from './ChibiAvatar.vue'
import { useStudio } from '../stores/studio'

// 顶栏：左边品牌和导航；右边没登录时是登录 / 注册，登录后是张数和头像菜单（我的账户、管理后台、退出登录）。
const studio = useStudio()
const route = useRoute()
const router = useRouter()
const navOpen = ref(false)
const menuOpen = ref(false)
const menuWrap = ref<HTMLElement>()
const menuButton = ref<HTMLButtonElement>()
watch(() => route.fullPath, () => { navOpen.value = false; menuOpen.value = false })
// 在别的页面时，工坊链接旁显示生成进度：转圈 = 正在生成，圆点 = 生成好了还没看
const flag = computed(() => route.name === 'studio' ? '' : studio.busy.value ? 'busy' : studio.unseen.value ? 'done' : '')
const links = [
  { to: '/', label: '首页' },
  { to: '/studio', label: '创作工坊' },
  { to: '/gallery', label: '作品画廊' },
  { to: '/help', label: '帮助' },
]
const loginTarget = computed(() => ({ name: 'login', query: route.name === 'login' ? route.query : { redirect: route.fullPath } }))
const registerTarget = computed(() => ({ name: 'login', query: { mode: 'register', redirect: route.name === 'login' ? route.query.redirect : route.fullPath } }))

async function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) {
    await nextTick()
    menuWrap.value?.querySelector<HTMLElement>('.ui-menu a, .ui-menu button')?.focus()
  }
}
function closeMenu(returnFocus = false) {
  if (!menuOpen.value) return
  menuOpen.value = false
  if (returnFocus) menuButton.value?.focus()
}
// 菜单里用上下键移动，Esc 关闭并回到头像按钮
function onMenuKey(event: KeyboardEvent) {
  const items = [...(menuWrap.value?.querySelectorAll<HTMLElement>('.ui-menu a, .ui-menu button') ?? [])]
  const index = items.indexOf(document.activeElement as HTMLElement)
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true) }
  else if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length]?.focus() }
  else if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus() }
  else if (event.key === 'Tab') closeMenu()
}
function onDocumentClick(event: MouseEvent) {
  if (menuOpen.value && !menuWrap.value?.contains(event.target as Node)) closeMenu()
}
async function signOut() {
  closeMenu()
  await logout()
  await router.push('/')
}
onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
  <header class="site-header">
    <div class="container header-inner">
      <RouterLink class="brand" to="/" aria-label="Tim_pet 首页">
        <span class="brand-mark" aria-hidden="true">t<span>·</span></span>
        <span class="brand-name">Tim_pet</span>
      </RouterLink>

      <nav id="site-nav" class="site-nav" :class="{ open: navOpen }" aria-label="主导航">
        <RouterLink v-for="link in links" :key="link.to" :to="link.to">
          {{ link.label }}
          <span v-if="link.to === '/studio' && flag" class="nav-flag" :class="flag" role="img" :aria-label="flag === 'busy' ? '正在生成' : '有新结果'"></span>
        </RouterLink>
        <template v-if="!currentUser">
          <RouterLink class="nav-auth" :to="loginTarget">登录</RouterLink>
          <RouterLink class="nav-auth" :to="registerTarget">免费注册</RouterLink>
        </template>
      </nav>

      <div class="header-actions">
        <template v-if="currentUser">
          <RouterLink class="credit-token" to="/account" :title="`剩余 ${currentUser.credits} 张，点击查看或兑换`">
            <span class="credit-coin" aria-hidden="true">★</span>
            <span class="credit-num">{{ currentUser.credits }}</span><span class="credit-unit">张</span>
          </RouterLink>
          <div ref="menuWrap" class="ui-menu-wrap" @keydown="onMenuKey">
            <button
              ref="menuButton" type="button" class="avatar-button" :aria-expanded="menuOpen" aria-haspopup="menu" aria-controls="account-menu"
              :aria-label="`${currentUser.username} 的账户菜单`" @click.stop="toggleMenu"
            >
              <ChibiAvatar :id="currentUser.avatar" :size="34" />
              <svg class="chevron" :class="{ up: menuOpen }" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
            </button>
            <div v-if="menuOpen" id="account-menu" class="ui-menu" role="menu">
              <div class="ui-menu-head">
                <ChibiAvatar :id="currentUser.avatar" :size="40" />
                <div>
                  <strong>{{ currentUser.username }}</strong>
                  <span>{{ currentUser.role === 'admin' ? '管理员' : '会员' }} · 剩余 {{ currentUser.credits }} 张</span>
                </div>
              </div>
              <RouterLink role="menuitem" to="/account">
                <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="7" r="3.2" /><path d="M3.5 17c1.2-3.3 3.6-5 6.5-5s5.3 1.7 6.5 5" /></svg>我的账户
              </RouterLink>
              <RouterLink role="menuitem" :to="{ path: '/account', query: { tab: 'credits' } }">
                <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M10 6.5v7M6.5 10h7" /></svg>兑换张数
              </RouterLink>
              <RouterLink v-if="currentUser.role === 'admin'" role="menuitem" to="/admin">
                <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="6" height="6" rx="1.5" /><rect x="11" y="3" width="6" height="6" rx="1.5" /><rect x="3" y="11" width="6" height="6" rx="1.5" /><rect x="11" y="11" width="6" height="6" rx="1.5" /></svg>管理后台
              </RouterLink>
              <hr>
              <button role="menuitem" type="button" class="danger" @click="signOut">
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4H5a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5 16h3M12.5 13.5 16 10l-3.5-3.5M16 10H8" /></svg>退出登录
              </button>
            </div>
          </div>
        </template>
        <template v-else>
          <RouterLink class="ui-btn ui-btn-ghost header-login" :to="loginTarget">登录</RouterLink>
          <RouterLink class="ui-btn ui-btn-primary header-register" :to="registerTarget">免费注册</RouterLink>
        </template>
      </div>

      <button type="button" class="menu-toggle" :aria-expanded="navOpen" aria-controls="site-nav" :aria-label="navOpen ? '收起菜单' : '打开菜单'" @click="navOpen = !navOpen">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path v-if="!navOpen" d="M4 7h16M4 12h16M4 17h16" /><path v-else d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>
  </header>
</template>
