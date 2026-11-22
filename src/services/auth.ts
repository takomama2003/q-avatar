import { ref } from 'vue'

// v0.2 账号接口（后端见实施计划：POST /api/auth/login、/api/auth/register、/api/auth/logout，GET /api/auth/me）。
// 登录状态放在 HttpOnly Cookie 里，前端拿不到令牌，只记当前用户的公开信息。
export interface User { username: string; role: 'user' | 'admin'; credits: number; avatar: string }

export const USERNAME_MIN = 3
export const USERNAME_MAX = 20
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

export const currentUser = ref<User | null>(null)

const apiUrl = (path: string) => `${import.meta.env.BASE_URL}api/auth/${path}`
const length = (value: string) => Array.from(value).length

// 和后端同一套规则：先在页面上提示，后端还会再查一遍。
export function checkUsername(value: string) {
  const name = value.trim()
  if (!name) return '请填写用户名。'
  if (length(name) < USERNAME_MIN || length(name) > USERNAME_MAX) return `用户名要 ${USERNAME_MIN} 到 ${USERNAME_MAX} 个字。`
  if (!/^[\p{Script=Han}A-Za-z0-9_]+$/u.test(name)) return '用户名只能用中文、字母、数字和下划线。'
  return ''
}
export function checkPassword(value: string) {
  if (!value) return '请填写密码。'
  if (length(value) < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位。`
  if (length(value) > PASSWORD_MAX) return `密码最多 ${PASSWORD_MAX} 位。`
  return ''
}

// 只允许跳回本站的页面，防止被拼成 ?redirect=https://别的网站
export function safeRedirect(value: unknown, fallback = '/studio') {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/login') ? value : fallback
}

async function request(path: string, init: RequestInit = {}): Promise<User | null> {
  let response: Response
  try {
    response = await fetch(apiUrl(path), { credentials: 'same-origin', signal: AbortSignal.timeout(15_000), ...init })
  } catch (error) {
    throw new Error(error instanceof DOMException && error.name === 'TimeoutError' ? '服务器太久没有响应，请稍后重试。' : '连不上服务器，请检查网络后重试。')
  }
  const body = response.headers.get('content-type')?.includes('application/json') ? await response.json().catch(() => null) : null
  if (response.status === 404 && !body?.user) throw new Error('服务暂时不可用，请稍后再试。')
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : `出错了（HTTP ${response.status}），请稍后重试。`)
  return body?.user ?? null
}

const send = (path: string, payload: object) => request(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

export async function login(username: string, password: string) {
  currentUser.value = await send('login', { username: username.trim(), password })
  return currentUser.value
}
export async function register(username: string, password: string) {
  currentUser.value = await send('register', { username: username.trim(), password, privacyAccepted: true })
  return currentUser.value
}
export async function logout() {
  await send('logout', {}).catch(() => null)
  currentUser.value = null
}
// 我的账户和管理后台共用的请求：同源 Cookie，失败时抛出带中文提示的错误。
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
export async function api<T = Record<string, unknown>>(path: string, body?: object): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${import.meta.env.BASE_URL}api/${path}`, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new ApiError('连不上服务器，请检查网络后重试。', 0)
  }
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json().catch(() => null) : null
  if (response.status === 401) currentUser.value = null
  if (!response.ok) throw new ApiError(typeof data?.error === 'string' ? data.error : `出错了（HTTP ${response.status}），请稍后重试。`, response.status)
  return data as T
}

// 打开页面时查一次登录状态；接口还没上线或没登录时当作未登录。
let checking: Promise<User | null> | null = null
export function loadCurrentUser() {
  checking = request('me').catch(() => null).then(user => (currentUser.value = user))
  return checking
}
// 需要知道“到底登没登录”的页面（我的账户、管理后台）先等这一步，避免直接打开时误判成未登录
export function whenUserKnown() {
  return checking ?? loadCurrentUser()
}
