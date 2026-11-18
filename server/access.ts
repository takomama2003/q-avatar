import { timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { IncomingMessage } from 'node:http'

// 公网部署时的访问控制：凭口令才能真实生成，并限制每天的总张数和每个 IP 每小时的次数。
// 本地开发不创建它，行为和以前一样。
type Env = Record<string, string | undefined>
export type AccessPolicy = { code: string; dailyImages: number; ipHourly: number; timeZone: string }
export type Denied = { status: number; error: string }
type Usage = { date: string; images: number }

const HOUR_MS = 60 * 60 * 1000
const MAX_WRONG_CODES = 10 // 每个 IP 每小时最多输错几次口令，防止逐个试
export const CODE_HEADER = 'x-access-code'

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

// nginx 在本机转发时把真实来源写在 X-Real-IP；只信任来自本机的转发，外部直接连进来时用连接地址。
export function clientIp(req: IncomingMessage) {
  const remote = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
  const forwarded = req.headers['x-real-ip']
  const loopback = remote === '::1' || /^127\./.test(remote)
  return loopback && typeof forwarded === 'string' && forwarded.trim() ? forwarded.trim() : remote || 'unknown'
}

function sameCode(given: string, expected: string) {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function createAccessGuard(policy: AccessPolicy, options: { usageFile?: string; now?: () => number } = {}) {
  const now = options.now ?? Date.now
  const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: policy.timeZone }).format(now())
  const requests = new Map<string, number[]>()
  const wrong = new Map<string, number[]>()
  let usage: Usage = loadUsage(options.usageFile) ?? { date: today(), images: 0 }

  const recent = (map: Map<string, number[]>, ip: string) => {
    const cutoff = now() - HOUR_MS
    const list = (map.get(ip) ?? []).filter(time => time > cutoff)
    map.set(ip, list)
    return list
  }
  const current = () => {
    if (usage.date !== today()) usage = { date: today(), images: 0 }
    return usage
  }
  const save = () => {
    if (!options.usageFile) return
    mkdirSync(dirname(options.usageFile), { recursive: true })
    const temp = `${options.usageFile}.tmp`
    writeFileSync(temp, JSON.stringify(usage))
    renameSync(temp, options.usageFile)
  }

  return {
    remainingToday: () => Math.max(0, policy.dailyImages - current().images),
    // 读请求体之前先核对口令，口令不对就不接收上传的照片。
    checkCode(req: IncomingMessage): Denied | null {
      const ip = clientIp(req)
      if (recent(wrong, ip).length >= MAX_WRONG_CODES) return { status: 429, error: '口令输错次数太多，请一小时后再试。' }
      const given = req.headers[CODE_HEADER]
      if (typeof given === 'string' && sameCode(given.trim(), policy.code)) return null
      recent(wrong, ip).push(now())
      return { status: 401, error: '访问口令不正确，请重新输入。' }
    },
    // 选项校验通过、准备调用模型之前占用额度。按请求的张数计：上游超时也可能已经扣费。
    reserve(req: IncomingMessage, count: number): Denied | null {
      const ip = clientIp(req)
      const list = recent(requests, ip)
      if (list.length >= policy.ipHourly) return { status: 429, error: `每小时最多生成 ${policy.ipHourly} 次，请稍后再试。` }
      const day = current()
      const left = policy.dailyImages - day.images
      if (left <= 0) return { status: 429, error: '今天的生成次数已经用完了，明天再来吧。' }
      if (count > left) return { status: 429, error: `今天只剩 ${left} 张的额度，请减少张数后再试。` }
      list.push(now())
      day.images += count
      save()
      return null
    },
  }
}
export type AccessGuard = ReturnType<typeof createAccessGuard>

function loadUsage(file: string | undefined): Usage | null {
  if (!file) return null
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<Usage>
    return typeof value.date === 'string' && Number.isInteger(value.images) ? { date: value.date, images: value.images as number } : null
  } catch { return null }
}
