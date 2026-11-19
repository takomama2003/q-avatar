import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { IncomingMessage } from 'node:http'

// 公网部署时的访问控制：主口令（ACCESS_CODE）或邀请码才能真实生成。
// 限制：全站每天总张数、每个 IP 每小时次数、每个邀请码的总额度。本地开发不创建它，行为和以前一样。
type Env = Record<string, string | undefined>
export type AccessPolicy = { code: string; dailyImages: number; ipHourly: number; timeZone: string }
export type Denied = { status: number; error: string }
// 这次请求是谁：主口令，或者某个邀请码（用名字标识，日志里只写名字）
export type Holder = { kind: 'owner' } | { kind: 'invite'; name: string; hash: string }
export type Reservation = { holder: Holder; count: number; date: string }
// data/codes.json：邀请码清单，只由命令行工具 server/codes.ts 写。只存 SHA-256，不存原文。
export type CodeRecord = { name: string; hash: string; quota: number; disabled?: boolean; createdAt: string }
export type CodesFile = { codes: CodeRecord[] }
// data/code-usage.json：每个邀请码已用张数，只由后端写；按 hash 记，删掉重建同名邀请码不会继承旧用量。
export type CodeUsage = Record<string, { used: number; lastUsedAt?: string }>
type DailyUsage = { date: string; images: number }

const HOUR_MS = 60 * 60 * 1000
const MAX_WRONG_CODES = 10 // 每个 IP 每小时最多输错几次口令，防止逐个试
export const CODE_HEADER = 'x-access-code'
const CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789' // 去掉容易看混的 0 o 1 l

const positiveInt = (raw: string | undefined, fallback: number, name: string) => {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} 必须是正整数。`)
  return value
}

// 读不到口令返回 null（不启用访问控制）；口令太短或数字不合法时抛错，由启动脚本报出来。
export function readAccessPolicy(env: Env): AccessPolicy | null {
  const code = env.ACCESS_CODE?.trim() ?? ''
  if (!code) return null
  if (code.length < 6) throw new Error('ACCESS_CODE 至少要 6 个字符。')
  return {
    code,
    dailyImages: positiveInt(env.DAILY_IMAGE_LIMIT, 20, 'DAILY_IMAGE_LIMIT'),
    ipHourly: positiveInt(env.IP_HOURLY_LIMIT, 6, 'IP_HOURLY_LIMIT'),
    timeZone: env.ACCESS_TIME_ZONE?.trim() || 'Asia/Shanghai',
  }
}

export const hashCode = (code: string) => createHash('sha256').update(code.trim()).digest('hex')
export function generateCode() {
  const group = () => Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
  return `${group()}-${group()}-${group()}`
}

// nginx 在本机转发时把真实来源写在 X-Real-IP；只信任来自本机的转发，外部直接连进来时用连接地址。
export function clientIp(req: IncomingMessage) {
  const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
  const forwarded = req.headers['x-real-ip']
  const loopback = remote === '::1' || /^127\./.test(remote)
  return loopback && typeof forwarded === 'string' && forwarded.trim() ? forwarded.trim() : remote || 'unknown'
}

export const holderLabel = (holder: Holder) => holder.kind === 'owner' ? '主口令' : `邀请码 ${holder.name}`

function sameCode(given: string, expected: string) {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// 先写临时文件再改名：写到一半出错或断电，原文件不会被弄坏。
export function writeJsonAtomic(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(temp, file)
}
export function readJson<T>(file: string | undefined): T | null {
  if (!file) return null
  try { return JSON.parse(readFileSync(file, 'utf8')) as T } catch { return null }
}

export function createAccessGuard(policy: AccessPolicy, options: { usageFile?: string; codesFile?: string; codeUsageFile?: string; now?: () => number } = {}) {
  const now = options.now ?? Date.now
  const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: policy.timeZone }).format(now())
  const requests = new Map<string, number[]>()
  const wrong = new Map<string, number[]>()
  const loadedDaily = readJson<DailyUsage>(options.usageFile)
  let daily: DailyUsage = loadedDaily && typeof loadedDaily.date === 'string' && Number.isInteger(loadedDaily.images) ? loadedDaily : { date: today(), images: 0 }
  const codeUsage: CodeUsage = readJson<CodeUsage>(options.codeUsageFile) ?? {}

  // 邀请码清单：文件修改时间变了就重新读，命令行加人、停用不用重启服务。
  let codes = new Map<string, CodeRecord>()
  let codesStamp = ''
  const currentCodes = () => {
    if (!options.codesFile) return codes
    let stamp = 'missing'
    try { const info = statSync(options.codesFile); stamp = `${info.mtimeMs}:${info.size}` } catch { /* 还没有清单文件 */ }
    if (stamp !== codesStamp) {
      codesStamp = stamp
      const file = stamp === 'missing' ? null : readJson<CodesFile>(options.codesFile)
      codes = new Map((file?.codes ?? []).filter(record => typeof record?.hash === 'string').map(record => [record.hash, record]))
    }
    return codes
  }

  const recent = (map: Map<string, number[]>, ip: string) => {
    const cutoff = now() - HOUR_MS
    const list = (map.get(ip) ?? []).filter(time => time > cutoff)
    map.set(ip, list)
    return list
  }
  const currentDaily = () => {
    if (daily.date !== today()) daily = { date: today(), images: 0 }
    return daily
  }
  const saveDaily = () => { if (options.usageFile) writeJsonAtomic(options.usageFile, daily) }
  const saveCodeUsage = () => { if (options.codeUsageFile) writeJsonAtomic(options.codeUsageFile, codeUsage) }
  const usedBy = (hash: string) => codeUsage[hash]?.used ?? 0
  // 额度按清单里的最新值算：命令行改了额度立即生效
  const inviteLeft = (holder: Holder) => {
    if (holder.kind !== 'invite') return undefined
    const record = currentCodes().get(holder.hash)
    return record ? Math.max(0, record.quota - usedBy(holder.hash)) : 0
  }

  return {
    remainingToday: () => Math.max(0, policy.dailyImages - currentDaily().images),
    quotaLeft: inviteLeft,
    // 读请求体之前先核对口令：不对就不接收上传的照片。
    authorize(req: IncomingMessage): { holder: Holder } | { denied: Denied } {
      const ip = clientIp(req)
      if (recent(wrong, ip).length >= MAX_WRONG_CODES) return { denied: { status: 429, error: '口令输错次数太多，请一小时后再试。' } }
      const raw = req.headers[CODE_HEADER]
      const given = typeof raw === 'string' ? raw.trim() : ''
      if (given && sameCode(given, policy.code)) return { holder: { kind: 'owner' } }
      const record = given ? currentCodes().get(hashCode(given)) : undefined
      if (record?.disabled) return { denied: { status: 403, error: '这个邀请码已停用，请联系发给你邀请码的人。' } }
      if (record) return { holder: { kind: 'invite', name: record.name, hash: record.hash } }
      recent(wrong, ip).push(now())
      return { denied: { status: 401, error: '邀请码不正确，请重新输入。' } }
    },
    // 选项校验通过、准备调用模型之前占用额度。按请求的张数计，结束后再按结果退回明确没扣费的张数。
    reserve(req: IncomingMessage, holder: Holder, count: number): { reservation: Reservation } | { denied: Denied } {
      const ip = clientIp(req)
      const list = recent(requests, ip)
      if (list.length >= policy.ipHourly) return { denied: { status: 429, error: `每小时最多生成 ${policy.ipHourly} 次，请稍后再试。` } }
      const own = inviteLeft(holder)
      if (own !== undefined && own <= 0) return { denied: { status: 429, error: '你的邀请码额度用完了，请联系发给你邀请码的人加额度。' } }
      if (own !== undefined && count > own) return { denied: { status: 429, error: `你的邀请码只剩 ${own} 张，请减少张数后再试。` } }
      const day = currentDaily()
      const left = policy.dailyImages - day.images
      if (left <= 0) return { denied: { status: 429, error: '今天的生成次数已经用完了，明天再来吧。' } }
      if (count > left) return { denied: { status: 429, error: `今天只剩 ${left} 张的额度，请减少张数后再试。` } }
      list.push(now())
      day.images += count
      saveDaily()
      if (holder.kind === 'invite') {
        codeUsage[holder.hash] = { used: usedBy(holder.hash) + count, lastUsedAt: new Date(now()).toISOString() }
        saveCodeUsage()
      }
      return { reservation: { holder, count, date: day.date } }
    },
    // 退回明确没扣费的张数（上游直接拒绝、连不上）。跨过零点时不退全站额度，避免记成负数。
    refund(reservation: Reservation, count: number) {
      const back = Math.min(Math.max(0, count), reservation.count)
      if (!back) return
      const day = currentDaily()
      if (day.date === reservation.date) {
        day.images = Math.max(0, day.images - back)
        saveDaily()
      }
      if (reservation.holder.kind === 'invite') {
        const usage = codeUsage[reservation.holder.hash]
        if (usage) {
          usage.used = Math.max(0, usage.used - back)
          saveCodeUsage()
        }
      }
    },
  }
}
export type AccessGuard = ReturnType<typeof createAccessGuard>
