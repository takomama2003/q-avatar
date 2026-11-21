<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { STYLES, COMPOSITIONS, nameOf } from '../../shared/options'
import { api, currentUser, logout, whenUserKnown } from '../services/auth'

// 我的账户：余额、兑换码、最近的生成记录和额度变动。
type Generation = { created_at: string; style: string; composition: string; requested: number; succeeded: number; failed: number; refunded: number; status: string }
type Ledger = { delta: number; reason: string; note: string; created_at: string }
const router = useRouter()
const code = ref('')
const busy = ref(false)
const message = ref('')
const error = ref('')
const loading = ref(true)
const generations = ref<Generation[]>([])
const ledger = ref<Ledger[]>([])
const REASONS: Record<string, string> = { redeem: '兑换', generate: '生成', refund: '退回', admin: '管理员调整' }
const when = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

async function load() {
  await whenUserKnown()
  if (!currentUser.value) return void router.replace({ name: 'login', query: { redirect: '/account' } })
  try {
    const data = await api<{ balance: number; generations: Generation[]; ledger: Ledger[] }>('account/history')
    generations.value = data.generations
    ledger.value = data.ledger
    if (currentUser.value) currentUser.value = { ...currentUser.value, credits: data.balance }
  } catch (reason) {
    if (!currentUser.value) return void router.replace({ name: 'login', query: { redirect: '/account' } })
    error.value = (reason as Error).message
  } finally {
    loading.value = false
  }
}

async function redeem() {
  if (busy.value) return
  error.value = ''; message.value = ''
  if (!code.value.trim()) { error.value = '请输入兑换码。'; return }
  busy.value = true
  try {
    const result = await api<{ credits: number; balance: number }>('account/redeem', { code: code.value })
    message.value = `兑换成功，领到 ${result.credits} 张，现在共有 ${result.balance} 张。`
    code.value = ''
    await load()
  } catch (reason) {
    error.value = (reason as Error).message
  } finally {
    busy.value = false
  }
}

async function signOut() {
  await logout()
  await router.replace('/')
}
onMounted(load)
</script>

<template>
  <div class="container">
    <header class="page-head reveal" style="--i: 0">
      <p class="eyebrow">MY ACCOUNT</p>
      <h1>我的<mark class="hl">账户</mark></h1>
      <p class="subtitle">查看剩余张数、输入兑换码，看看最近生成了什么。</p>
    </header>

    <div v-if="currentUser" class="account-grid">
      <section class="panel account-card reveal" style="--i: 1" aria-labelledby="balance-title">
        <div class="card-band"><span>MEMBER CARD</span><span>{{ currentUser.role === 'admin' ? 'ADMIN' : 'MEMBER' }}</span></div>
        <div class="balance">
          <span class="account-avatar big" aria-hidden="true">{{ Array.from(currentUser.username)[0] }}</span>
          <div>
            <h2 id="balance-title">{{ currentUser.username }}</h2>
            <p>剩余 <strong>{{ currentUser.credits }}</strong> 张</p>
          </div>
        </div>
        <form class="redeem" @submit.prevent="redeem">
          <label class="field">
            <span class="field-label">兑换码<small>Tim 发给你的码，例如 abcd-efgh-jkmn</small></span>
            <input v-model="code" name="code" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" :disabled="busy" placeholder="输入兑换码">
          </label>
          <button class="btn btn-primary" type="submit" :disabled="busy">{{ busy ? '正在兑换…' : '兑换' }}</button>
        </form>
        <p v-if="message" class="success" role="status">{{ message }}</p>
        <p v-if="error" :key="error" class="error" role="alert"><span>{{ error }}</span></p>
        <div class="card-stub">
          <RouterLink class="link-more" to="/studio">去创作工坊 →</RouterLink>
          <RouterLink v-if="currentUser.role === 'admin'" class="link-more" to="/admin">管理后台 →</RouterLink>
          <button type="button" class="btn btn-ghost btn-small" @click="signOut">退出登录</button>
        </div>
      </section>

      <section class="panel reveal" style="--i: 2" aria-labelledby="history-title">
        <div class="panel-heading"><h2 id="history-title">最近的生成</h2><span class="panel-meta">最多 20 条</span></div>
        <p v-if="loading" class="muted">正在加载…</p>
        <p v-else-if="!generations.length" class="muted">还没有生成过。照片和生成的图片都不保存在服务器上，这里只记次数。</p>
        <ul v-else class="history">
          <li v-for="(g, i) in generations" :key="i">
            <span class="history-when">{{ when(g.created_at) }}</span>
            <span>{{ nameOf(STYLES, g.style as never) }} · {{ nameOf(COMPOSITIONS, g.composition as never) }}</span>
            <span class="history-result" :class="g.succeeded ? 'ok' : 'bad'">{{ g.succeeded ? `成功 ${g.succeeded} 张` : '失败' }}{{ g.refunded ? `，退回 ${g.refunded}` : '' }}</span>
          </li>
        </ul>
        <div class="panel-heading ledger-head"><h2>额度变动</h2></div>
        <ul class="history">
          <li v-for="(row, i) in ledger" :key="i">
            <span class="history-when">{{ when(row.created_at) }}</span>
            <span>{{ REASONS[row.reason] ?? row.reason }}{{ row.note ? ` · ${row.note}` : '' }}</span>
            <span class="history-result" :class="row.delta > 0 ? 'ok' : ''">{{ row.delta > 0 ? `+${row.delta}` : row.delta }}</span>
          </li>
        </ul>
      </section>
    </div>
    <p v-else class="muted">正在确认登录状态…</p>
  </div>
</template>
