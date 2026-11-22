import type { CreationOptions } from '../../shared/options'

export type { Composition, CreationOptions } from '../../shared/options'
export interface GenerationInput { photo: File; options: CreationOptions }
export interface GeneratedImage { url: string; blob: Blob; extension: string }
export interface GenerationResult {
  images: GeneratedImage[]
  options: CreationOptions
  source: 'model'
  model?: string
  warning?: string
  balance?: number // 登录用户生成后剩余的张数
}
// off：后端没配置模型或连不上，暂时不能生成（problem 是给站长看的原因，只打印到控制台）
export type ServiceMode = { kind: 'off'; problem?: string } | { kind: 'model'; model: string; accounts: boolean; remainingToday?: number }
// 需要登录（login_required）或额度用完（no_credits）时抛出，页面据此引导去登录或兑换。
export class AccountError extends Error {
  code: 'login_required' | 'no_credits'
  constructor(message: string, code: 'login_required' | 'no_credits') { super(message); this.code = code }
}
const apiUrl = (path: string) => `${import.meta.env.BASE_URL}api/${path}`
const extensionOf = (type: string) => {
  const subtype = type.split(/[/;]/)[1]?.trim() || 'png'
  return subtype === 'jpeg' ? 'jpg' : subtype
}

// 询问后端是否配置了模型；没有后端或未配置时暂时不能生成。
export async function detectMode(): Promise<ServiceMode> {
  try {
    const response = await fetch(apiUrl('config'), { signal: AbortSignal.timeout(5000) })
    const json = response.headers.get('content-type')?.includes('application/json')
    const config = json && (response.ok || response.status === 403) ? await response.json().catch(() => null) : null
    if (response.ok && config?.enabled === true && typeof config.model === 'string') {
      return { kind: 'model', model: config.model, accounts: config.accounts === true, remainingToday: typeof config.remainingToday === 'number' ? config.remainingToday : undefined }
    }
    // 403：后端拒绝了这个页面地址（例如用局域网 IP 打开）
    const problem = typeof config?.problem === 'string' ? config.problem : response.status === 403 && typeof config?.error === 'string' ? config.error : undefined
    return { kind: 'off', problem }
  } catch (error) {
    return { kind: 'off', problem: error instanceof DOMException && error.name === 'TimeoutError' ? '检测后端超时' : '连不上后端' }
  }
}

// 生成：照片和选项发给后端，由后端带着密钥调用图像模型。
export async function generateWithModel(input: GenerationInput, model: string): Promise<GenerationResult> {
  const form = new FormData()
  form.append('photo', input.photo)
  const { description, count, ...choices } = input.options
  for (const [name, value] of Object.entries(choices)) form.append(name, value)
  form.append('description', description)
  form.append('count', String(count))
  let response: Response
  try { response = await fetch(apiUrl('generate'), { method: 'POST', body: form, credentials: 'same-origin', signal: AbortSignal.timeout(330_000) }) }
  catch (error) {
    throw new Error(error instanceof DOMException && error.name === 'TimeoutError'
      ? '等了 5 分钟还没有结果，请稍后到“我的账户”看看张数有没有退回，再重试。'
      : '和服务器的连接断开了，请检查网络。稍后到“我的账户”看看张数有没有退回，再重试。')
  }
  const body = response.headers.get('content-type')?.includes('application/json') ? await response.json().catch(() => null) : null
  const message = typeof body?.error === 'string' ? body.error : `生成失败（HTTP ${response.status}），请稍后重试。`
  if (body?.code === 'login_required' || body?.code === 'no_credits') throw new AccountError(message, body.code)
  if (!response.ok) throw new Error(message)
  const urls: unknown[] = Array.isArray(body?.images) ? body.images : []
  const images: GeneratedImage[] = []
  for (const url of urls) {
    if (typeof url !== 'string' || !url.startsWith('data:image/')) continue
    const blob = await (await fetch(url)).blob()
    images.push({ url: URL.createObjectURL(blob), blob, extension: extensionOf(blob.type) })
  }
  if (!images.length) throw new Error('这次没有拿到图片，请稍后重试；一直不成功请联系客服。')
  const balance = typeof body?.balance === 'number' ? body.balance : undefined
  return { images, options: { ...input.options }, source: 'model', model, warning: typeof body?.warning === 'string' ? body.warning : undefined, balance }
}
