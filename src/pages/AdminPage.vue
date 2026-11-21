<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { COMPOSITIONS, STYLES, nameOf } from '../../shared/options'
import { api, currentUser, whenUserKnown } from '../services/auth'

// 管理后台：用户、兑换码、用量统计、生成记录。只有管理员能打开；接口那边同样会检查。
type Tab = 'requests' | 'users' | 'vouchers' | 'stats' | 'generations'
type RequestRow = { id: number; user_id: number; username: string; amount: number; reason: string; status: string; granted: number | null; reply: string; created_at: string; decided_at: string | null; balance: number }
type UserRow = { id: number; username: string; role: string; status: string; created_at: string; last_login_at: string | null; balance: number; generated: number; last_generated_at: string | null }
type VoucherRow = { id: number; note: string; credits: number; max_uses: number; used_count: number; status: string; created_at: string; redeemed_by: string | null }
type Stats = { totals: { users: number; succeeded: number; failed: number; outstanding: number }; days: { day: string; requested: number; succeeded: number; failed: number; refunded: number; runs: number; users: number }[]; top: { username: string; succeeded: number }[]; remainingToday: number }
type GenRow = { id: number; username: string; created_at: string; style: string; composition: string; requested: number; succeeded: number; failed: number; refunded: number; duration_ms: number | null; status: string; error: string }

const router = useRouter()
const tab = ref<Tab>('requests')
const error = ref('')
const notice = ref('')
// 新建的兑换码或临时密码：只显示这一次
const secret = ref<{ title: string; value: string } | null>(null)
const users = ref<UserRow[]>([])
const requests = ref<RequestRow[]>([])
const showAllRequests = ref(false)
const pendingCount = ref(0)
const query = ref('')
const vouchers = ref<VoucherRow[]>([])
const stats = ref<Stats | null>(null)
const gens = ref<GenRow[]>([])
const gensTotal = ref(0)
const gensOffset = ref(0)
const gensUser = ref(0)
const newVoucher = ref({ credits: 20, maxUses: 1, note: '' })
const PAGE = 50
const tabs: { id: Tab; label: string }[] = [
  { id: 'requests', label: '额度申请' }, { id: 'users', label: '用户' }, { id: 'vouchers', label: '兑换码' }, { id: 'stats', label: '用量统计' }, { id: 'generations', label: '生成记录' },
]
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('zh-CN', { year: '2-digit', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const isAdmin = computed(() => currentUser.value?.role === 'admin')

async function run<T>(work: () => Promise<T>) {
  error.value = ''
  try { return await work() } catch (reason) { error.value = (reason as Error).message; return undefined }
}
const loadRequests = () => run(async () => {
  requests.value = (await api<{ requests: RequestRow[] }>(`admin/requests${showAllRequests.value ? '?status=all' : ''}`)).requests
  pendingCount.value = requests.value.filter(r => r.status === 'pending').length
})
const loadUsers = () => run(async () => { users.value = (await api<{ users: UserRow[] }>(`admin/users?q=${encodeURIComponent(query.value.trim())}`)).users })
const loadVouchers = () => run(async () => { vouchers.value = (await api<{ vouchers: VoucherRow[] }>('admin/vouchers')).vouchers })
const loadStats = () => run(async () => { stats.value = await api<Stats>('admin/stats') })
const loadGens = () => run(async () => {
  const data = await api<{ generations: GenRow[]; total: number }>(`admin/generations?limit=${PAGE}&offset=${gensOffset.value}${gensUser.value ? `&user=${gensUser.value}` : ''}`)
  gens.value = data.generations; gensTotal.value = data.total
})
const loaders: Record<Tab, () => Promise<unknown>> = { requests: loadRequests, users: loadUsers, vouchers: loadVouchers, stats: loadStats, generations: loadGens }
watch(tab, next => { notice.value = ''; void loaders[next]() })

const REQUEST_STATUS: Record<string, string> = { pending: '待处理', approved: '已批准', rejected: '已拒绝', cancelled: '用户撤回' }
async function decide(row: RequestRow, approve: boolean) {
  let granted: number | undefined
  if (approve) {
    const raw = window.prompt(`给 ${row.username} 批准多少张？他申请了 ${row.amount} 张，现在有 ${row.balance} 张。`, String(row.amount))
    if (raw === null) return
    granted = Number(raw)
  }
  const reply = window.prompt(approve ? '给他留句话（选填，他在账户页能看到）' : '拒绝的原因（选填，他在账户页能看到）', '')
  if (reply === null) return
  const result = await run(() => api<{ granted: number; balance: number }>(approve ? 'admin/requests/approve' : 'admin/requests/reject', { requestId: row.id, granted, reply }))
  if (result) {
    notice.value = approve ? `已批准 ${row.username} ${result.granted} 张，他现在有 ${result.balance} 张。` : `已拒绝 ${row.username} 的申请。`
    await loadRequests()
  }
}

async function setPassword(user: UserRow) {
  const self = user.username === currentUser.value?.username
  const password = window.prompt(self ? '输入你的新密码（至少 8 位）。改完其他设备会下线，这台不受影响。' : `给 ${user.username} 设一个新密码（至少 8 位）。他所有设备会下线，要用新密码重新登录。`, '')
  if (!password) return
  if (password !== window.prompt('再输一次新密码', '')) { error.value = '两次输入的密码不一样，没有修改。'; return }
  if (await run(() => api('admin/users/set-password', { userId: user.id, password })) !== undefined) {
    notice.value = self ? '你的密码已修改。' : `已修改 ${user.username} 的密码，请把新密码告诉他。`
  }
}

async function adjust(user: UserRow) {
  const raw = window.prompt(`给 ${user.username} 加多少张？扣减就填负数。当前余额 ${user.balance}。`, '10')
  if (raw === null) return
  const delta = Number(raw)
  const note = window.prompt('备注（选填）', '') ?? ''
  const result = await run(() => api<{ balance: number }>('admin/users/credits', { userId: user.id, delta, note }))
  if (result) { notice.value = `${user.username} 现在有 ${result.balance} 张。`; await loadUsers() }
}
async function toggle(user: UserRow) {
  const disable = user.status === 'active'
  if (disable && !window.confirm(`停用 ${user.username}？停用后这个账号马上下线，不能登录和生成。`)) return
  if (await run(() => api('admin/users/status', { userId: user.id, status: disable ? 'disabled' : 'active' })) !== undefined) {
    notice.value = `${user.username} 已${disable ? '停用' : '恢复'}。`
    await loadUsers()
  }
}
async function resetPassword(user: UserRow) {
  if (!window.confirm(`重置 ${user.username} 的密码？他所有设备会下线，要用新的临时密码重新登录。`)) return
  const result = await run(() => api<{ password: string }>('admin/users/reset-password', { userId: user.id }))
  if (result) secret.value = { title: `${user.username} 的临时密码`, value: result.password }
}
function showGens(user: UserRow) {
  gensUser.value = user.id; gensOffset.value = 0
  if (tab.value === 'generations') void loadGens()
  else tab.value = 'generations'
}
async function createVoucher() {
  const result = await run(() => api<{ id: number; code: string }>('admin/vouchers', { ...newVoucher.value, credits: Number(newVoucher.value.credits), maxUses: Number(newVoucher.value.maxUses) }))
  if (result) {
    secret.value = { title: `兑换码 #${result.id}（${newVoucher.value.credits} 张 × ${newVoucher.value.maxUses} 次）`, value: result.code }
    newVoucher.value.note = ''
    await loadVouchers()
  }
}
async function toggleVoucher(row: VoucherRow) {
  const path = row.status === 'active' ? 'admin/vouchers/disable' : 'admin/vouchers/enable'
  if (await run(() => api(path, { voucherId: row.id })) !== undefined) await loadVouchers()
}
async function copySecret() {
  if (!secret.value) return
  try { await navigator.clipboard.writeText(secret.value.value); notice.value = '已复制。' } catch { notice.value = '复制失败，请手动选中复制。' }
}
function page(step: number) {
  gensOffset.value = Math.max(0, gensOffset.value + step * PAGE)
  void loadGens()
}

const checked = ref(false)
onMounted(async () => {
  // 直接打开或刷新这一页时，登录状态可能还在查，等查完再决定
  await whenUserKnown()
  checked.value = true
  if (!currentUser.value) return void router.replace({ name: 'login', query: { redirect: '/admin' } })
  if (!isAdmin.value) return
  await loadRequests()
})
</script>

<template>
  <div class="container admin">
    <header class="page-head reveal" style="--i: 0">
      <p class="eyebrow">BACK OFFICE</p>
      <h1>管理<mark class="hl">后台</mark></h1>
      <p class="subtitle">账号、额度、兑换码和用量。每次修改都会记进操作记录。</p>
    </header>

    <p v-if="!checked || !currentUser" class="muted">正在确认登录状态…</p>
    <div v-else-if="!isAdmin" class="empty">
      <strong>这里只有管理员能进</strong>
      <p>你的账号是普通用户。</p>
      <RouterLink class="btn btn-primary" to="/studio">去创作工坊</RouterLink>
    </div>
    <template v-else>
      <div class="admin-tabs" role="tablist" aria-label="后台分区">
        <button v-for="t in tabs" :key="t.id" type="button" role="tab" :aria-selected="tab === t.id" @click="tab = t.id">{{ t.label }}<span v-if="t.id === 'requests' && pendingCount" class="tab-badge">{{ pendingCount }}</span></button>
      </div>

      <div v-if="secret" class="secret" role="alert">
        <div><strong>{{ secret.title }}</strong><p>只显示这一次，关掉后就看不到了。请现在复制发给对方。</p></div>
        <code>{{ secret.value }}</code>
        <button type="button" class="btn btn-primary btn-small" @click="copySecret">复制</button>
        <button type="button" class="btn btn-ghost btn-small" @click="secret = null">我已保存</button>
      </div>
      <p v-if="notice" class="success" role="status">{{ notice }}</p>
      <p v-if="error" :key="error" class="error" role="alert"><span>{{ error }}</span></p>

      <section v-if="tab === 'requests'" class="panel">
        <div class="admin-toolbar">
          <span>{{ showAllRequests ? '全部申请（最近 200 条）' : `待处理 ${pendingCount} 个` }}</span>
          <span class="grow"></span>
          <label><input v-model="showAllRequests" type="checkbox" @change="loadRequests"> 显示已处理的</label>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>时间</th><th>用户</th><th class="num">申请张数</th><th class="num">现有</th><th>用途</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="r in requests" :key="r.id" :class="{ off: r.status !== 'pending' }">
                <td>{{ when(r.created_at) }}</td>
                <td>{{ r.username }}</td>
                <td class="num">{{ r.amount }}</td>
                <td class="num">{{ r.balance }}</td>
                <td class="wrap">{{ r.reason || '—' }}</td>
                <td>{{ REQUEST_STATUS[r.status] ?? r.status }}{{ r.status === 'approved' ? ` ${r.granted} 张` : '' }}<span v-if="r.reply" class="muted"> · {{ r.reply }}</span></td>
                <td class="actions">
                  <template v-if="r.status === 'pending'">
                    <button type="button" class="primary" @click="decide(r, true)">批准</button>
                    <button type="button" class="danger" @click="decide(r, false)">拒绝</button>
                  </template>
                </td>
              </tr>
              <tr v-if="!requests.length"><td colspan="7" class="muted">{{ showAllRequests ? '还没有人申请过。' : '没有待处理的申请。' }}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-else-if="tab === 'users'" class="panel">
        <form class="admin-toolbar" @submit.prevent="loadUsers">
          <input v-model="query" class="access-input" type="search" placeholder="搜索用户名">
          <button class="btn btn-secondary btn-small" type="submit">搜索</button>
        </form>
        <div class="table-wrap">
          <table>
            <thead><tr><th>用户名</th><th>状态</th><th class="num">余额</th><th class="num">已生成</th><th>注册</th><th>最近登录</th><th>最近生成</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="u in users" :key="u.id" :class="{ off: u.status !== 'active' }">
                <td>{{ u.username }}<span v-if="u.role === 'admin'" class="tag">管理员</span></td>
                <td>{{ u.status === 'active' ? '正常' : '已停用' }}</td>
                <td class="num">{{ u.balance }}</td>
                <td class="num">{{ u.generated }}</td>
                <td>{{ when(u.created_at) }}</td>
                <td>{{ when(u.last_login_at) }}</td>
                <td>{{ when(u.last_generated_at) }}</td>
                <td class="actions">
                  <button type="button" @click="adjust(u)">调额度</button>
                  <button type="button" @click="showGens(u)">记录</button>
                  <button type="button" @click="setPassword(u)">设密码</button>
                  <button type="button" @click="resetPassword(u)">随机重置</button>
                  <button v-if="u.username !== currentUser.username" type="button" :class="{ danger: u.status === 'active' }" @click="toggle(u)">{{ u.status === 'active' ? '停用' : '恢复' }}</button>
                </td>
              </tr>
              <tr v-if="!users.length"><td colspan="8" class="muted">没有找到用户。</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-else-if="tab === 'vouchers'" class="panel">
        <form class="admin-toolbar" @submit.prevent="createVoucher">
          <label>张数 <input v-model.number="newVoucher.credits" class="access-input short" type="number" min="1" max="100000" required></label>
          <label>可兑换次数 <input v-model.number="newVoucher.maxUses" class="access-input short" type="number" min="1" max="10000" required></label>
          <label class="grow">备注 <input v-model="newVoucher.note" class="access-input" type="text" maxlength="60" placeholder="例如：给小王"></label>
          <button class="btn btn-primary btn-small" type="submit">生成兑换码</button>
        </form>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>备注</th><th class="num">每次张数</th><th class="num">已兑换 / 上限</th><th>兑换人</th><th>状态</th><th>创建</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="v in vouchers" :key="v.id" :class="{ off: v.status !== 'active' }">
                <td>{{ v.id }}</td>
                <td>{{ v.note || '—' }}</td>
                <td class="num">{{ v.credits }}</td>
                <td class="num">{{ v.used_count }} / {{ v.max_uses }}</td>
                <td>{{ v.redeemed_by || '—' }}</td>
                <td>{{ v.status === 'active' ? (v.used_count >= v.max_uses ? '已用完' : '可用') : '已停用' }}</td>
                <td>{{ when(v.created_at) }}</td>
                <td class="actions"><button type="button" :class="{ danger: v.status === 'active' }" @click="toggleVoucher(v)">{{ v.status === 'active' ? '停用' : '恢复' }}</button></td>
              </tr>
              <tr v-if="!vouchers.length"><td colspan="8" class="muted">还没有兑换码。</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-else-if="tab === 'stats'" class="panel">
        <template v-if="stats">
          <div class="stat-tiles">
            <div><span>注册用户</span><strong>{{ stats.totals.users }}</strong></div>
            <div><span>累计成功</span><strong>{{ stats.totals.succeeded }}</strong></div>
            <div><span>累计失败</span><strong>{{ stats.totals.failed }}</strong></div>
            <div><span>用户手里未用的张数</span><strong>{{ stats.totals.outstanding }}</strong></div>
            <div><span>全站今天还剩</span><strong>{{ stats.remainingToday }}</strong></div>
          </div>
          <div class="stat-split">
            <div class="table-wrap">
              <h2>最近 30 天（北京时间）</h2>
              <table>
                <thead><tr><th>日期</th><th class="num">成功</th><th class="num">失败</th><th class="num">退回</th><th class="num">次数</th><th class="num">人数</th></tr></thead>
                <tbody>
                  <tr v-for="d in stats.days" :key="d.day"><td>{{ d.day }}</td><td class="num">{{ d.succeeded }}</td><td class="num">{{ d.failed }}</td><td class="num">{{ d.refunded }}</td><td class="num">{{ d.runs }}</td><td class="num">{{ d.users }}</td></tr>
                  <tr v-if="!stats.days.length"><td colspan="6" class="muted">最近 30 天没有生成。</td></tr>
                </tbody>
              </table>
            </div>
            <div class="table-wrap">
              <h2>30 天用得最多</h2>
              <table>
                <thead><tr><th>用户</th><th class="num">成功张数</th></tr></thead>
                <tbody>
                  <tr v-for="t in stats.top" :key="t.username"><td>{{ t.username }}</td><td class="num">{{ t.succeeded }}</td></tr>
                  <tr v-if="!stats.top.length"><td colspan="2" class="muted">暂无。</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </section>

      <section v-else class="panel">
        <div class="admin-toolbar">
          <span>{{ gensUser ? `只看用户 #${gensUser}` : '全部用户' }} · 共 {{ gensTotal }} 条</span>
          <button v-if="gensUser" type="button" class="btn btn-ghost btn-small" @click="gensUser = 0; gensOffset = 0; loadGens()">看全部</button>
          <span class="grow"></span>
          <button type="button" class="btn btn-secondary btn-small" :disabled="gensOffset === 0" @click="page(-1)">上一页</button>
          <button type="button" class="btn btn-secondary btn-small" :disabled="gensOffset + PAGE >= gensTotal" @click="page(1)">下一页</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>时间</th><th>用户</th><th>风格 · 构图</th><th class="num">请求</th><th class="num">成功</th><th class="num">退回</th><th class="num">耗时</th><th>结果</th></tr></thead>
            <tbody>
              <tr v-for="g in gens" :key="g.id">
                <td>{{ when(g.created_at) }}</td>
                <td>{{ g.username }}</td>
                <td>{{ nameOf(STYLES, g.style as never) }} · {{ nameOf(COMPOSITIONS, g.composition as never) }}</td>
                <td class="num">{{ g.requested }}</td>
                <td class="num">{{ g.succeeded }}</td>
                <td class="num">{{ g.refunded }}</td>
                <td class="num">{{ g.duration_ms ? `${Math.round(g.duration_ms / 1000)}s` : '—' }}</td>
                <td :title="g.error">{{ g.status === 'done' ? (g.failed ? `部分失败 ${g.failed}` : '成功') : g.status === 'running' ? '进行中' : '失败' }}</td>
              </tr>
              <tr v-if="!gens.length"><td colspan="8" class="muted">没有记录。照片和图片都不保存，这里只记次数和结果。</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
