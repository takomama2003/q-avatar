import { createRouter, createWebHistory } from 'vue-router'
import HomePage from './pages/HomePage.vue'
import StudioPage from './pages/StudioPage.vue'

// 首页和工坊直接打包；画廊、帮助和 404 按需加载。
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomePage, meta: { title: 'Tim_pet · 你的公仔工作室' } },
    { path: '/studio', name: 'studio', component: StudioPage, meta: { title: '创作工坊 · Tim_pet' } },
    { path: '/gallery', name: 'gallery', component: () => import('./pages/GalleryPage.vue'), meta: { title: '作品画廊 · Tim_pet' } },
    { path: '/help', name: 'help', component: () => import('./pages/HelpPage.vue'), meta: { title: '使用说明 · Tim_pet' } },
    { path: '/:rest(.*)*', name: 'not-found', component: () => import('./pages/NotFoundPage.vue'), meta: { title: '页面不存在 · Tim_pet' } },
  ],
  scrollBehavior(to, _from, saved) {
    if (saved) return saved
    if (to.hash) return { el: to.hash, top: 96, behavior: 'smooth' }
    return { top: 0 }
  },
})

router.afterEach((to, from) => {
  document.title = typeof to.meta.title === 'string' ? to.meta.title : 'Tim_pet'
  // 换页后把焦点移到正文开头，键盘和读屏用户不用从导航栏重新找起（首次打开页面时不移动）。
  if (from.matched.length && to.path !== from.path) requestAnimationFrame(() => document.getElementById('main-content')?.focus({ preventScroll: true }))
})

export default router
