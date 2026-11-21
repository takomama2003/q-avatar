// 额度：余额 = 流水求和。兑换、生成扣费、失败退回、管理员调整都记一条流水，出了问题能逐条对账。
// 扣费放在事务里：两个请求同时扣，也不会把余额扣成负数。
import { createHash, randomInt } from 'node:crypto'
import { nowIso, transaction, type Db } from './db.ts'

const CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789' // 去掉容易看混的 0 o 1 l
export const DEFAULT_DAILY_LIMIT = 20 // 没配置时的保守默认值；线上在 .env 里写明 DAILY_IMAGE_LIMIT

export type Denied = { status: number; error: string }
export type Reservation = { userId: number; generationId: number; count: number }

export const hashCode = (code: string) => createHash('sha256').update(code.trim().toLowerCase()).digest('hex')
export function generateCode() {
  const group = () => Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
  return `${group()}-${group()}-${group()}`
}

export function balanceOf(db: Db, userId: number): number {
  return Number((db.prepare('SELECT COALESCE(SUM(delta), 0) AS n FROM credit_ledger WHERE user_id = ?').get(userId) as { n: number }).n)
}

// 北京时间 = UTC+8，没有夏令时，所以“今天零点”可以直接按固定偏移算。
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
export const beijingDayStart = (at: number) => nowIso(Math.floor((at + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS - BEIJING_OFFSET_MS)

export function createCredits(db: Db, options: { dailyLimit?: number; now?: () => number } = {}) {
  const now = options.now ?? Date.now
  const dailyLimit = options.dailyLimit ?? DEFAULT_DAILY_LIMIT
  // 统计全站今天（北京时间）已经用了多少张
  const dayStart = () => beijingDayStart(now())
  // 按生成记录的时间算：零点前发起、零点后才退回的那几张，仍然记在发起那天
  const usedToday = () => Number((db.prepare(
    'SELECT COALESCE(SUM(requested - refunded), 0) AS n FROM generations WHERE created_at >= ?',
  ).get(dayStart()) as { n: number }).n)

  return {
    balance: (userId: number) => balanceOf(db, userId),
    remainingToday: () => Math.max(0, dailyLimit - usedToday()),

    redeem(userId: number, rawCode: unknown): { credits: number; balance: number } | Denied {
      if (typeof rawCode !== 'string' || !rawCode.trim()) return { status: 400, error: '请输入兑换码。' }
      return transaction(db, () => {
        const voucher = db.prepare('SELECT id, credits, max_uses, used_count, status FROM vouchers WHERE code_hash = ?').get(hashCode(rawCode)) as
          { id: number; credits: number; max_uses: number; used_count: number; status: string } | undefined
        if (!voucher) return { status: 404, error: '兑换码不对，请检查后重新输入。' }
        if (voucher.status !== 'active') return { status: 410, error: '这个兑换码已停用。' }
        if (db.prepare('SELECT 1 FROM redemptions WHERE voucher_id = ? AND user_id = ?').get(voucher.id, userId)) {
          return { status: 409, error: '你已经兑换过这个码了。' }
        }
        if (voucher.used_count >= voucher.max_uses) return { status: 410, error: '这个兑换码的次数已经用完了。' }
        const at = nowIso(now())
        db.prepare('INSERT INTO redemptions (voucher_id, user_id, redeemed_at) VALUES (?, ?, ?)').run(voucher.id, userId, at)
        db.prepare('UPDATE vouchers SET used_count = used_count + 1 WHERE id = ?').run(voucher.id)
        db.prepare("INSERT INTO credit_ledger (user_id, delta, reason, voucher_id, created_at) VALUES (?, ?, 'redeem', ?, ?)").run(userId, voucher.credits, voucher.id, at)
        return { credits: voucher.credits, balance: balanceOf(db, userId) }
      })
    },

    // 准备调用模型之前占用额度，同时建一条生成记录。按请求的张数先扣，结束后按结果退回明确没扣费的张数。
    reserve(userId: number, count: number, meta: { style: string; composition: string }): { reservation: Reservation } | Denied {
      return transaction(db, () => {
        const balance = balanceOf(db, userId)
        if (balance <= 0) return { status: 402, error: '你的额度用完了。去“我的账户”输入兑换码，或者向 Tim 申请额度。' }
        if (count > balance) return { status: 402, error: `你只剩 ${balance} 张额度，请减少张数后再试。` }
        const left = dailyLimit - usedToday()
        if (left <= 0) return { status: 429, error: '今天全站的生成次数已经用完了，明天再来吧。' }
        if (count > left) return { status: 429, error: `今天全站只剩 ${left} 张，请减少张数后再试。` }
        const at = nowIso(now())
        const generationId = Number(db.prepare('INSERT INTO generations (user_id, created_at, style, composition, requested) VALUES (?, ?, ?, ?, ?)')
          .run(userId, at, meta.style, meta.composition, count).lastInsertRowid)
        db.prepare("INSERT INTO credit_ledger (user_id, delta, reason, generation_id, created_at) VALUES (?, ?, 'generate', ?, ?)").run(userId, -count, generationId, at)
        return { reservation: { userId, generationId, count } }
      })
    },

    // 生成结束：记下结果，退回明确没扣费的张数（上游直接拒绝、连不上）。
    settle(reservation: Reservation, result: { succeeded: number; failed: number; unbilled: number; durationMs: number; error?: string }) {
      const back = Math.min(Math.max(0, result.unbilled), reservation.count)
      return transaction(db, () => {
        if (back) {
          db.prepare("INSERT INTO credit_ledger (user_id, delta, reason, generation_id, note, created_at) VALUES (?, ?, 'refund', ?, '上游明确拒绝，未扣费', ?)")
            .run(reservation.userId, back, reservation.generationId, nowIso(now()))
        }
        db.prepare('UPDATE generations SET succeeded = ?, failed = ?, refunded = ?, duration_ms = ?, status = ?, error = ? WHERE id = ?')
          .run(result.succeeded, result.failed, back, Math.round(result.durationMs), result.succeeded ? 'done' : 'failed', (result.error ?? '').slice(0, 300), reservation.generationId)
        return { refunded: back, balance: balanceOf(db, reservation.userId) }
      })
    },
  }
}
export type Credits = ReturnType<typeof createCredits>

// 额度申请：用户提交，管理员批准（直接加额度）或拒绝。每个人同时只能有一个待处理的申请。
export const REQUEST_MAX = 1000
export type CreditRequest = { id: number; amount: number; reason: string; status: string; granted: number | null; reply: string; created_at: string; decided_at: string | null }

export function submitRequest(db: Db, userId: number, body: { amount?: unknown; reason?: unknown }, now = Date.now()): CreditRequest | Denied {
  const amount = Number(body.amount)
  if (!Number.isInteger(amount) || amount < 1 || amount > REQUEST_MAX) return { status: 400, error: `申请的张数要在 1 到 ${REQUEST_MAX} 之间。` }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (Array.from(reason).length > 200) return { status: 400, error: '用途说明最多 200 个字。' }
  try {
    const id = Number(db.prepare('INSERT INTO credit_requests (user_id, amount, reason, created_at) VALUES (?, ?, ?, ?)').run(userId, amount, reason, nowIso(now)).lastInsertRowid)
    return db.prepare('SELECT id, amount, reason, status, granted, reply, created_at, decided_at FROM credit_requests WHERE id = ?').get(id) as CreditRequest
  } catch (error) {
    if (/UNIQUE/i.test((error as Error).message)) return { status: 409, error: '你已经有一个申请在等 Tim 处理了，处理完才能再申请。' }
    throw error
  }
}

export function cancelRequest(db: Db, userId: number, now = Date.now()) {
  return Number(db.prepare("UPDATE credit_requests SET status = 'cancelled', decided_at = ? WHERE user_id = ? AND status = 'pending'").run(nowIso(now), userId).changes) > 0
}

// 批准：在同一个事务里改状态并加额度，同一个申请不会被批准两次
export function decideRequest(db: Db, requestId: number, decision: { approve: boolean; granted?: number; reply?: string; adminId: number }, now = Date.now()) {
  return transaction(db, () => {
    const row = db.prepare('SELECT id, user_id, amount, status FROM credit_requests WHERE id = ?').get(requestId) as { id: number; user_id: number; amount: number; status: string } | undefined
    if (!row) throw new Error('没有这个申请。')
    if (row.status !== 'pending') throw new Error('这个申请已经处理过了。')
    const reply = (decision.reply ?? '').trim().slice(0, 200)
    const at = nowIso(now)
    if (!decision.approve) {
      db.prepare("UPDATE credit_requests SET status = 'rejected', reply = ?, decided_at = ?, decided_by = ? WHERE id = ?").run(reply, at, decision.adminId, row.id)
      return { userId: row.user_id, granted: 0, balance: balanceOf(db, row.user_id) }
    }
    const granted = decision.granted ?? row.amount
    if (!Number.isInteger(granted) || granted < 1 || granted > 100_000) throw new Error('批准的张数必须是 1 到 100000 之间的整数。')
    db.prepare("UPDATE credit_requests SET status = 'approved', granted = ?, reply = ?, decided_at = ?, decided_by = ? WHERE id = ?").run(granted, reply, at, decision.adminId, row.id)
    db.prepare("INSERT INTO credit_ledger (user_id, delta, reason, note, created_at) VALUES (?, ?, 'admin', ?, ?)").run(row.user_id, granted, `批准额度申请 #${row.id}`, at)
    return { userId: row.user_id, granted, balance: balanceOf(db, row.user_id) }
  })
}

// 管理员和命令行用：建兑换码（返回原文，只显示这一次）、调整额度
export function createVoucher(db: Db, options: { credits: number; maxUses?: number; note?: string; createdBy?: number; code?: string; codeHash?: string; now?: number }) {
  if (!Number.isInteger(options.credits) || options.credits < 1 || options.credits > 100_000) throw new Error('张数必须是 1 到 100000 之间的整数。')
  const maxUses = options.maxUses ?? 1
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10_000) throw new Error('兑换次数必须是 1 到 10000 之间的整数。')
  const code = options.codeHash ? '' : (options.code ?? generateCode())
  const id = Number(db.prepare('INSERT INTO vouchers (code_hash, note, credits, max_uses, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(options.codeHash ?? hashCode(code), (options.note ?? '').slice(0, 60), options.credits, maxUses, nowIso(options.now), options.createdBy ?? null).lastInsertRowid)
  return { id, code }
}
export function adjustCredits(db: Db, userId: number, delta: number, note: string, now = Date.now()) {
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100_000) throw new Error('调整的张数必须是非零整数，绝对值不超过 100000。')
  return transaction(db, () => {
    if (delta < 0 && balanceOf(db, userId) + delta < 0) throw new Error('扣减后余额会小于 0。')
    db.prepare("INSERT INTO credit_ledger (user_id, delta, reason, note, created_at) VALUES (?, ?, 'admin', ?, ?)").run(userId, delta, note.slice(0, 120), nowIso(now))
    return balanceOf(db, userId)
  })
}
