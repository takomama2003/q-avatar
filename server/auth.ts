// 账号：注册、登录、退出、会话。密码用 scrypt 加盐哈希；会话令牌放在 HttpOnly Cookie 里，库里只存它的 SHA-256。
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { promisify } from 'node:util'
import { nowIso, type Db } from './db.ts'

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>

export const USERNAME_MIN = 3
export const USERNAME_MAX = 20
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128
export const SESSION_COOKIE = 'qa_session'
const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000 // 30 天不活动过期
const SESSION_TOUCH_MS = 10 * 60 * 1000 // 最多每 10 分钟更新一次“最近活动”，少写库
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }
const HOUR_MS = 60 * 60 * 1000
// 防暴力破解和批量注册的限制。只限登录和注册，不限生成。
const LOGIN_FAILS_PER_ACCOUNT = 8 // 同一个用户名 15 分钟内输错这么多次就暂时锁定
const LOGIN_FAILS_PER_IP = 30 // 同一个 IP 15 分钟内输错这么多次就暂时锁定
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const REGISTER_PER_IP_PER_HOUR = 5

export type User = { id: number; username: string; role: 'user' | 'admin'; status: 'active' | 'disabled'; avatar: string }
export type AuthError = { status: number; error: string }
export type AuthOptions = { now?: () => number; secureCookie?: boolean }

const length = (value: string) => Array.from(value).length
export const usernameKey = (name: string) => name.trim().normalize('NFKC').toLowerCase()
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export function checkUsername(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '请填写用户名。'
  const name = raw.trim().normalize('NFKC')
  if (length(name) < USERNAME_MIN || length(name) > USERNAME_MAX) return `用户名要 ${USERNAME_MIN} 到 ${USERNAME_MAX} 个字。`
  if (!/^[\p{Script=Han}A-Za-z0-9_]+$/u.test(name)) return '用户名只能用中文、字母、数字和下划线。'
  return ''
}
export function checkPassword(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '请填写密码。'
  if (length(raw) < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位。`
  if (length(raw) > PASSWORD_MAX) return `密码最多 ${PASSWORD_MAX} 位。`
  return ''
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`
}
export async function verifyPassword(password: string, stored: string) {
  const [kind, n, r, p, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 })
  return key.length === expected.length && timingSafeEqual(key, expected)
}
// 用户名不存在时也算一次哈希，响应时间不暴露“这个用户名有没有注册过”
const DUMMY_HASH = hashPassword('not-a-real-password')

// 管理员重置密码时生成的临时密码：12 位，去掉容易看混的字符
export function temporaryPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  return Array.from(randomBytes(12), byte => alphabet[byte % alphabet.length]).join('')
}

// nginx 在本机转发时把真实来源写在 X-Real-IP；只信任来自本机的转发。
export function clientIp(req: IncomingMessage) {
  const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
  const forwarded = req.headers['x-real-ip']
  const loopback = remote === '::1' || /^127\./.test(remote)
  return loopback && typeof forwarded === 'string' && forwarded.trim() ? forwarded.trim() : remote || 'unknown'
}

function readCookie(req: IncomingMessage, name: string) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return ''
}

// 滑动窗口计数：只在内存里，重启清空（重启本身不频繁，足够挡住暴力尝试）
function counter(windowMs: number, now: () => number) {
  const hits = new Map<string, number[]>()
  const recent = (key: string) => {
    const cutoff = now() - windowMs
    const list = (hits.get(key) ?? []).filter(time => time > cutoff)
    if (list.length) hits.set(key, list)
    else hits.delete(key)
    return list
  }
  return {
    count: (key: string) => recent(key).length,
    add: (key: string) => { const list = recent(key); list.push(now()); hits.set(key, list) },
    // 撤回最近一次计数（这次尝试最后成功了）
    undo: (key: string) => { const list = recent(key); list.pop(); if (list.length) hits.set(key, list); else hits.delete(key) },
    clear: (key: string) => { hits.delete(key) },
  }
}

export function createAuth(db: Db, options: AuthOptions = {}) {
  const now = options.now ?? Date.now
  const secure = options.secureCookie ?? true
  const accountFails = counter(LOGIN_WINDOW_MS, now)
  const ipFails = counter(LOGIN_WINDOW_MS, now)
  const registrations = counter(HOUR_MS, now)

  const cookie = (token: string, maxAgeSeconds: number) =>
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`

  function startSession(res: ServerResponse, userId: number) {
    const token = randomBytes(32).toString('base64url')
    const at = now()
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(sha256(token), userId, nowIso(at), nowIso(at), nowIso(at + SESSION_IDLE_MS))
    // 顺手清掉这个人已经过期的会话
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').run(userId, nowIso(at))
    res.setHeader('Set-Cookie', cookie(token, SESSION_IDLE_MS / 1000))
  }

  // 读当前登录的用户；会话过期或账号停用都当作未登录。
  // 传了 res 时，顺带把 Cookie 的有效期往后延：只要在用，就不会在第 30 天被浏览器丢掉。
  function currentUser(req: IncomingMessage, res?: ServerResponse): User | null {
    const token = readCookie(req, SESSION_COOKIE)
    if (!token || token.length > 100) return null
    const row = db.prepare(`
      SELECT u.id, u.username, u.role, u.status, u.avatar, s.token_hash, s.last_seen_at, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha256(token)) as
      (User & { token_hash: string; last_seen_at: string; expires_at: string }) | undefined
    if (!row || Date.parse(row.expires_at) <= now() || row.status !== 'active') return null
    if (now() - Date.parse(row.last_seen_at) > SESSION_TOUCH_MS) {
      db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
        .run(nowIso(now()), nowIso(now() + SESSION_IDLE_MS), row.token_hash)
      if (res && !res.headersSent) res.setHeader('Set-Cookie', cookie(token, SESSION_IDLE_MS / 1000))
    }
    return { id: row.id, username: row.username, role: row.role, status: row.status, avatar: row.avatar }
  }

  return {
    currentUser,
    // 管理员改了自己的密码后，当前设备换一个新令牌继续用
    startSessionFor: (res: ServerResponse, userId: number) => startSession(res, userId),

    async register(req: IncomingMessage, res: ServerResponse, body: { username?: unknown; password?: unknown; privacyAccepted?: unknown }): Promise<User | AuthError> {
      const problem = checkUsername(body.username) || checkPassword(body.password)
      if (problem) return { status: 400, error: problem }
      if (body.privacyAccepted !== true) return { status: 400, error: '请先阅读并同意《用户协议》和《隐私政策》。' }
      const ip = clientIp(req)
      if (registrations.count(ip) >= REGISTER_PER_IP_PER_HOUR) return { status: 429, error: '这个网络注册得太频繁了，请一小时后再试。' }
      const username = (body.username as string).trim().normalize('NFKC')
      const key = usernameKey(username)
      if (db.prepare('SELECT 1 FROM users WHERE username_key = ?').get(key)) return { status: 409, error: '这个用户名已经有人用了，换一个吧。' }
      // 先占名额再算哈希：同时发很多个注册请求也绕不过每小时 5 个的限制。没注册成功就撤回。
      registrations.add(ip)
      const hash = await hashPassword(body.password as string)
      let id: number
      try {
        id = Number(db.prepare('INSERT INTO users (username, username_key, password_hash, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)')
          .run(username, key, hash, nowIso(now()), nowIso(now())).lastInsertRowid)
      } catch (error) {
        registrations.undo(ip)
        // 两个人同时抢同一个用户名：唯一约束兜底
        if (/UNIQUE/i.test((error as Error).message)) return { status: 409, error: '这个用户名已经有人用了，换一个吧。' }
        throw error
      }
      startSession(res, id)
      return { id, username, role: 'user', status: 'active', avatar: '' }
    },

    async login(req: IncomingMessage, res: ServerResponse, body: { username?: unknown; password?: unknown }): Promise<User | AuthError> {
      if (typeof body.username !== 'string' || typeof body.password !== 'string' || !body.username.trim() || !body.password) {
        return { status: 400, error: '请填写用户名和密码。' }
      }
      const ip = clientIp(req)
      // 账号锁定按“用户名 + IP”计：别人从别的地方乱试，锁不住本人
      const key = `${usernameKey(body.username)}\u0000${ip}`
      if (accountFails.count(key) >= LOGIN_FAILS_PER_ACCOUNT || ipFails.count(ip) >= LOGIN_FAILS_PER_IP) {
        return { status: 429, error: '密码输错次数太多，请 15 分钟后再试。' }
      }
      // 先记一次再算哈希：同时发很多个请求时，每个都会占用名额，绕不过限制。成功了再撤回。
      accountFails.add(key)
      ipFails.add(ip)
      const row = db.prepare('SELECT id, username, role, status, avatar, password_hash FROM users WHERE username_key = ?').get(usernameKey(body.username)) as
        (User & { password_hash: string }) | undefined
      const ok = row ? await verifyPassword(body.password, row.password_hash) : (await verifyPassword(body.password, await DUMMY_HASH), false)
      if (!row || !ok) return { status: 401, error: '用户名或密码不对。' }
      ipFails.undo(ip)
      if (row.status !== 'active') return { status: 403, error: '这个账号已停用，请联系客服。' }
      accountFails.clear(key)
      db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(now()), row.id)
      startSession(res, row.id)
      return { id: row.id, username: row.username, role: row.role, status: row.status, avatar: row.avatar }
    },

    // 用户自己改密码：要先输对旧密码。改完其他设备下线，当前设备换一个新的登录令牌继续用。
    async changePassword(req: IncomingMessage, res: ServerResponse, user: User, body: { currentPassword?: unknown; newPassword?: unknown }): Promise<{ ok: true } | AuthError> {
      if (typeof body.currentPassword !== 'string' || !body.currentPassword) return { status: 400, error: '请输入现在的密码。' }
      const problem = checkPassword(body.newPassword)
      if (problem) return { status: 400, error: problem.replace('密码', '新密码') }
      if (body.newPassword === body.currentPassword) return { status: 400, error: '新密码和现在的密码一样，换一个吧。' }
      // 和登录共用锁定计数：防止有人拿着别人没退出的电脑反复猜旧密码
      const ip = clientIp(req)
      const key = `${usernameKey(user.username)}\u0000${ip}`
      if (accountFails.count(key) >= LOGIN_FAILS_PER_ACCOUNT) return { status: 429, error: '密码输错次数太多，请 15 分钟后再试。' }
      accountFails.add(key)
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string } | undefined
      if (!row || !(await verifyPassword(body.currentPassword, row.password_hash))) return { status: 401, error: '现在的密码不对。' }
      accountFails.clear(key)
      await setPassword(db, user.id, body.newPassword as string)
      startSession(res, user.id)
      return { ok: true }
    },

    logout(req: IncomingMessage, res: ServerResponse) {
      const token = readCookie(req, SESSION_COOKIE)
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token))
      res.setHeader('Set-Cookie', cookie('', 0))
    },
  }
}
export type Auth = ReturnType<typeof createAuth>

// 管理员和命令行工具用：建账号、改密码（改密码会让这个人所有已登录的设备下线）
export async function createUser(db: Db, username: string, password: string, role: 'user' | 'admin', now = Date.now()) {
  const problem = checkUsername(username) || checkPassword(password)
  if (problem) throw new Error(problem)
  const name = username.trim().normalize('NFKC')
  const result = db.prepare('INSERT INTO users (username, username_key, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, usernameKey(name), await hashPassword(password), role, nowIso(now))
  return Number(result.lastInsertRowid)
}
export async function setPassword(db: Db, userId: number, password: string) {
  const problem = checkPassword(password)
  if (problem) throw new Error(problem)
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), userId)
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}
