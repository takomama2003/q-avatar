// v0.2 后端的组装：账号接口 /api/auth/*、我的账户 /api/account/*、管理后台 /api/admin/*、生成 /api/generate。
// production.ts 只负责读配置、开端口；这里把数据库、账号、额度和生成接到一起，方便测试直接用。
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createAuth, clientIp, setPassword, temporaryPassword, type Auth, type User } from './auth.ts'
import { adjustCredits, balanceOf, createCredits, createVoucher, type Credits, type Reservation } from './credits.ts'
import { nowIso, type Db } from './db.ts'
import { createImageApi, isLocalRequest, type Billing } from './image-api.ts'

type Env = Record<string, string | undefined>
type Log = (message: string) => void
const MAX_JSON_BYTES = 16 * 1024
const PAGE_MAX = 100

export type AppOptions = {
  db: Db
  env: () => Env
  log?: Log
  dailyLimit?: number
  secureCookie?: boolean
  now?: () => number
  timeoutMs?: number
  downloadStallMs?: number
}

function sendJson(res: ServerResponse, status: number, body: object) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise(resolve => {
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) { req.resume(); return resolve(null) }
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_JSON_BYTES) chunks.push(chunk)
    })
    req.on('end', () => {
      if (size > MAX_JSON_BYTES) return resolve(null)
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        resolve(value && typeof value === 'object' && !Array.isArray(value) ? value : null)
      } catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
  })
}

const publicUser = (user: User, balance: number) => ({ username: user.username, role: user.role, credits: balance })
const intParam = (value: string | null, fallback: number, max: number) => {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback
}

export function createApp(options: AppOptions) {
  const { db } = options
  const log = options.log ?? (() => {})
  const now = options.now ?? Date.now
  const auth: Auth = createAuth(db, { now, secureCookie: options.secureCookie })
  const credits: Credits = createCredits(db, { dailyLimit: options.dailyLimit, now })

  // 生成接口按登录用户扣额度
  const billing: Billing = {
    authorize(req) {
      const user = auth.currentUser(req)
      if (!user) return { status: 401, error: '登录后才能真实生成。没有账号可以先注册，或用演示模式体验。', code: 'login_required' }
      return { userId: user.id, label: `用户 ${user.username}` }
    },
    reserve(payer, count, meta) {
      const reserved = credits.reserve(payer.userId, count, meta)
      if ('error' in reserved) return { ...reserved, code: reserved.status === 402 ? 'no_credits' : undefined }
      return reserved
    },
    settle(reservation, result) {
      return credits.settle(reservation as Reservation, result)
    },
  }
  const imageApi = createImageApi({
    env: options.env, log, billing, remainingToday: credits.remainingToday,
    timeoutMs: options.timeoutMs, downloadStallMs: options.downloadStallMs,
  })

  function audit(admin: User, action: string, target: string, detail = '') {
    db.prepare('INSERT INTO admin_log (admin_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(admin.id, action, target, detail, nowIso(now()))
    log(`[admin] ${admin.username} ${action} ${target}${detail ? ` · ${detail}` : ''}`)
  }

  async function authRoutes(req: IncomingMessage, res: ServerResponse, path: string) {
    if (path === '/auth/me' && req.method === 'GET') {
      const user = auth.currentUser(req, res)
      return sendJson(res, user ? 200 : 401, user ? { user: publicUser(user, balanceOf(db, user.id)) } : { error: '还没有登录。' })
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: '只支持 POST。' })
    const body = await readJson(req)
    if (!body) return sendJson(res, 400, { error: '请求格式不对，请刷新页面后重试。' })
    if (path === '/auth/register' || path === '/auth/login') {
      const result = path === '/auth/register' ? await auth.register(req, res, body) : await auth.login(req, res, body)
      if ('error' in result) {
        if (result.status !== 400) log(`[auth] ${path === '/auth/register' ? '注册' : '登录'}失败 ${clientIp(req)}：${result.error}`)
        return sendJson(res, result.status, { error: result.error })
      }
      log(`[auth] ${path === '/auth/register' ? '新注册' : '登录'} ${result.username}（${clientIp(req)}）`)
      return sendJson(res, 200, { user: publicUser(result, balanceOf(db, result.id)) })
    }
    if (path === '/auth/logout') {
      auth.logout(req, res)
      return sendJson(res, 200, { ok: true })
    }
    return sendJson(res, 404, { error: '接口不存在。' })
  }

  async function accountRoutes(req: IncomingMessage, res: ServerResponse, path: string, user: User) {
    if (path === '/account/redeem' && req.method === 'POST') {
      const body = await readJson(req)
      if (!body) return sendJson(res, 400, { error: '请求格式不对，请刷新页面后重试。' })
      const result = credits.redeem(user.id, body.code)
      if ('error' in result) return sendJson(res, result.status, { error: result.error })
      log(`[account] ${user.username} 兑换了 ${result.credits} 张，余额 ${result.balance}`)
      return sendJson(res, 200, { credits: result.credits, balance: result.balance })
    }
    if (path === '/account/history' && req.method === 'GET') {
      const rows = db.prepare('SELECT created_at, style, composition, requested, succeeded, failed, refunded, status FROM generations WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(user.id)
      const ledger = db.prepare('SELECT delta, reason, note, created_at FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(user.id)
      return sendJson(res, 200, { balance: balanceOf(db, user.id), generations: rows, ledger })
    }
    return sendJson(res, 404, { error: '接口不存在。' })
  }

  async function adminRoutes(req: IncomingMessage, res: ServerResponse, path: string, url: URL, admin: User) {
    const get = req.method === 'GET'
    if (get && path === '/admin/users') {
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
      const rows = db.prepare(`
        SELECT u.id, u.username, u.role, u.status, u.created_at, u.last_login_at,
          COALESCE((SELECT SUM(delta) FROM credit_ledger WHERE user_id = u.id), 0) AS balance,
          COALESCE((SELECT SUM(succeeded) FROM generations WHERE user_id = u.id), 0) AS generated,
          (SELECT MAX(created_at) FROM generations WHERE user_id = u.id) AS last_generated_at
        FROM users u WHERE (? = '' OR instr(u.username_key, ?) > 0) ORDER BY u.id DESC LIMIT 500`).all(q, q)
      return sendJson(res, 200, { users: rows })
    }
    if (get && path === '/admin/vouchers') {
      const rows = db.prepare(`SELECT v.id, v.note, v.credits, v.max_uses, v.used_count, v.status, v.created_at,
        (SELECT GROUP_CONCAT(u.username, '、') FROM redemptions r JOIN users u ON u.id = r.user_id WHERE r.voucher_id = v.id) AS redeemed_by
        FROM vouchers v ORDER BY v.id DESC LIMIT 500`).all()
      return sendJson(res, 200, { vouchers: rows })
    }
    if (get && path === '/admin/stats') {
      const days = db.prepare(`SELECT substr(datetime(created_at, '+8 hours'), 1, 10) AS day,
        SUM(requested) AS requested, SUM(succeeded) AS succeeded, SUM(failed) AS failed, SUM(refunded) AS refunded, COUNT(*) AS runs,
        COUNT(DISTINCT user_id) AS users
        FROM generations WHERE created_at >= ? GROUP BY day ORDER BY day DESC`).all(nowIso(now() - 30 * 86400_000))
      const totals = db.prepare(`SELECT (SELECT COUNT(*) FROM users) AS users,
        (SELECT COALESCE(SUM(succeeded), 0) FROM generations) AS succeeded,
        (SELECT COALESCE(SUM(failed), 0) FROM generations) AS failed,
        (SELECT COALESCE(SUM(delta), 0) FROM credit_ledger) AS outstanding`).get()
      const top = db.prepare(`SELECT u.username, SUM(g.succeeded) AS succeeded FROM generations g JOIN users u ON u.id = g.user_id
        WHERE g.created_at >= ? GROUP BY g.user_id ORDER BY succeeded DESC LIMIT 10`).all(nowIso(now() - 30 * 86400_000))
      return sendJson(res, 200, { totals, days, top, remainingToday: credits.remainingToday() })
    }
    if (get && path === '/admin/generations') {
      const limit = intParam(url.searchParams.get('limit'), 50, PAGE_MAX) || 50
      const offset = intParam(url.searchParams.get('offset'), 0, 1_000_000)
      const userId = intParam(url.searchParams.get('user'), 0, Number.MAX_SAFE_INTEGER)
      const rows = db.prepare(`SELECT g.id, u.username, g.created_at, g.style, g.composition, g.requested, g.succeeded, g.failed, g.refunded, g.duration_ms, g.status, g.error
        FROM generations g JOIN users u ON u.id = g.user_id WHERE (? = 0 OR g.user_id = ?) ORDER BY g.id DESC LIMIT ? OFFSET ?`).all(userId, userId, limit, offset)
      const total = Number((db.prepare('SELECT COUNT(*) AS n FROM generations WHERE (? = 0 OR user_id = ?)').get(userId, userId) as { n: number }).n)
      return sendJson(res, 200, { generations: rows, total })
    }

    if (req.method !== 'POST') return sendJson(res, 405, { error: '只支持 POST。' })
    const body = await readJson(req)
    if (!body) return sendJson(res, 400, { error: '请求格式不对，请刷新页面后重试。' })
    const target = () => {
      const id = Number(body.userId)
      const row = Number.isInteger(id) ? db.prepare('SELECT id, username, role, status FROM users WHERE id = ?').get(id) as User | undefined : undefined
      return row
    }
    try {
      if (path === '/admin/vouchers') {
        const created = createVoucher(db, {
          credits: Number(body.credits), maxUses: body.maxUses === undefined ? 1 : Number(body.maxUses),
          note: typeof body.note === 'string' ? body.note.trim() : '', createdBy: admin.id, now: now(),
        })
        audit(admin, '新建兑换码', `#${created.id}`, `${body.credits} 张 × ${body.maxUses ?? 1} 次${body.note ? ` · ${body.note}` : ''}`)
        return sendJson(res, 200, { id: created.id, code: created.code })
      }
      if (path === '/admin/vouchers/disable' || path === '/admin/vouchers/enable') {
        const id = Number(body.voucherId)
        const status = path.endsWith('disable') ? 'disabled' : 'active'
        const changed = Number(db.prepare('UPDATE vouchers SET status = ? WHERE id = ?').run(status, id).changes)
        if (!changed) return sendJson(res, 404, { error: '没有这个兑换码。' })
        audit(admin, status === 'disabled' ? '停用兑换码' : '恢复兑换码', `#${id}`)
        return sendJson(res, 200, { ok: true })
      }
      const user = target()
      if (!user) return sendJson(res, 404, { error: '没有这个用户。' })
      if (path === '/admin/users/credits') {
        const note = typeof body.note === 'string' ? body.note.trim() : ''
        const balance = adjustCredits(db, user.id, Number(body.delta), note || '管理员调整', now())
        audit(admin, '调整额度', user.username, `${Number(body.delta) > 0 ? '+' : ''}${body.delta} 张，余额 ${balance}${note ? ` · ${note}` : ''}`)
        return sendJson(res, 200, { balance })
      }
      if (path === '/admin/users/status') {
        const status = body.status === 'disabled' ? 'disabled' : 'active'
        if (user.id === admin.id && status === 'disabled') return sendJson(res, 400, { error: '不能停用你自己的账号。' })
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, user.id)
        if (status === 'disabled') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id)
        audit(admin, status === 'disabled' ? '停用账号' : '恢复账号', user.username)
        return sendJson(res, 200, { ok: true })
      }
      if (path === '/admin/users/reset-password') {
        const password = temporaryPassword()
        await setPassword(db, user.id, password)
        audit(admin, '重置密码', user.username)
        return sendJson(res, 200, { password })
      }
    } catch (error) {
      return sendJson(res, 400, { error: (error as Error).message })
    }
    return sendJson(res, 404, { error: '接口不存在。' })
  }

  // 挂在 /api 下：req.url 已去掉 /api 前缀
  return async function app(req: IncomingMessage, res: ServerResponse) {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname
      if (path === '/config' || path === '/generate') return imageApi(req, res)
      // 只接受同源请求：挡住其他网站借用户浏览器里的登录状态发起请求
      if (!isLocalRequest(req)) return sendJson(res, 403, { error: '只接受本站页面的请求。' })
      if (path.startsWith('/auth/')) return await authRoutes(req, res, path)
      const user = auth.currentUser(req, res)
      if (path.startsWith('/account/')) {
        if (!user) return sendJson(res, 401, { error: '请先登录。', code: 'login_required' })
        return await accountRoutes(req, res, path, user)
      }
      if (path.startsWith('/admin/')) {
        if (!user) return sendJson(res, 401, { error: '请先登录。', code: 'login_required' })
        if (user.role !== 'admin') return sendJson(res, 403, { error: '只有管理员能访问。' })
        return await adminRoutes(req, res, path, url, user)
      }
      return sendJson(res, 404, { error: '接口不存在。' })
    } catch (error) {
      log(`[app] 未预期的错误：${(error as Error).message?.split('\n')[0]}`)
      if (!res.headersSent) sendJson(res, 500, { error: '后端出错，请稍后重试。' })
      else res.end()
    }
  }
}
