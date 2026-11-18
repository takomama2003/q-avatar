import { createApp } from 'vue'
import '@fontsource-variable/fredoka'
import App from './App.vue'
import router from './router'
import './styles.css'
createApp(App).use(router).mount('#app')
// 站酷快乐体按字切片，@font-face 声明很长，异步加载以免阻塞首屏；加载失败时沿用系统字体。
void import('@fontsource/zcool-kuaile').catch(() => {})
