<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { COMPOSITIONS, STYLES, nameOf } from '../../shared/options'
import Modal from '../components/Modal.vue'
import { PASSWORD_MIN, api, currentUser, whenUserKnown } from '../services/auth'

// 管理后台：左边分区导航（用户、兑换码、用量统计、生成记录），右边内容。只有管理员能打开；接口那边同样会检查。
type Tab = 'vouchers' | 'users' | 'stats' | 'generations'
type UserRow = { id: number; username: string; role: string; status: string; created_at: string; last_login_at: string | null; balance: number; generated: number; last_generated_at: string | null }
type VoucherRow = { id: number; note: string; credits: number; max_uses: number; used_count: number; status: string; created_at: string; redeemed_by: string | null }
type Stats = { totals: { users: number; succeeded: number; failed: number; outstanding: number }; days: { day: string; requested: number; succeeded: number; failed: number; refunded: number; runs: number; users: number }[]; top: { username: string; succeeded: number }[]; remainingToday: number }
type GenRow = { id: number; username: string; created_at: string; style: string; composition: string; requested: number; succeeded: number; failed: number; refunded: number; duration_ms: number | null; status: string; error: string }

const router = useRouter()
const route = useRoute()
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'vouchers', label: '兑换码', icon: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h11A1.5 1.5 0 0 1 17 6.5V8a2 2 0 0 0 0 4v1.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 13.5V12a2 2 0 0 0 0-4z M12 5v10' },
  { id: 'users', label: '用户', icon: 'M7.5 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M2 17c.8-3 3-4.5 5.5-4.5S12.2 14 13 17 M13.5 3.3a3 3 0 0 1 0 5.4 M15 12.8c1.4.6 2.4 2 3 4.2' },
  { id: 'stats', label: '用量统计', icon: 'M3 17h14 M5.5 14V9 M10 14V5 M14.5 14v-3' },
  { id: 'generations', label: '生成记录', icon: 'M10 4a6 6 0 1 0 6 6 M10 7v3l2 2 M13 4h3v3' },
]
const pick = (value: unknown): Tab => TABS.some(t => t.id === value) ? value as Tab : 'vouchers'
const tab = ref<Tab>(pick(route.query.tab))
function selectTab(next: Tab) { tab.value = next; void router.replace({ query: { tab: next === 'vouchers' ? undefined : next } }) }
const error = ref('')
const notice = ref('')
const users = ref<UserRow[]>([])
const query = ref('')
const vouchers = ref<VoucherRow[]>([])
const stats = ref<Stats | null>(null)
const gens = ref<GenRow[]>([])
const gensTotal = ref(0)
const gensOffset = ref(0)
const gensUser = ref<UserRow | null>(null)
const PAGE = 50
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('zh-CN', { year: '2-digit', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const isAdmin = computed(() => currentUser.value?.role === 'admin')

async function run<T>(work: () => Promise<T>) {
  error.value = ''
  try { return await work() } catch (reason) { error.value = (reason as Error).message; return undefined }
}
const loadUsers = () => run(async () => { users.value = (await api<{ users: UserRow[] }>(`admin/users?q=${encodeURIComponent(query.value.trim())}`)).users })
const loadVouchers = () => run(async () => { vouchers.value = (await api<{ vouchers: VoucherRow[] }>('admin/vouchers')).vouchers })
const loadStats = () => run(async () => { stats.value = await api<Stats>('admin/stats') })
const loadGens = () => run(async () => {
  const data = await api<{ generations: GenRow[]; total: number }>(`admin/generations?limit=${PAGE}&offset=${gensOffset.value}${gensUser.value ? `&user=${gensUser.value.id}` : ''}`)
  gens.value = data.generations; gensTotal.value = data.total
})
const loaders: Record<Tab, () => Promise<unknown>> = { users: loadUsers, vouchers: loadVouchers, stats: loadStats, generations: loadGens }
watch(tab, next => { notice.value = ''; error.value = ''; void loaders[next]() })

// —— 弹窗：新建兑换码、调额度、设密码、确认操作、只显示一次的兑换码或临时密码 ——
type Dialog =
  | { kind: 'voucher' }
  | { kind: 'credits'; user: UserRow }
  | { kind: 'password'; user: UserRow }
  | { kind: 'confirm'; title: string; text: string; action: string; danger?: boolean; go: () => Promise<void> }
  | { kind: 'secret'; title: string; value: string; hint: string }
const dialog = ref<Dialog | null>(null)
const busy = ref(false)
const formError = ref('')
const voucherForm = ref({ credits: 20, maxUses: 1, note: '' })
const creditForm = ref({ delta: 10, note: '' })
const passwordForm = ref({ password: '', confirm: '' })
const copied = ref(false)
function open(next: Dialog) {
  formError.value = ''; copied.value = false; menuFor.value = 0
  if (next.kind === 'credits') creditForm.value = { delta: 10, note: '' }
  if (next.kind === 'password') passwordForm.value = { password: '', confirm: '' }
  dialog.value = next
}
const close = () => { if (!busy.value) dialog.value = null }
async function submit(work: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; formError.value = ''
  try { await work() } catch (reason) { formError.value = (reason as Error).message } finally { busy.value = false }
}
const dialogTitle = computed(() => {
  const d = dialog.value
  if (!d) return ''
  if (d.kind === 'voucher') return '新建兑换码'
  if (d.kind === 'credits') return `调整 ${d.user.username} 的张数`
  if (d.kind === 'password') return d.user.username === currentUser.value?.username ? '修改我的密码' : `给 ${d.user.username} 设新密码`
  return d.title
})

const createVoucher = () => submit(async () => {
  const form = voucherForm.value
  const result = await api<{ id: number; code: string }>('admin/vouchers', { credits: Number(form.credits), maxUses: Number(form.maxUses), note: form.note })
  await loadVouchers()
  open({ kind: 'secret', title: `兑换码 #${result.id} 已生成`, value: result.code, hint: `${form.credits} 张${form.maxUses > 1 ? ` × ${form.maxUses} 次` : ''}${form.note ? ` · ${form.note}` : ''}。只显示这一次，请现在复制发给客户。` })
  voucherForm.value.note = ''
})
const adjustCredits = () => submit(async () => {
  const d = dialog.value
  if (d?.kind !== 'credits') return
  const delta = Number(creditForm.value.delta)
  const result = await api<{ balance: number }>('admin/users/credits', { userId: d.user.id, delta, note: creditForm.value.note })
  notice.value = `${d.user.username} ${delta > 0 ? `加了 ${delta}` : `扣了 ${-delta}`} 张，现在有 ${result.balance} 张。`
  dialog.value = null
  await loadUsers()
})
const savePassword = () => submit(async () => {
  const d = dialog.value
  if (d?.kind !== 'password') return
  if (passwordForm.value.password !== passwordForm.value.confirm) throw new Error('两次输入的密码不一样。')
  await api('admin/users/set-password', { userId: d.user.id, password: passwordForm.value.password })
  const self = d.user.username === currentUser.value?.username
  notice.value = self ? '你的密码已修改，其他设备已下线。' : `已修改 ${d.user.username} 的密码，请把新密码告诉对方。`
  dialog.value = null
})
const confirmGo = () => submit(async () => { if (dialog.value?.kind === 'confirm') await dialog.value.go() })

function askToggle(user: UserRow) {
  const disable = user.status === 'active'
  open({
    kind: 'confirm', title: disable ? `停用 ${user.username}？` : `恢复 ${user.username}？`, danger: disable, action: disable ? '停用' : '恢复',
    text: disable ? '停用后这个账号马上下线，不能登录和生成，剩余张数保留。' : '恢复后可以正常登录和生成。',
    go: async () => {
      await api('admin/users/status', { userId: user.id, status: disable ? 'disabled' : 'active' })
      notice.value = `${user.username} 已${disable ? '停用' : '恢复'}。`
      dialog.value = null
      await loadUsers()
    },
  })
}
function askReset(user: UserRow) {
  open({
    kind: 'confirm', title: `重置 ${user.username} 的密码？`, action: '生成临时密码',
    text: '会生成一个随机的临时密码，对方所有设备会下线，要用临时密码重新登录。',
    go: async () => {
      const result = await api<{ password: string }>('admin/users/reset-password', { userId: user.id })
      open({ kind: 'secret', title: `${user.username} 的临时密码`, value: result.password, hint: '只显示这一次。请发给对方，并提醒登录后在“我的账户”里改密码。' })
    },
  })
}
function askVoucher(row: VoucherRow) {
  const disable = row.status === 'active'
  open({
    kind: 'confirm', title: disable ? `停用兑换码 #${row.id}？` : `恢复兑换码 #${row.id}？`, danger: disable, action: disable ? '停用' : '恢复',
    text: disable ? '停用后这个码不能再兑换，已经兑换的张数不受影响。' : '恢复后这个码可以继续兑换（次数没用完的话）。',
    go: async () => {
      await api(disable ? 'admin/vouchers/disable' : 'admin/vouchers/enable', { voucherId: row.id })
      dialog.value = null
      await loadVouchers()
    },
  })
}
async function copySecret() {
  if (dialog.value?.kind !== 'secret') return
  try { await navigator.clipboard.writeText(dialog.value.value); copied.value = true } catch { formError.value = '复制失败，请手动选中复制。' }
}
function showGens(user: UserRow) {
  menuFor.value = 0
  gensUser.value = user; gensOffset.value = 0
  if (tab.value === 'generations') void loadGens()
  else selectTab('generations')
}
function page(step: number) {
  gensOffset.value = Math.max(0, gensOffset.value + step * PAGE)
  void loadGens()
}
const voucherState = (v: VoucherRow) => v.status !== 'active' ? { text: '已停用', tone: '' } : v.used_count >= v.max_uses ? { text: '已用完', tone: '' } : { text: '可用', tone: 'ok' }

// 用户行的“更多”菜单
const menuFor = ref(0)
async function toggleRowMenu(user: UserRow, event: MouseEvent) {
  menuFor.value = menuFor.value === user.id ? 0 : user.id
  if (menuFor.value) {
    await nextTick()
    ;(event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>('.ui-menu button')?.focus()
  }
}
function onRowMenuKey(event: KeyboardEvent) {
  const wrap = event.currentTarget as HTMLElement
  const items = [...wrap.querySelectorAll<HTMLElement>('.ui-menu button')]
  const i = items.indexOf(document.activeElement as HTMLElement)
  if (event.key === 'Escape') { event.preventDefault(); menuFor.value = 0; wrap.querySelector<HTMLElement>('.row-more')?.focus() }
  else if (event.key === 'ArrowDown') { event.preventDefault(); items[(i + 1) % items.length]?.focus() }
  else if (event.key === 'ArrowUp') { event.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus() }
  else if (event.key === 'Tab') menuFor.value = 0
}
const closeRowMenu = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest('.row-menu')) menuFor.value = 0 }

const checked = ref(false)
onMounted(async () => {
  document.addEventListener('click', closeRowMenu)
  // 直接打开或刷新这一页时，登录状态可能还在查，等查完再决定
  await whenUserKnown()
  checked.value = true
  if (!currentUser.value) return void router.replace({ name: 'login', query: { redirect: '/admin' } })
  if (!isAdmin.value) return
  await loaders[tab.value]()
})
onBeforeUnmount(() => document.removeEventListener('click', closeRowMenu))
</script>

<template>
  <div class="container ui-page admin">
    <p v-if="!checked || !currentUser" class="ui-empty">正在确认登录状态…</p>
    <div v-else-if="!isAdmin" class="ui-card gallery-empty">
      <strong>这里只有管理员能进</strong>
      <p>你的账号是普通用户。</p>
      <RouterLink class="ui-btn ui-btn-primary" to="/studio">去创作工坊</RouterLink>
    </div>
    <div v-else class="admin-layout">
      <nav class="admin-nav" aria-label="后台分区">
        <p class="admin-nav-title">管理后台</p>
        <button v-for="t in TABS" :key="t.id" type="button" :class="{ active: tab === t.id }" :aria-current="tab === t.id ? 'page' : undefined" @click="selectTab(t.id)">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path :d="t.icon" /></svg>{{ t.label }}
        </button>
      </nav>

      <div class="admin-main">
        <p v-if="notice" class="ui-alert ok" role="status">{{ notice }}</p>
        <p v-if="error" :key="error" class="ui-alert err" role="alert">{{ error }}</p>

        <!-- 兑换码 -->
        <section v-if="tab === 'vouchers'" aria-labelledby="vouchers-title">
          <div class="admin-head">
            <div><h1 id="vouchers-title">兑换码</h1><p>客户付款后在这里生成兑换码，复制发给对方。备注写上客户和订单，方便对账。</p></div>
            <button type="button" class="ui-btn ui-btn-primary" @click="open({ kind: 'voucher' })">新建兑换码</button>
          </div>
          <div class="ui-card admin-table">
            <table>
              <thead><tr><th class="num">#</th><th>客户 / 订单备注</th><th class="num">张数</th><th class="num">已兑换</th><th>兑换人</th><th>状态</th><th>创建时间</th><th class="act"><span class="visually-hidden">操作</span></th></tr></thead>
              <tbody>
                <tr v-for="v in vouchers" :key="v.id" :class="{ off: v.status !== 'active' }">
                  <td class="num">{{ v.id }}</td>
                  <td class="wrap">{{ v.note || '—' }}</td>
                  <td class="num">{{ v.credits }}</td>
                  <td class="num">{{ v.used_count }} / {{ v.max_uses }}</td>
                  <td class="wrap">{{ v.redeemed_by || '—' }}</td>
                  <td><span class="ui-tag" :class="voucherState(v).tone">{{ voucherState(v).text }}</span></td>
                  <td>{{ when(v.created_at) }}</td>
                  <td class="act"><button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" @click="askVoucher(v)">{{ v.status === 'active' ? '停用' : '恢复' }}</button></td>
                </tr>
                <tr v-if="!vouchers.length"><td colspan="8" class="empty-row">还没有兑换码。点右上角“新建兑换码”。</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 用户 -->
        <section v-else-if="tab === 'users'" aria-labelledby="users-title">
          <div class="admin-head">
            <div><h1 id="users-title">用户</h1><p>调整张数、重置密码、停用账号。每次修改都会记进操作记录。</p></div>
            <form class="admin-search" role="search" @submit.prevent="loadUsers">
              <input v-model="query" class="ui-input" type="search" placeholder="搜索用户名" aria-label="搜索用户名">
              <button class="ui-btn ui-btn-secondary" type="submit">搜索</button>
            </form>
          </div>
          <div class="ui-card admin-table">
            <table>
              <thead><tr><th>用户名</th><th>状态</th><th class="num">剩余张数</th><th class="num">已生成</th><th>注册</th><th>最近登录</th><th>最近生成</th><th class="act"><span class="visually-hidden">操作</span></th></tr></thead>
              <tbody>
                <tr v-for="u in users" :key="u.id" :class="{ off: u.status !== 'active' }">
                  <td><strong>{{ u.username }}</strong><span v-if="u.role === 'admin'" class="ui-tag warn">管理员</span></td>
                  <td><span class="ui-tag" :class="u.status === 'active' ? 'ok' : ''">{{ u.status === 'active' ? '正常' : '已停用' }}</span></td>
                  <td class="num">{{ u.balance }}</td>
                  <td class="num">{{ u.generated }}</td>
                  <td>{{ when(u.created_at) }}</td>
                  <td>{{ when(u.last_login_at) }}</td>
                  <td>{{ when(u.last_generated_at) }}</td>
                  <td class="act">
                    <div class="row-actions">
                      <button type="button" class="ui-btn ui-btn-secondary ui-btn-sm" @click="open({ kind: 'credits', user: u })">调张数</button>
                      <div class="row-menu ui-menu-wrap" @keydown="onRowMenuKey">
                        <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm row-more" :aria-expanded="menuFor === u.id" aria-haspopup="menu" :aria-label="`${u.username} 的更多操作`" @click.stop="toggleRowMenu(u, $event)">
                          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4.5" cy="10" r="1.2" /><circle cx="10" cy="10" r="1.2" /><circle cx="15.5" cy="10" r="1.2" /></svg>
                        </button>
                        <div v-if="menuFor === u.id" class="ui-menu" role="menu">
                          <button role="menuitem" type="button" @click="showGens(u)">看生成记录</button>
                          <button role="menuitem" type="button" @click="open({ kind: 'password', user: u })">设新密码</button>
                          <button role="menuitem" type="button" @click="askReset(u)">生成临时密码</button>
                          <template v-if="u.username !== currentUser.username">
                            <hr>
                            <button role="menuitem" type="button" :class="{ danger: u.status === 'active' }" @click="askToggle(u)">{{ u.status === 'active' ? '停用账号' : '恢复账号' }}</button>
                          </template>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
                <tr v-if="!users.length"><td colspan="8" class="empty-row">没有找到用户。</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 用量统计 -->
        <section v-else-if="tab === 'stats'" aria-labelledby="stats-title">
          <div class="admin-head"><div><h1 id="stats-title">用量统计</h1><p>按北京时间统计。退回是没生成出来、自动还给用户的张数。</p></div></div>
          <template v-if="stats">
            <div class="stat-tiles">
              <div class="ui-card"><span>注册用户</span><strong>{{ stats.totals.users }}</strong></div>
              <div class="ui-card"><span>累计成功张数</span><strong>{{ stats.totals.succeeded }}</strong></div>
              <div class="ui-card"><span>累计失败张数</span><strong>{{ stats.totals.failed }}</strong></div>
              <div class="ui-card"><span>用户未用的张数</span><strong>{{ stats.totals.outstanding }}</strong></div>
              <div class="ui-card"><span>全站今天还能生成</span><strong>{{ stats.remainingToday }}</strong></div>
            </div>
            <div class="stat-split">
              <div class="ui-card admin-table">
                <h2>最近 30 天</h2>
                <table>
                  <thead><tr><th>日期</th><th class="num">成功</th><th class="num">失败</th><th class="num">退回</th><th class="num">次数</th><th class="num">人数</th></tr></thead>
                  <tbody>
                    <tr v-for="d in stats.days" :key="d.day"><td>{{ d.day }}</td><td class="num">{{ d.succeeded }}</td><td class="num">{{ d.failed }}</td><td class="num">{{ d.refunded }}</td><td class="num">{{ d.runs }}</td><td class="num">{{ d.users }}</td></tr>
                    <tr v-if="!stats.days.length"><td colspan="6" class="empty-row">最近 30 天没有生成。</td></tr>
                  </tbody>
                </table>
              </div>
              <div class="ui-card admin-table">
                <h2>30 天用得最多</h2>
                <table>
                  <thead><tr><th>用户</th><th class="num">成功张数</th></tr></thead>
                  <tbody>
                    <tr v-for="t in stats.top" :key="t.username"><td>{{ t.username }}</td><td class="num">{{ t.succeeded }}</td></tr>
                    <tr v-if="!stats.top.length"><td colspan="2" class="empty-row">暂无。</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </template>
        </section>

        <!-- 生成记录 -->
        <section v-else aria-labelledby="gens-title">
          <div class="admin-head">
            <div><h1 id="gens-title">生成记录</h1><p>照片和图片都不保存，这里只记次数和结果。鼠标停在“结果”上可以看到失败原因。</p></div>
          </div>
          <div class="admin-toolbar">
            <span v-if="gensUser" class="ui-tag">只看 {{ gensUser.username }}</span>
            <button v-if="gensUser" type="button" class="ui-btn ui-btn-ghost ui-btn-sm" @click="gensUser = null; gensOffset = 0; loadGens()">看全部</button>
            <span class="ui-meta">共 {{ gensTotal }} 条</span>
            <span class="grow"></span>
            <button type="button" class="ui-btn ui-btn-secondary ui-btn-sm" :disabled="gensOffset === 0" @click="page(-1)">上一页</button>
            <button type="button" class="ui-btn ui-btn-secondary ui-btn-sm" :disabled="gensOffset + PAGE >= gensTotal" @click="page(1)">下一页</button>
          </div>
          <div class="ui-card admin-table">
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
                  <td :title="g.error || undefined"><span class="ui-tag" :class="g.status === 'done' && !g.failed ? 'ok' : g.status === 'running' ? '' : 'err'">{{ g.status === 'done' ? (g.failed ? `部分失败 ${g.failed}` : '成功') : g.status === 'running' ? '进行中' : '失败' }}</span></td>
                </tr>
                <tr v-if="!gens.length"><td colspan="8" class="empty-row">没有记录。</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>

    <Modal :open="!!dialog" :title="dialogTitle" @close="close">
      <template v-if="dialog?.kind === 'voucher'">
        <form id="voucher-form" class="ui-form" @submit.prevent="createVoucher">
          <label class="ui-field"><span class="ui-label">张数</span><input v-model.number="voucherForm.credits" class="ui-input" type="number" min="1" max="100000" required data-autofocus></label>
          <label class="ui-field"><span class="ui-label">可以兑换几次<small>一般填 1；同一个码发给多人时填人数</small></span><input v-model.number="voucherForm.maxUses" class="ui-input" type="number" min="1" max="10000" required></label>
          <label class="ui-field"><span class="ui-label">客户 / 订单备注<small>选填，最多 60 字</small></span><input v-model="voucherForm.note" class="ui-input" type="text" maxlength="60" placeholder="例如：微信 张三 11-21 50 张"></label>
        </form>
      </template>
      <template v-else-if="dialog?.kind === 'credits'">
        <form id="credits-form" class="ui-form" @submit.prevent="adjustCredits">
          <p class="ui-hint">现在有 {{ dialog.user.balance }} 张。加张数填正数，扣张数填负数。</p>
          <label class="ui-field"><span class="ui-label">调整张数</span><input v-model.number="creditForm.delta" class="ui-input" type="number" min="-100000" max="100000" required data-autofocus></label>
          <label class="ui-field"><span class="ui-label">原因<small>选填，用户看不到</small></span><input v-model="creditForm.note" class="ui-input" type="text" maxlength="120" placeholder="例如：补偿超时没出图"></label>
        </form>
      </template>
      <template v-else-if="dialog?.kind === 'password'">
        <form id="password-form" class="ui-form" @submit.prevent="savePassword">
          <p class="ui-hint">{{ dialog.user.username === currentUser?.username ? '改完后其他设备会下线，这台不受影响。' : '对方所有设备会下线，要用新密码重新登录。' }}</p>
          <input class="visually-hidden" type="text" autocomplete="username" :value="dialog.user.username" readonly tabindex="-1" aria-hidden="true">
          <label class="ui-field"><span class="ui-label">新密码<small>至少 {{ PASSWORD_MIN }} 位</small></span><input v-model="passwordForm.password" class="ui-input" type="password" autocomplete="new-password" required data-autofocus></label>
          <label class="ui-field"><span class="ui-label">再输一次</span><input v-model="passwordForm.confirm" class="ui-input" type="password" autocomplete="new-password" required></label>
        </form>
      </template>
      <template v-else-if="dialog?.kind === 'confirm'">
        <p class="modal-text">{{ dialog.text }}</p>
      </template>
      <template v-else-if="dialog?.kind === 'secret'">
        <p class="modal-text">{{ dialog.hint }}</p>
        <code class="ui-secret">{{ dialog.value }}</code>
      </template>
      <p v-if="formError" class="ui-alert err modal-error" role="alert">{{ formError }}</p>

      <template #foot>
        <template v-if="dialog?.kind === 'secret'">
          <button type="button" class="ui-btn ui-btn-secondary" @click="dialog = null">我已保存</button>
          <button type="button" class="ui-btn ui-btn-primary" data-autofocus @click="copySecret">{{ copied ? '已复制' : '复制' }}</button>
        </template>
        <template v-else>
          <button type="button" class="ui-btn ui-btn-secondary" :disabled="busy" @click="close">取消</button>
          <button v-if="dialog?.kind === 'confirm'" type="button" class="ui-btn" :class="dialog.danger ? 'ui-btn-danger' : 'ui-btn-primary'" :disabled="busy" @click="confirmGo">{{ dialog.action }}</button>
          <button v-else type="submit" class="ui-btn ui-btn-primary" :disabled="busy" :form="dialog?.kind === 'voucher' ? 'voucher-form' : dialog?.kind === 'credits' ? 'credits-form' : 'password-form'">
            {{ busy ? '正在保存…' : dialog?.kind === 'voucher' ? '生成兑换码' : '保存' }}
          </button>
        </template>
      </template>
    </Modal>
  </div>
</template>
