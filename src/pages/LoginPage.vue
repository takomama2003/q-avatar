<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FigureBox from '../components/FigureBox.vue'
import { PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN, checkPassword, checkUsername, login, register, safeRedirect } from '../services/auth'

// 会员登记卡：登录和注册在同一张卡上切换。登录后回到来时的页面，默认去创作工坊。
type Mode = 'login' | 'register'
const route = useRoute()
const router = useRouter()
const base = import.meta.env.BASE_URL
const mode = ref<Mode>(route.query.mode === 'register' ? 'register' : 'login')
const username = ref('')
const password = ref('')
const confirm = ref('')
const agreed = ref(false)
const showPassword = ref(false)
const busy = ref(false)
const error = ref('')
// 失焦或提交后才显示字段错误，不在用户刚开始输入时就报错
const touched = ref({ username: false, password: false, confirm: false })
const usernameInput = ref<HTMLInputElement>()

const isRegister = computed(() => mode.value === 'register')
const usernameError = computed(() => touched.value.username ? checkUsername(username.value) : '')
const passwordError = computed(() => touched.value.password ? checkPassword(password.value) : '')
const confirmError = computed(() => isRegister.value && touched.value.confirm && confirm.value !== password.value ? '两次输入的密码不一样。' : '')
const redirect = computed(() => safeRedirect(route.query.redirect))
const copy = computed(() => isRegister.value
  ? { title: '领一张会员卡', lead: '注册后，用 Tim 发给你的兑换码兑换张数，就能按你的照片真实生成公仔。', submit: busy.value ? '正在注册…' : '注册并登录', sticker: ['新会员', 'MEMBER'] as [string, string] }
  : { title: '欢迎回来', lead: '登录后用你的额度真实生成公仔，额度在“我的账户”里查看和兑换。', submit: busy.value ? '正在登录…' : '登录', sticker: ['欢迎回来', 'WELCOME'] as [string, string] })

function switchMode(next: Mode) {
  if (busy.value || mode.value === next) return
  mode.value = next
  error.value = ''
  touched.value = { username: false, password: false, confirm: false }
  confirm.value = ''
  void router.replace({ query: { ...route.query, mode: next === 'register' ? 'register' : undefined } })
}
// 标签栏的左右方向键切换
function onTabKey(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  switchMode(isRegister.value ? 'login' : 'register')
  void nextTick(() => (document.querySelector('[role="tab"][aria-selected="true"]') as HTMLElement | null)?.focus())
}

async function submit() {
  touched.value = { username: true, password: true, confirm: true }
  error.value = ''
  const problem = checkUsername(username.value) || checkPassword(password.value) || confirmError.value
  if (problem) { error.value = problem; return }
  if (isRegister.value && !agreed.value) { error.value = '请先勾选，确认你了解照片的去向。'; return }
  busy.value = true
  try {
    await (isRegister.value ? register(username.value, password.value) : login(username.value, password.value))
    await router.replace(redirect.value)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '出错了，请稍后重试。'
    password.value = ''
    confirm.value = ''
  } finally {
    busy.value = false
  }
}
watch(mode, () => void nextTick(() => usernameInput.value?.focus()))
</script>

<template>
  <div class="container login-page">
    <section class="login-showcase reveal" style="--i: 0" aria-hidden="true">
      <FigureBox
        :src="`${base}samples/full.png`" alt="" image-key="member"
        top-left="TIM_PET / MEMBER CLUB" top-right=""
        bottom-left="收藏你的小小公仔" bottom-right="MEMBER ONLY" :sticker="copy.sticker" :live="!isRegister"
      />
      <ol class="login-steps">
        <li><span>1</span>注册账号</li>
        <li><span>2</span>输入兑换码，领取张数</li>
        <li><span>3</span>上传照片，生成公仔</li>
      </ol>
    </section>

    <section class="login-card panel reveal" style="--i: 1" aria-labelledby="login-title">
      <div class="card-band"><span>MEMBER CARD</span><span>{{ isRegister ? 'REGISTER' : 'SIGN IN' }}</span></div>
      <div class="card-tabs" role="tablist" aria-label="登录或注册" @keydown="onTabKey">
        <button id="tab-login" type="button" role="tab" :aria-selected="!isRegister" aria-controls="login-form" :tabindex="isRegister ? -1 : 0" @click="switchMode('login')">登录</button>
        <button id="tab-register" type="button" role="tab" :aria-selected="isRegister" aria-controls="login-form" :tabindex="isRegister ? 0 : -1" @click="switchMode('register')">注册</button>
      </div>

      <h1 id="login-title" :key="mode">{{ copy.title }}</h1>
      <p class="login-lead">{{ copy.lead }}</p>

      <form id="login-form" role="tabpanel" :aria-labelledby="isRegister ? 'tab-register' : 'tab-login'" novalidate @submit.prevent="submit">
        <label class="field" :class="{ invalid: usernameError }">
          <span class="field-label">用户名<small>{{ USERNAME_MIN }}–{{ USERNAME_MAX }} 个字</small></span>
          <input
            ref="usernameInput" v-model="username" name="username" type="text" :maxlength="USERNAME_MAX + 4" required
            autocomplete="username" autocapitalize="off" spellcheck="false" :disabled="busy" placeholder="中文、字母、数字或下划线"
            :aria-invalid="!!usernameError" :aria-describedby="usernameError ? 'username-error' : undefined" @blur="touched.username = true"
          >
          <span v-if="usernameError" id="username-error" class="field-error">{{ usernameError }}</span>
        </label>

        <label class="field" :class="{ invalid: passwordError }">
          <span class="field-label">密码<small>至少 {{ PASSWORD_MIN }} 位</small></span>
          <span class="password-wrap">
            <input
              v-model="password" name="password" :type="showPassword ? 'text' : 'password'" required
              :autocomplete="isRegister ? 'new-password' : 'current-password'" :disabled="busy"
              :aria-invalid="!!passwordError" :aria-describedby="passwordError ? 'password-error' : undefined" @blur="touched.password = true"
            >
            <button type="button" class="peek" :aria-pressed="showPassword" :aria-label="showPassword ? '隐藏密码' : '显示密码'" @click="showPassword = !showPassword">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /><path v-if="showPassword" d="M4 20 20 4" /></svg>
            </button>
          </span>
          <span v-if="passwordError" id="password-error" class="field-error">{{ passwordError }}</span>
        </label>

        <label v-if="isRegister" class="field" :class="{ invalid: confirmError }">
          <span class="field-label">再输一次密码</span>
          <input
            v-model="confirm" name="confirm" :type="showPassword ? 'text' : 'password'" required autocomplete="new-password" :disabled="busy"
            :aria-invalid="!!confirmError" :aria-describedby="confirmError ? 'confirm-error' : undefined" @blur="touched.confirm = true"
          >
          <span v-if="confirmError" id="confirm-error" class="field-error">{{ confirmError }}</span>
        </label>

        <div v-if="isRegister" class="privacy-note">
          <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="9" width="11" height="8" rx="2.5" /><path d="M7 9V7a3 3 0 0 1 6 0v2" /></svg>
          <div>
            <strong>你的照片去哪了</strong>
            <p>照片只在你点“生成”时发给图像模型服务，用来生成公仔。本站不保存你上传的照片，也不保存生成的图片；作品只存在你自己的浏览器里。</p>
            <label class="agree"><input v-model="agreed" type="checkbox" :disabled="busy"> 我已了解，同意按上面的方式处理我的照片</label>
          </div>
        </div>

        <p v-if="error" :key="error" class="error" role="alert">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="M10 6.2v4.6M10 13.6v.2" /></svg>
          <span>{{ error }}</span>
        </p>

        <button class="btn btn-primary login-submit" type="submit" :disabled="busy">
          <span v-if="busy" class="spinner" aria-hidden="true"></span>{{ copy.submit }}
        </button>
        <p v-if="!isRegister" class="login-hint">忘记密码？请联系 Tim 在后台帮你重置。</p>
      </form>

      <div class="card-stub">
        <span>不想注册？</span>
        <RouterLink class="link-more" to="/studio">先用演示模式逛逛 →</RouterLink>
      </div>
    </section>
  </div>
</template>
