<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { STYLES, COMPOSITIONS, nameOf } from '../../shared/options'
import { PASSWORD_MIN, api, currentUser, logout, whenUserKnown } from '../services/auth'

// 我的账户：余额、兑换码、申请额度、改密码、最近的生成记录和额度变动。
type Request = { id: number; amount: number; reason: string; status: 'pending' | 'approved' | 'rejected' | 'cancelled'; granted: number | null; reply: string; created_at: string; decided_at: string | null }
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
const requests = ref<Request[]>([])
const pending = computed(() => requests.value.find(r => r.status === 'pending'))
const lastDecided = computed(() => requests.value.find(r => r.status === 'approved' || r.status === 'rejected'))
const ask = ref({ amount: 20, reason: '' })
const asking = ref(false)
const askMessage = ref('')
const askError = ref('')
const pw = ref({ current: '', next: '', confirm: '' })
const pwBusy = ref(false)
const pwMessage = ref('')
const pwError = ref('')
const STATUS: Record<Request['status'], string> = { pending: '等 Tim 处理', approved: '已批准', rejected: '没有批准', cancelled: '已撤回' }
const REASONS: Record<string, string> = { redeem: '兑换', generate: '生成', refund: '退回', admin: '管理员调整' }
const when = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

async function load() {
  await whenUserKnown()
  if (!currentUser.value) return void router.replace({ name: 'login', query: { redirect: '/account' } })
  try {
    const data = await api<{ balance: number; generations: Generation[]; ledger: Ledger[]; requests: Request[] }>('account/history')
    generations.value = data.generations
    ledger.value = data.ledger
    requests.value = data.requests
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

async function submitRequest() {
  if (asking.value) return
  askError.value = ''; askMessage.value = ''
  asking.value = true
  try {
    await api('account/request', { amount: Number(ask.value.amount), reason: ask.value.reason })
    askMessage.value = '申请已提交，Tim 处理后额度会直接加到你的账户里。'
    ask.value.reason = ''
    await load()
  } catch (reason) {
    askError.value = (reason as Error).message
  } finally {
    asking.value = false
  }
}
async function cancelRequest() {
  askError.value = ''; askMessage.value = ''
  try { await api('account/request/cancel', {}); await load() } catch (reason) { askError.value = (reason as Error).message }
}

async function changePassword() {
  if (pwBusy.value) return
  pwError.value = ''; pwMessage.value = ''
  if (pw.value.next !== pw.value.confirm) { pwError.value = '两次输入的新密码不一样。'; return }
  pwBusy.value = true
  try {
    await api('account/password', { currentPassword: pw.value.current, newPassword: pw.value.next })
    pwMessage.value = '密码已修改。其他设备上的登录已经退出，这台设备不受影响。'
    pw.value = { current: '', next: '', confirm: '' }
  } catch (reason) {
    pwError.value = (reason as Error).message
  } finally {
    pwBusy.value = false
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
      <p class="subtitle">查看剩余张数、输入兑换码或申请额度、修改密码，看看最近生成了什么。</p>
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

      <div class="account-side">
        <section class="panel reveal" style="--i: 2" aria-labelledby="request-title">
          <div class="panel-heading"><h2 id="request-title">申请额度</h2><span class="panel-meta">没有兑换码时用</span></div>
          <div v-if="pending" class="request-state">
            <p><strong>已申请 {{ pending.amount }} 张</strong> · {{ STATUS.pending }}<span class="muted"> · {{ when(pending.created_at) }}</span></p>
            <p v-if="pending.reason" class="muted">“{{ pending.reason }}”</p>
            <p class="muted">Tim 批准后，张数会直接加到你的账户里，不用再输兑换码。</p>
            <button type="button" class="btn btn-ghost btn-small" @click="cancelRequest">撤回申请</button>
          </div>
          <form v-else class="redeem" @submit.prevent="submitRequest">
            <p v-if="lastDecided" class="request-result" :class="lastDecided.status">
              上次申请 {{ lastDecided.amount }} 张：{{ STATUS[lastDecided.status] }}{{ lastDecided.status === 'approved' ? `，给了 ${lastDecided.granted} 张` : '' }}{{ lastDecided.reply ? `。Tim 说：“${lastDecided.reply}”` : '' }}
            </p>
            <label class="field">
              <span class="field-label">想要几张<small>1–1000</small></span>
              <input v-model.number="ask.amount" name="amount" type="number" min="1" max="1000" required :disabled="asking">
            </label>
            <label class="field">
              <span class="field-label">用途<small>选填，最多 200 字</small></span>
              <textarea v-model="ask.reason" name="reason" rows="2" maxlength="200" :disabled="asking" placeholder="比如：想给家里人都做一个"></textarea>
            </label>
            <button class="btn btn-secondary" type="submit" :disabled="asking">{{ asking ? '正在提交…' : '提交申请' }}</button>
          </form>
          <p v-if="askMessage" class="success" role="status">{{ askMessage }}</p>
          <p v-if="askError" :key="askError" class="error" role="alert"><span>{{ askError }}</span></p>
        </section>

        <section class="panel reveal" style="--i: 3" aria-labelledby="password-title">
          <div class="panel-heading"><h2 id="password-title">修改密码</h2></div>
          <form class="redeem" @submit.prevent="changePassword">
            <input class="visually-hidden" type="text" name="username" autocomplete="username" :value="currentUser.username" readonly tabindex="-1" aria-hidden="true">
            <label class="field">
              <span class="field-label">现在的密码</span>
              <input v-model="pw.current" name="current-password" type="password" autocomplete="current-password" required :disabled="pwBusy">
            </label>
            <label class="field">
              <span class="field-label">新密码<small>至少 {{ PASSWORD_MIN }} 位</small></span>
              <input v-model="pw.next" name="new-password" type="password" autocomplete="new-password" required :disabled="pwBusy">
            </label>
            <label class="field">
              <span class="field-label">再输一次新密码</span>
              <input v-model="pw.confirm" name="confirm-password" type="password" autocomplete="new-password" required :disabled="pwBusy">
            </label>
            <button class="btn btn-secondary" type="submit" :disabled="pwBusy">{{ pwBusy ? '正在修改…' : '修改密码' }}</button>
          </form>
          <p v-if="pwMessage" class="success" role="status">{{ pwMessage }}</p>
          <p v-if="pwError" :key="pwError" class="error" role="alert"><span>{{ pwError }}</span></p>
        </section>
      </div>

      <section class="panel reveal history-panel" style="--i: 4" aria-labelledby="history-title">
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
