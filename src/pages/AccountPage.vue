<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AVATARS, type AvatarId } from '../../shared/avatars'
import { STYLES, COMPOSITIONS, nameOf } from '../../shared/options'
import AvatarCropper from '../components/AvatarCropper.vue'
import ChibiAvatar from '../components/ChibiAvatar.vue'
import ContactCard from '../components/ContactCard.vue'
import Modal from '../components/Modal.vue'
import { AVATAR_LOOKS } from '../content/avatars'
import { PASSWORD_MIN, api, currentUser, logout, whenUserKnown } from '../services/auth'
import { ensureLoaded, useHistory } from '../stores/history'

// 我的账户：头像、剩余张数、兑换码、购买方式、额度变动、生成记录、改密码。
type Generation = { created_at: string; style: string; composition: string; requested: number; succeeded: number; failed: number; refunded: number; status: string }
type Ledger = { delta: number; reason: string; note: string; created_at: string }
const router = useRouter()
const route = useRoute()
// 三个分区：额度（购买、变动）、生成记录、账号安全。地址栏 ?tab= 记住当前分区，顶栏菜单可以直接跳过来。
type Tab = 'credits' | 'history' | 'security'
const TABS: { id: Tab; label: string }[] = [{ id: 'credits', label: '额度' }, { id: 'history', label: '生成记录' }, { id: 'security', label: '账号安全' }]
const pickTab = (value: unknown): Tab => TABS.some(t => t.id === value) ? value as Tab : 'credits'
const tab = ref<Tab>(pickTab(route.query.tab))
watch(() => route.query.tab, value => { tab.value = pickTab(value) })
function selectTab(next: Tab) {
  tab.value = next
  void router.replace({ query: { ...route.query, tab: next === 'credits' ? undefined : next } })
}
function onTabKey(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const i = TABS.findIndex(t => t.id === tab.value)
  const next = TABS[(i + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id
  selectTab(next)
  void nextTick(() => document.getElementById(`account-tab-${next}`)?.focus())
}
const code = ref('')
const busy = ref(false)
const message = ref('')
const error = ref('')
const loading = ref(true)
const generations = ref<Generation[]>([])
const ledger = ref<Ledger[]>([])
// 换头像：内置头像点一下就保存；上传图片或选一张作品，先在裁剪框里调好位置再上传
type AvatarSource = 'builtin' | 'upload' | 'works'
const SOURCES: { id: AvatarSource; label: string }[] = [{ id: 'builtin', label: '内置头像' }, { id: 'upload', label: '上传图片' }, { id: 'works', label: '我的作品' }]
const picking = ref(false)
const avatarTab = ref<AvatarSource>('builtin')
const avatarBusy = ref(false)
const avatarError = ref('')
const cropSource = ref<Blob | null>(null)
const avatarFile = ref<HTMLInputElement>()
const { works } = useHistory()
watch(picking, open => {
  if (!open) return
  avatarError.value = ''; cropSource.value = null
  avatarTab.value = currentUser.value?.avatar.startsWith('upload:') ? 'upload' : 'builtin'
  void ensureLoaded()
})
const pw = ref({ current: '', next: '', confirm: '' })
const pwBusy = ref(false)
const pwMessage = ref('')
const pwError = ref('')
const REASONS: Record<string, string> = { redeem: '兑换码', generate: '生成', refund: '自动退回', admin: '客服调整' }
const totalMade = computed(() => generations.value.reduce((sum, g) => sum + g.succeeded, 0))
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

async function chooseAvatar(next: AvatarId) {
  if (avatarBusy.value || !currentUser.value) return
  avatarError.value = ''
  if (next === currentUser.value.avatar) { picking.value = false; return }
  avatarBusy.value = true
  try {
    const result = await api<{ avatar: string }>('account/avatar', { avatar: next })
    if (currentUser.value) currentUser.value = { ...currentUser.value, avatar: result.avatar }
    picking.value = false
  } catch (reason) {
    avatarError.value = (reason as Error).message
  } finally {
    avatarBusy.value = false
  }
}
function closePicker() {
  if (avatarBusy.value) return
  // 裁剪时按 Esc 或关闭：先回到选择来源，再按一次才关掉弹窗
  if (cropSource.value) { cropSource.value = null; return }
  picking.value = false
}
function onSourceKey(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const i = SOURCES.findIndex(s => s.id === avatarTab.value)
  const next = SOURCES[(i + (event.key === 'ArrowRight' ? 1 : SOURCES.length - 1)) % SOURCES.length].id
  avatarTab.value = next
  void nextTick(() => document.getElementById(`avatar-src-${next}`)?.focus())
}
function onAvatarFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  avatarError.value = ''
  if (!file) return
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { avatarError.value = '请选择 JPG、PNG 或 WebP 图片。'; return }
  if (file.size > 20 * 1024 * 1024) { avatarError.value = '图片不能超过 20 MiB。'; return }
  cropSource.value = file
}
async function uploadAvatar(png: Blob) {
  if (avatarBusy.value) return
  avatarBusy.value = true; avatarError.value = ''
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}api/account/avatar/upload`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'image/png' }, body: png, signal: AbortSignal.timeout(30_000),
    })
    const data = await response.json().catch(() => null) as { avatar?: string; error?: string } | null
    if (!response.ok || !data?.avatar) throw new Error(data?.error ?? `上传失败（HTTP ${response.status}），请重试。`)
    if (currentUser.value) currentUser.value = { ...currentUser.value, avatar: data.avatar }
    cropSource.value = null
    picking.value = false
  } catch (reason) {
    avatarError.value = reason instanceof DOMException ? '上传超时，请检查网络后重试。' : (reason as Error).message
  } finally {
    avatarBusy.value = false
  }
}
// 头像网格里用方向键移动（每行 4 个）
function onAvatarKey(event: KeyboardEvent) {
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 }[event.key]
  if (!step) return
  event.preventDefault()
  const items = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button')]
  const i = items.indexOf(document.activeElement as HTMLElement)
  items[Math.min(items.length - 1, Math.max(0, i + step))]?.focus()
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
  <div class="container ui-page account-page">
    <p v-if="!currentUser" class="ui-empty">正在确认登录状态…</p>
    <template v-else>
      <!-- 概览：头像（点击更换）、名字、剩余张数，右边是兑换码 -->
      <section class="account-hero ui-card reveal" style="--i: 0" aria-labelledby="account-title">
        <div class="account-who">
          <button type="button" class="avatar-edit" aria-label="更换头像" @click="picking = true">
            <ChibiAvatar :id="currentUser.avatar" :size="72" />
            <span class="avatar-edit-badge" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M10.5 3.5l2 2L6 12H4v-2z" /></svg></span>
          </button>
          <div>
            <h1 id="account-title">{{ currentUser.username }}</h1>
            <p class="account-who-meta"><span v-if="currentUser.role === 'admin'" class="ui-tag warn">管理员</span><button type="button" class="link-button" @click="picking = true">更换头像</button></p>
          </div>
        </div>
        <div class="account-stat">
          <span>剩余张数</span>
          <strong>{{ currentUser.credits }}</strong>
        </div>
        <div class="account-stat">
          <span>已生成</span>
          <strong>{{ totalMade }}</strong>
        </div>
        <form class="account-redeem" @submit.prevent="redeem">
          <label class="ui-label" for="redeem-code">输入兑换码</label>
          <div class="account-redeem-row">
            <input id="redeem-code" v-model="code" class="ui-input" name="code" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" :disabled="busy" placeholder="abcd-efgh-jkmn">
            <button class="ui-btn ui-btn-primary" type="submit" :disabled="busy">{{ busy ? '兑换中…' : '兑换' }}</button>
          </div>
          <p v-if="message" class="ui-alert ok" role="status">{{ message }}</p>
          <p v-if="error" :key="error" class="ui-alert err" role="alert">{{ error }}</p>
        </form>
      </section>

      <div class="ui-tabs account-tabs reveal" style="--i: 1" role="tablist" aria-label="账户分区" @keydown="onTabKey">
        <button
          v-for="t in TABS" :id="`account-tab-${t.id}`" :key="t.id" type="button" role="tab" :aria-selected="tab === t.id"
          :aria-controls="`account-panel-${t.id}`" :tabindex="tab === t.id ? 0 : -1" @click="selectTab(t.id)"
        >{{ t.label }}</button>
      </div>

      <!-- 额度：怎么买 + 变动记录 -->
      <div v-if="tab === 'credits'" id="account-panel-credits" class="account-panels" role="tabpanel" aria-labelledby="account-tab-credits">
        <section class="ui-card" aria-label="购买兑换码">
          <div class="ui-card-body">
            <ContactCard />
            <ul class="buy-notes">
              <li>1 张对应生成 1 张图，一次生成几张就用几张。</li>
              <li>没生成出来的张数会自动退回，不用找客服。</li>
              <li>每个兑换码只能用一次，兑换后的张数一直有效。</li>
            </ul>
          </div>
        </section>

        <section class="ui-card" aria-labelledby="ledger-title">
          <div class="ui-card-body">
            <div class="ui-card-head"><h2 id="ledger-title">额度变动</h2><span class="ui-meta">最近 20 条</span></div>
            <p v-if="loading" class="ui-empty">正在加载…</p>
            <p v-else-if="!ledger.length" class="ui-empty">还没有额度变动。兑换之后会显示在这里。</p>
            <ul v-else class="ui-list">
              <li v-for="(row, i) in ledger" :key="i">
                <span class="when">{{ when(row.created_at) }}</span>
                <span>{{ REASONS[row.reason] ?? row.reason }}</span>
                <span class="amount" :class="{ plus: row.delta > 0 }">{{ row.delta > 0 ? `+${row.delta}` : row.delta }}</span>
              </li>
            </ul>
          </div>
        </section>
      </div>

      <!-- 生成记录 -->
      <section v-else-if="tab === 'history'" id="account-panel-history" class="ui-card" role="tabpanel" aria-labelledby="account-tab-history">
        <div class="ui-card-body">
          <div class="ui-card-head"><h2>最近的生成</h2><span class="ui-meta">最近 20 次</span></div>
          <p v-if="loading" class="ui-empty">正在加载…</p>
          <p v-else-if="!generations.length" class="ui-empty">还没有生成过。<RouterLink to="/studio" class="link-inline">去创作工坊</RouterLink></p>
          <ul v-else class="ui-list">
            <li v-for="(g, i) in generations" :key="i">
              <span class="when">{{ when(g.created_at) }}</span>
              <span>{{ nameOf(STYLES, g.style as never) }} · {{ nameOf(COMPOSITIONS, g.composition as never) }}</span>
              <span class="ui-tag" :class="g.succeeded ? 'ok' : 'err'">{{ g.succeeded ? `成功 ${g.succeeded} 张` : '没有生成出来' }}{{ g.refunded ? `，退回 ${g.refunded} 张` : '' }}</span>
            </li>
          </ul>
          <p class="ui-hint history-note">照片和生成的图片都不保存在服务器上，这里只记次数和结果。作品在“作品画廊”里，只存在这个浏览器。</p>
        </div>
      </section>

      <!-- 账号安全：改密码、退出登录 -->
      <div v-else id="account-panel-security" class="account-panels" role="tabpanel" aria-labelledby="account-tab-security">
        <section class="ui-card" aria-labelledby="password-title">
          <div class="ui-card-body">
            <div class="ui-card-head"><h2 id="password-title">修改密码</h2></div>
            <form class="ui-form" @submit.prevent="changePassword">
              <input class="visually-hidden" type="text" name="username" autocomplete="username" :value="currentUser.username" readonly tabindex="-1" aria-hidden="true">
              <label class="ui-field">
                <span class="ui-label">现在的密码</span>
                <input v-model="pw.current" class="ui-input" name="current-password" type="password" autocomplete="current-password" required :disabled="pwBusy">
              </label>
              <label class="ui-field">
                <span class="ui-label">新密码<small>至少 {{ PASSWORD_MIN }} 位</small></span>
                <input v-model="pw.next" class="ui-input" name="new-password" type="password" autocomplete="new-password" required :disabled="pwBusy">
              </label>
              <label class="ui-field">
                <span class="ui-label">再输一次新密码</span>
                <input v-model="pw.confirm" class="ui-input" name="confirm-password" type="password" autocomplete="new-password" required :disabled="pwBusy">
              </label>
              <div><button class="ui-btn ui-btn-primary" type="submit" :disabled="pwBusy">{{ pwBusy ? '正在修改…' : '修改密码' }}</button></div>
            </form>
            <p v-if="pwMessage" class="ui-alert ok" role="status">{{ pwMessage }}</p>
            <p v-if="pwError" :key="pwError" class="ui-alert err" role="alert">{{ pwError }}</p>
          </div>
        </section>
        <section class="ui-card" aria-labelledby="session-title">
          <div class="ui-card-body">
            <div class="ui-card-head"><h2 id="session-title">登录</h2></div>
            <p class="ui-hint">修改密码后，其他设备上的登录会自动退出。忘记密码请联系客服重置。</p>
            <div class="session-actions">
              <RouterLink v-if="currentUser.role === 'admin'" class="ui-btn ui-btn-secondary" to="/admin">进入管理后台</RouterLink>
              <button type="button" class="ui-btn ui-btn-danger" @click="signOut">退出登录</button>
            </div>
          </div>
        </section>
      </div>
    </template>

    <Modal :open="picking" :title="cropSource ? '调整头像' : '更换头像'" :description="cropSource ? '' : '选好就会保存，随时可以再换。'" :width="520" @close="closePicker">
      <AvatarCropper v-if="cropSource" :source="cropSource" :busy="avatarBusy" @done="uploadAvatar" @cancel="cropSource = null" />
      <template v-else>
        <div class="ui-tabs avatar-tabs" role="tablist" aria-label="头像来源" @keydown="onSourceKey">
          <button
            v-for="s in SOURCES" :id="`avatar-src-${s.id}`" :key="s.id" type="button" role="tab" :aria-selected="avatarTab === s.id"
            :aria-controls="`avatar-panel-${s.id}`" :tabindex="avatarTab === s.id ? 0 : -1" @click="avatarTab = s.id"
          >{{ s.label }}</button>
        </div>

        <div v-if="avatarTab === 'builtin'" id="avatar-panel-builtin" role="tabpanel" aria-labelledby="avatar-src-builtin">
          <div class="avatar-grid" role="group" aria-label="内置头像" @keydown="onAvatarKey">
            <button
              v-for="a in AVATARS" :key="a" type="button" class="avatar-option" :class="{ selected: currentUser?.avatar === a }"
              :aria-pressed="currentUser?.avatar === a" :disabled="avatarBusy" :data-autofocus="currentUser?.avatar === a ? '' : undefined" @click="chooseAvatar(a)"
            >
              <ChibiAvatar :id="a" :size="64" />
              <span>{{ AVATAR_LOOKS[a].name }}</span>
            </button>
          </div>
        </div>

        <div v-else-if="avatarTab === 'upload'" id="avatar-panel-upload" role="tabpanel" aria-labelledby="avatar-src-upload">
          <input ref="avatarFile" class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择头像图片" @change="onAvatarFile">
          <button type="button" class="avatar-upload" @click="avatarFile?.click()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 19h14" /></svg>
            <strong>选择一张图片</strong>
            <span>JPG / PNG / WebP，选好后可以调整位置</span>
          </button>
          <p class="ui-hint avatar-note">上传的头像会保存在服务器上，只有你自己能看到。换回内置头像时，这张图会被删除。</p>
        </div>

        <div v-else id="avatar-panel-works" role="tabpanel" aria-labelledby="avatar-src-works">
          <p v-if="!works.length" class="ui-empty">这个浏览器里还没有作品。<RouterLink class="link-inline" to="/studio" @click="picking = false">去创作工坊</RouterLink></p>
          <div v-else class="avatar-works" role="group" aria-label="我的作品">
            <button v-for="w in works.slice(0, 24)" :key="w.id" type="button" class="avatar-work" :aria-label="`用这张作品做头像（${new Date(w.createdAt).toLocaleDateString('zh-CN')}）`" @click="cropSource = w.blob">
              <img :src="w.url" alt="">
            </button>
          </div>
          <p class="ui-hint avatar-note">选一张作品，调整好位置后会作为头像上传，只有你自己能看到。</p>
        </div>
      </template>
      <p v-if="avatarError" class="ui-alert err" role="alert">{{ avatarError }}</p>
    </Modal>
  </div>
</template>
