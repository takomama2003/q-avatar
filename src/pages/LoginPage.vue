<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ContactCard from '../components/ContactCard.vue'
import Modal from '../components/Modal.vue'
import { PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN, checkPassword, checkUsername, login, register, safeRedirect } from '../services/auth'

// 登录和注册在同一张卡上切换。登录后回到来时的页面，默认去创作工坊。
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
const forgot = ref(false)
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
  ? { title: '创建账号', lead: '只要用户名和密码。注册后输入兑换码，就能开始生成。', submit: busy.value ? '正在注册…' : '注册并登录' }
  : { title: '欢迎回来', lead: '登录后上传照片，生成你的 Q 版公仔。', submit: busy.value ? '正在登录…' : '登录' })

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
  if (isRegister.value && !agreed.value) { error.value = '请先阅读并勾选同意《用户协议》和《隐私政策》。'; return }
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
    <aside class="login-aside reveal" style="--i: 0" aria-hidden="true">
      <div class="login-stage">
        <img :src="`${base}samples/full.png`" alt="">
      </div>
      <p class="login-aside-title">把日常的你，装进小小世界</p>
      <ol class="login-steps">
        <li><span>1</span><div><strong>注册账号</strong><small>只要用户名和密码</small></div></li>
        <li><span>2</span><div><strong>兑换张数</strong><small>加客服微信购买兑换码</small></div></li>
        <li><span>3</span><div><strong>上传照片</strong><small>选个风格，一两分钟出图</small></div></li>
      </ol>
    </aside>

    <section class="login-card ui-card reveal" style="--i: 1" aria-labelledby="login-title">
      <div class="ui-card-body">
        <div class="login-switch" role="tablist" aria-label="登录或注册" @keydown="onTabKey">
          <button id="tab-login" type="button" role="tab" :aria-selected="!isRegister" aria-controls="login-form" :tabindex="isRegister ? -1 : 0" @click="switchMode('login')">登录</button>
          <button id="tab-register" type="button" role="tab" :aria-selected="isRegister" aria-controls="login-form" :tabindex="isRegister ? 0 : -1" @click="switchMode('register')">注册</button>
          <span class="login-switch-thumb" :class="{ right: isRegister }" aria-hidden="true"></span>
        </div>

        <h1 id="login-title" :key="mode">{{ copy.title }}</h1>
        <p class="login-lead">{{ copy.lead }}</p>

        <form id="login-form" class="ui-form" role="tabpanel" :aria-labelledby="isRegister ? 'tab-register' : 'tab-login'" novalidate @submit.prevent="submit">
          <label class="ui-field" :class="{ invalid: usernameError }">
            <span class="ui-label">用户名<small v-if="isRegister">{{ USERNAME_MIN }}–{{ USERNAME_MAX }} 个字，中文、字母、数字或下划线</small></span>
            <input
              ref="usernameInput" v-model="username" class="ui-input" name="username" type="text" :maxlength="USERNAME_MAX + 4" required
              autocomplete="username" autocapitalize="off" spellcheck="false" :disabled="busy"
              :aria-invalid="!!usernameError" :aria-describedby="usernameError ? 'username-error' : undefined" @blur="touched.username = true"
            >
            <span v-if="usernameError" id="username-error" class="ui-field-error">{{ usernameError }}</span>
          </label>

          <label class="ui-field" :class="{ invalid: passwordError }">
            <span class="ui-label">密码<small v-if="isRegister">至少 {{ PASSWORD_MIN }} 位</small></span>
            <span class="ui-password">
              <input
                v-model="password" class="ui-input" name="password" :type="showPassword ? 'text' : 'password'" required
                :autocomplete="isRegister ? 'new-password' : 'current-password'" :disabled="busy"
                :aria-invalid="!!passwordError" :aria-describedby="passwordError ? 'password-error' : undefined" @blur="touched.password = true"
              >
              <button type="button" :aria-pressed="showPassword" :aria-label="showPassword ? '隐藏密码' : '显示密码'" @click="showPassword = !showPassword">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /><path v-if="showPassword" d="M4 20 20 4" /></svg>
              </button>
            </span>
            <span v-if="passwordError" id="password-error" class="ui-field-error">{{ passwordError }}</span>
          </label>

          <label v-if="isRegister" class="ui-field" :class="{ invalid: confirmError }">
            <span class="ui-label">再输一次密码</span>
            <input
              v-model="confirm" class="ui-input" name="confirm" :type="showPassword ? 'text' : 'password'" required autocomplete="new-password" :disabled="busy"
              :aria-invalid="!!confirmError" :aria-describedby="confirmError ? 'confirm-error' : undefined" @blur="touched.confirm = true"
            >
            <span v-if="confirmError" id="confirm-error" class="ui-field-error">{{ confirmError }}</span>
          </label>

          <div v-if="isRegister" class="login-privacy">
            <p><strong>照片去哪了？</strong>只在你点“生成”时发给图像模型服务。本站不保存你上传的照片和生成的图片，作品只存在你自己的浏览器里（你主动设为头像的那一张除外）。</p>
            <label class="ui-check"><input v-model="agreed" type="checkbox" :disabled="busy"><span>我已阅读并同意<RouterLink to="/terms" target="_blank">《用户协议》</RouterLink>和<RouterLink to="/privacy" target="_blank">《隐私政策》</RouterLink></span></label>
          </div>

          <p v-if="error" :key="error" class="ui-alert err" role="alert">
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="M10 6.2v4.6M10 13.6v.2" /></svg>
            <span>{{ error }}</span>
          </p>

          <button class="ui-btn ui-btn-primary ui-btn-lg ui-btn-block login-submit" type="submit" :disabled="busy">
            <span v-if="busy" class="spinner" aria-hidden="true"></span>{{ copy.submit }}
          </button>
        </form>

        <p class="login-foot">
          <template v-if="!isRegister"><button type="button" class="link-button" @click="forgot = true">忘记密码？</button></template>
          <template v-else>已有账号？<button type="button" class="link-button" @click="switchMode('login')">直接登录</button></template>
        </p>
      </div>
      <div class="login-demo">
        <span>想先看看效果？</span>
        <RouterLink to="/#samples">看看示例作品 →</RouterLink>
      </div>
    </section>

    <Modal :open="forgot" title="忘记密码" description="为了账号安全，密码只能由客服核对身份后重置。" @close="forgot = false">
      <ContactCard compact title="联系客服重置密码" lead="告诉客服你的用户名，核对后会给你一个临时密码，登录后请在“我的账户”里改成自己的。" />
      <template #foot><button type="button" class="ui-btn ui-btn-secondary" @click="forgot = false">知道了</button></template>
    </Modal>
  </div>
</template>
