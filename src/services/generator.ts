import { MAX_COUNT, type CreationOptions } from '../../shared/options'

export type { Composition, CreationOptions } from '../../shared/options'
export interface GenerationInput { photo: File; options: CreationOptions }
export interface GeneratedImage { url: string; blob: Blob; extension: string }
export interface GenerationResult {
  images: GeneratedImage[]
  options: CreationOptions
  source: 'demo' | 'model'
  model?: string
  warning?: string
  balance?: number // 登录用户生成后剩余的张数
}
export type ServiceMode = { kind: 'demo'; problem?: string } | { kind: 'model'; model: string; accounts: boolean; remainingToday?: number }
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

// 询问本地后端是否配置了模型密钥；没有后端（例如纯静态部署）或未配置时回到演示模式。
export async function detectMode(): Promise<ServiceMode> {
  try {
    const response = await fetch(apiUrl('config'), { signal: AbortSignal.timeout(5000) })
    const json = response.headers.get('content-type')?.includes('application/json')
    const config = json && (response.ok || response.status === 403) ? await response.json().catch(() => null) : null
    if (response.ok && config?.enabled === true && typeof config.model === 'string') {
      return { kind: 'model', model: config.model, accounts: config.accounts === true, remainingToday: typeof config.remainingToday === 'number' ? config.remainingToday : undefined }
    }
    // 403：后端拒绝了这个页面地址（例如用局域网 IP 打开）；把原因告诉用户，而不是悄悄回到演示模式。
    const problem = typeof config?.problem === 'string' ? config.problem : response.status === 403 && typeof config?.error === 'string' ? config.error : undefined
    return { kind: 'demo', problem }
  } catch (error) {
    return { kind: 'demo', problem: error instanceof DOMException && error.name === 'TimeoutError' ? '检测本地后端超时，已使用演示模式，刷新页面可重试。' : undefined }
  }
}

// 演示服务只返回固定本地素材，不读取或上传照片；风格、表情等选项不会改变示例图。
export async function generateDemo(input: GenerationInput): Promise<GenerationResult> {
  await new Promise(resolve => setTimeout(resolve, 900))
  const response = await fetch(`${import.meta.env.BASE_URL}samples/${input.options.composition}.png`)
  if (!response.ok || !response.headers.get('content-type')?.includes('image/png')) {
    throw new Error('示例图片加载失败，请检查网络后手动重试。')
  }
  const blob = await response.blob()
  const count = Math.min(Math.max(input.options.count, 1), MAX_COUNT)
  const images = Array.from({ length: count }, () => ({ url: URL.createObjectURL(blob), blob, extension: 'png' }))
  return { images, options: { ...input.options }, source: 'demo' }
}

// 真实生成：照片和选项发给本地后端，由后端带着密钥调用图像模型。
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
      ? '等待超过 5 分钟仍没有结果。这次可能仍会生成并扣费，请稍等一会儿再重试。'
      : '和本地后端的连接断开了（开发服务器可能刚重启）。上一次可能仍在生成并扣费，请稍等一会儿再重试。')
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
  if (!images.length) throw new Error('后端没有返回图片，请查看终端日志。')
  const balance = typeof body?.balance === 'number' ? body.balance : undefined
  return { images, options: { ...input.options }, source: 'model', model, warning: typeof body?.warning === 'string' ? body.warning : undefined, balance }
}
