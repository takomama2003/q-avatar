import type { IncomingMessage, ServerResponse } from 'node:http'
import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError, toFile } from 'openai'
// 后端直接用 node 运行（测试），所以这里的 import 要写 .ts 扩展名。
import { BACKGROUNDS, COMPOSITIONS, DEFAULT_OPTIONS, EXPRESSIONS, MAX_COUNT, MAX_DESCRIPTION, POSES, PROPORTIONS, RATIOS, STYLES } from '../shared/options.ts'
import type { BackgroundId, Composition, CreationOptions, ExpressionId, PoseId, ProportionId, StyleId } from '../shared/options.ts'
import { clientIp, type AccessGuard } from './access.ts'

// 本地后端：把照片转发给兼容 OpenAI 接口的图像模型。密钥只在服务端读取，不进入前端代码。
type Quality = 'low' | 'medium' | 'high' | 'auto'
type Ready = { status: 'ready'; apiKey: string; baseURL: string; model: string; quality: Quality; stream: boolean }
export type ImageSetup = { status: 'off' } | { status: 'invalid'; problem: string } | Ready
type Env = Record<string, string | undefined>
type Log = (message: string) => void

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const MAX_BODY_BYTES = MAX_PHOTO_BYTES + 1024 * 1024
const MAX_RESULT_BYTES = 30 * 1024 * 1024
const UPSTREAM_TIMEOUT_MS = 300_000
const QUALITIES: readonly string[] = ['low', 'medium', 'high', 'auto']
const IMAGE_TYPES = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as const
type ImageKind = keyof typeof IMAGE_TYPES
const TOO_LARGE = '照片不能超过 10 MiB，请压缩后重试。'

// 各选项对应的英文提示词。用 Record<…> 标注类型：shared/options.ts 新增选项而这里漏写时，类型检查会报错。
// 写法参考了用户在桌宠项目里调出满意效果的提示词：写清具体的渲染质感、头身比，并明确不要什么。
const STYLE_PROMPTS: Record<StyleId, string> = {
  figure: 'Turn the person in the reference photo into a refined 3D-rendered chibi collectible figurine, like a premium miniature fashion doll: soft dimensional rendering, glossy lifelike eyes with eyeliner, lashes and catch-lights, fine individual hair strands with natural sheen, smooth soft skin with a light blush, real fabric texture and stitching on the clothes, small metal accessories that catch the light, gentle soft studio lighting, crisp readable silhouette. Not a plastic vinyl toy, not a flat cartoon.',
  blindbox: 'Turn the person in the reference photo into a glossy blind-box art toy figurine: shiny PVC material, big sparkling eyes, small rounded display base under the feet, bright soft studio lighting, product-photo quality.',
  clay: 'Turn the person in the reference photo into a handmade clay figure in the style of stop-motion claymation: visible fingerprints and sculpting marks, soft matte plasticine texture, warm lighting, charming handcrafted feel.',
  pixel: 'Turn the person in the reference photo into a cute pixel-art game character sprite: crisp square pixels, limited color palette, clean outlines, retro 16-bit game style, no blur or anti-aliasing.',
  watercolor: 'Turn the person in the reference photo into a hand-painted watercolor chibi sticker illustration: soft watercolor washes and gentle pencil lines, a thick white sticker border around the character.',
}
const LIKENESS = 'This must be the same person as in the photo, not a similar-looking new character. Study the photo and keep their face shape, eye shape, facial features, skin tone, apparent age and gender presentation; their exact hairstyle, including the parting, fringe and which side it falls on, and hair color; their accessories such as earrings, glasses or necklaces; and their outfit with its colors, layers and distinctive details. Only the proportions and rendering style change. Keep adults looking like adults: cute and stylized, never toddler-like. If the photo contains several people, use only the most prominent person.'
// 全身构图按所选头身比；头像构图只拍到胸口，不写头身比。
const PROPORTION_PROMPTS: Record<ProportionId, string> = {
  light: 'Proportions: an elegant light-chibi figure about 3.5 to 4 heads tall; the head is about a quarter of the total height, larger than realistic but not oversized; slim torso, slender moderately long legs tapering to slim ankles, small hands and feet. Not a big-head super-deformed chibi, and not a realistic 7-head-tall model.',
  chibi: 'Proportions: a super-deformed chibi figure exactly 2.5 heads tall; the head is about 40% of the total height; tiny torso, very short legs, tiny hands and feet. No long legs and no realistic body proportions.',
}
const FRAMING: Record<Composition, string> = {
  portrait: 'Framing: head and shoulders bust, the face fills most of the frame, cropped at the chest. Stylized with a slightly enlarged head and eyes.',
  full: 'Framing: one complete full-body figure from the top of the head to the soles of the feet, centered, with empty margins on all sides; nothing is cropped and both feet are fully visible.',
}
const POSE_PROMPTS: Record<PoseId, string> = {
  stand: 'Pose: standing naturally.',
  wave: 'Pose: standing and waving one hand.',
  heart: 'Pose: making a heart shape with both hands.',
  sit: 'Pose: sitting down with legs together.',
  jump: 'Pose: jumping happily in mid-air.',
}
const EXPRESSION_PROMPTS: Record<ExpressionId, string> = {
  keep: 'Expression: keep the facial expression from the photo.',
  smile: 'Expression: a sweet gentle smile.',
  laugh: 'Expression: laughing happily with the mouth open.',
  cool: 'Expression: a cool confident look.',
  shy: 'Expression: shy, with rosy blushing cheeks.',
  wink: 'Expression: a playful wink.',
}
const BACKGROUND_PROMPTS: Record<BackgroundId, string> = {
  cream: 'Plain seamless light warm grey background (#f1efec).',
  white: 'Plain seamless pure white background.',
  lilac: 'Plain seamless soft lilac background (#ece4f7).',
  transparent: 'Transparent background, the character cleanly cut out with no shadow on the ground.',
}

export function buildPrompt(options: Pick<CreationOptions, 'style' | 'composition' | 'proportion' | 'expression' | 'pose' | 'background' | 'description'>) {
  return [
    STYLE_PROMPTS[options.style],
    LIKENESS,
    options.composition === 'full' ? PROPORTION_PROMPTS[options.proportion] : '',
    FRAMING[options.composition],
    options.composition === 'full' ? POSE_PROMPTS[options.pose] : '',
    EXPRESSION_PROMPTS[options.expression],
    BACKGROUND_PROMPTS[options.background],
    'One character only. No floor, no cast shadow, no scenery, no text, no logo, no watermark, no extra views. No handheld props unless the user asks for them below.',
    options.description ? `Extra details from the user (may be written in Chinese; follow them when they fit the style): ${options.description}` : '',
  ].filter(Boolean).join(' ')
}

export function normalizeBaseURL(raw: string | undefined) {
  const url = new URL(raw?.trim() || 'https://api.openai.com/v1')
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TypeError('unsupported protocol')
  // 允许填 https://host、https://host/v1，或误填完整的接口地址（如 /images/edits、/chat/completions）。
  const path = url.pathname.replace(/\/+$/, '').replace(/\/(images\/(edits|generations)|chat\/completions|completions|responses|models)$/, '')
  return `${url.origin}${path || '/v1'}`
}

export function readImageSetup(env: Env): ImageSetup {
  const apiKey = env.OPENAI_API_KEY?.trim().replace(/^Bearer\s+/i, '')
  if (!apiKey) return { status: 'off' }
  let baseURL: string
  try { baseURL = normalizeBaseURL(env.OPENAI_BASE_URL) }
  catch { return { status: 'invalid', problem: 'OPENAI_BASE_URL 不是有效的 http(s) 地址，请检查 .env。' } }
  const quality = env.OPENAI_IMAGE_QUALITY?.trim() || 'high'
  if (!QUALITIES.includes(quality)) return { status: 'invalid', problem: 'OPENAI_IMAGE_QUALITY 只能是 low、medium、high 或 auto。' }
  // 输出尺寸由页面上选的比例决定（shared/options.ts 的 RATIOS），不再读 OPENAI_IMAGE_SIZE。
  const stream = !/^(false|0|off|no)$/i.test(env.OPENAI_IMAGE_STREAM?.trim() ?? '')
  return { status: 'ready', apiKey, baseURL, model: env.OPENAI_IMAGE_MODEL?.trim() || 'gpt-image-2', quality: quality as Quality, stream }
}

export function describeSetup(setup: ImageSetup) {
  if (setup.status === 'off') return '[image-api] 未配置 OPENAI_API_KEY，页面使用演示模式。'
  if (setup.status === 'invalid') return `[image-api] 配置有误，页面使用演示模式：${setup.problem}`
  const url = new URL(setup.baseURL)
  const plain = url.protocol === 'http:' && !isLoopbackHost(url.hostname) ? '（注意：http 明文传输密钥）' : ''
  return `[image-api] 真实生成已开启：${setup.model} · ${setup.quality} · ${setup.stream ? '流式' : '非流式'} · ${url.host}${plain}`
}
// 改了 .env 或后端代码时 Vite 会重启并重新加载本模块，但上一张可能还在生成。
// 锁放在进程级（globalThis），新实例也能看到，避免重启后又发起一次扣费请求。
const lock = ((globalThis as { __timPetImageLock?: { busy: boolean } }).__timPetImageLock ??= { busy: false })

// 返回挂在 /api 下的中间件：GET /config 告诉前端用哪种模式，POST /generate 调用模型。
// access 只在公网部署时传入（server/production.ts）：凭口令生成，并限制次数。本地开发不传。
export function createImageApi(options: { env: () => Env; log?: Log; timeoutMs?: number; access?: AccessGuard }) {
  const log = options.log ?? (() => {})
  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS
  const access = options.access
  return async function imageApi(req: IncomingMessage, res: ServerResponse) {
    try {
      const path = (req.url ?? '/').split('?')[0]
      if (!isLocalRequest(req)) return sendJson(req, res, 403, { error: '图像接口只接受本机页面的请求。' })
      const setup = readImageSetup(options.env())
      if (path === '/config') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(req, res, 405, { error: '只支持 GET。' })
        if (setup.status !== 'ready') return sendJson(req, res, 200, { enabled: false, problem: setup.status === 'invalid' ? setup.problem : undefined })
        return sendJson(req, res, 200, access ? { enabled: true, model: setup.model, needsCode: true, remainingToday: access.remainingToday() } : { enabled: true, model: setup.model })
      }
      if (path !== '/generate') return sendJson(req, res, 404, { error: '接口不存在。' })
      if (req.method !== 'POST') return sendJson(req, res, 405, { error: '只支持 POST。' })
      if (setup.status !== 'ready') return sendJson(req, res, 503, { error: setup.status === 'invalid' ? setup.problem : '后端未配置 OPENAI_API_KEY，当前只能使用演示模式。' })
      // 先核对口令再接收照片：口令不对的请求不占锁，也不读上传内容。
      const denied = access?.checkCode(req)
      if (denied) {
        log(`[image-api] 拒绝 ${clientIp(req)}：${denied.error}`)
        return sendJson(req, res, denied.status, { error: denied.error, code: denied.status === 401 ? 'bad_code' : undefined })
      }
      // 一次只跑一张，避免重复点击或多开页面造成重复扣费。
      if (lock.busy) return sendJson(req, res, 429, { error: '上一张还在生成，请等它完成后再试。' })
      lock.busy = true
      try { await generate(req, res, setup, log, timeoutMs, access) }
      finally { lock.busy = false }
    } catch (error) {
      log(`[image-api] 未预期的错误：${brief(error, '')}`)
      if (res.headersSent || res.destroyed) res.end()
      else sendJson(req, res, 500, { error: '后端出错，请查看终端日志。' })
    }
  }
}

async function generate(req: IncomingMessage, res: ServerResponse, setup: Ready, log: Log, timeoutMs: number, access?: AccessGuard) {
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) return sendJson(req, res, 413, { error: TOO_LARGE })
  const contentType = req.headers['content-type'] ?? ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) return sendJson(req, res, 415, { error: '请求格式不对，请刷新页面后重试。' })
  const body = await readBody(req, MAX_BODY_BYTES)
  if (!body) return sendJson(req, res, 413, { error: TOO_LARGE })
  let form: FormData
  try { form = await new Request('http://localhost/', { method: 'POST', headers: { 'content-type': contentType }, body }).formData() }
  catch { return sendJson(req, res, 400, { error: '无法读取上传的照片，请重新选择。' }) }
  const photo = form.get('photo')
  if (!(photo instanceof File) || !photo.size) return sendJson(req, res, 400, { error: '请先上传一张照片。' })
  if (photo.size > MAX_PHOTO_BYTES) return sendJson(req, res, 413, { error: TOO_LARGE })
  const bytes = new Uint8Array(await photo.arrayBuffer())
  const kind = sniffImage(bytes)
  if (!kind) return sendJson(req, res, 400, { error: '请上传 JPG、PNG 或 WebP 图片。' })
  const options = readOptions(form)
  if (typeof options === 'string') return sendJson(req, res, 400, { error: options })
  // 输入都合格后才占用额度：传错参数不算次数。
  const limited = access?.reserve(req, options.count)
  if (limited) {
    log(`[image-api] 拒绝 ${clientIp(req)}：${limited.error}`)
    return sendJson(req, res, limited.status, { error: limited.error })
  }

  const started = performance.now()
  // 整个请求（包括读完流式结果）的总时限。SDK 自带的 timeout 只管到收到响应头为止。
  const deadline = AbortSignal.timeout(timeoutMs)
  const what = `${options.composition} · ${options.style} · ${options.count} 张`
  // 一张一个请求、同时发出：每个请求都能流式返回，总耗时约等于最慢的一张。
  const settled = await Promise.allSettled(Array.from({ length: options.count }, (_, index) => {
    const label = options.count > 1 ? `第 ${index + 1} 张` : ''
    return generateOne(setup, bytes, kind, options, deadline, timeoutMs, newTrace(message => log(`[image-api] ${label ? `${label} · ` : ''}${seconds(started)}s · ${message}`)))
  }))
  const images: GeneratedImage[] = []
  const failures: ReturnType<typeof describeUpstreamError>[] = []
  for (const item of settled) {
    if (item.status === 'fulfilled') images.push(item.value)
    else failures.push(describeUpstreamError(item.reason, setup))
  }
  if (!images.length) {
    const first = failures[0]
    log(`[image-api] 生成失败 ${what} · ${seconds(started)}s · ${first.log}`)
    return sendJson(req, res, first.status, { error: first.message })
  }
  const usage = images.reduce((sum, image) => ({ input: sum.input + (image.usage?.input_tokens ?? 0), output: sum.output + (image.usage?.output_tokens ?? 0) }), { input: 0, output: 0 })
  const tokens = images.some(image => image.usage) ? ` · tokens 输入 ${usage.input} / 输出 ${usage.output}` : ''
  const streamed = images.filter(image => image.partials >= 0)
  const mode = streamed.length ? ` · 流式（预览 ${streamed.reduce((sum, image) => sum + image.partials, 0)} 张）` : ''
  const partial = failures.length ? ` · 失败 ${failures.length} 张：${failures[0].log}` : ''
  log(`[image-api] 生成完成 ${what} · ${seconds(started)}s${mode}${tokens}${partial}`)
  sendJson(req, res, 200, {
    images: images.map(image => `data:${IMAGE_TYPES[image.kind]};base64,${Buffer.from(image.bytes).toString('base64')}`),
    failed: failures.length,
    warning: failures.length ? `有 ${failures.length} 张没有生成成功：${failures[0].message}` : undefined,
  })
}

type GeneratedImage = { bytes: Uint8Array; kind: ImageKind; usage?: Usage; partials: number }

async function generateOne(setup: Ready, bytes: Uint8Array, kind: ImageKind, options: CreationOptions, deadline: AbortSignal, timeoutMs: number, trace: Trace): Promise<GeneratedImage> {
  // maxRetries 为 0：失败时交给用户手动重试，不在后台悄悄重复扣费。
  const client = new OpenAI({ apiKey: setup.apiKey, baseURL: setup.baseURL, organization: null, project: null, timeout: timeoutMs, maxRetries: 0 })
  try {
    // 流式返回会陆续推送预览图，连接一直有数据，中转服务前面的 Cloudflare 不会因为约 100 秒没有响应而断开（524）。
    const raw = await client.images.edit({
      model: setup.model,
      image: await toFile(bytes, `photo.${kind === 'jpeg' ? 'jpg' : kind}`, { type: IMAGE_TYPES[kind] }),
      prompt: buildPrompt(options),
      size: RATIOS.find(ratio => ratio.id === options.ratio)?.size ?? '1024x1024',
      quality: setup.quality,
      output_format: 'png',
      n: 1,
      ...(options.background === 'transparent' ? { background: 'transparent' as const } : {}),
      ...(setup.stream ? { stream: true as const, partial_images: 2 } : {}),
    }, { signal: deadline }).asResponse()
    trace.note(`收到响应头：${describeResponse(raw.status, raw.headers)}`)
    trace.stage = 'body'
    const result = await readResult(raw, deadline, trace)
    trace.note(`读完结果 ${size(trace.bytes)}，${result.b64 ? '图片在响应里（base64）' : result.url ? `图片是链接（${hostOf(result.url)}）` : '没有图片'}`)
    trace.stage = 'download'
    const image = result.b64 ? Buffer.from(result.b64, 'base64') : result.url ? await download(result.url, deadline) : null
    const resultKind = image ? sniffImage(image) : null
    if (!image || !resultKind) throw new UpstreamShapeError('模型服务没有返回可用的图片。如果用的是中转服务，请确认它支持图片编辑接口（/images/edits）。')
    return { bytes: image, kind: resultKind, usage: result.usage, partials: result.partials }
  } catch (error) {
    // 记下卡在哪一步、已经收到多少数据：区分“中转一直没回”“回了一半停住”“下载图片链接失败”。
    if (error instanceof APIError && error.status) trace.note(`中转返回错误：${describeResponse(error.status, error.headers)}`)
    else trace.note(`在“${STAGES[trace.stage]}”时中断，已收到 ${size(trace.bytes)}`)
    throw error
  }
}

// 每张图一份诊断记录：当前进行到哪一步、已从中转收到多少字节。只记录状态码、类型、大小和请求 ID，不记录内容。
const STAGES = { headers: '等中转的响应头', body: '读取中转返回的结果', download: '下载图片链接' } as const
type Trace = { stage: keyof typeof STAGES; bytes: number; note: (message: string) => void }
const newTrace = (note: (message: string) => void): Trace => ({ stage: 'headers', bytes: 0, note })

// 请求 ID 用来在中转后台搜索同一条记录；cf-ray 是 Cloudflare 的编号。
const ID_HEADERS = ['x-oneapi-request-id', 'x-request-id', 'request-id', 'cf-ray']
function describeResponse(status: number, headers: Headers | undefined) {
  const parts = [`${status}`, headers?.get('content-type') || '无类型']
  const length = headers?.get('content-length')
  if (length) parts.push(`长度 ${size(Number(length))}`)
  for (const name of ID_HEADERS) {
    const value = headers?.get(name)
    if (value) parts.push(`${name}=${value.slice(0, 80)}`)
  }
  return parts.join(' · ')
}
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 1024 * 1024 ? 1 : 0)} KB`
// 图片链接可能带签名参数，日志里只写域名。
function hostOf(url: string) {
  try { return new URL(url).host } catch { return '无效链接' }
}

// 读取并校验表单里的创作选项。没传的字段用默认值（兼容旧页面），传了但不合法就报错；返回字符串表示错误信息。
function readOptions(form: FormData): CreationOptions | string {
  const errors: string[] = []
  const pick = <T extends string>(name: string, list: ReadonlyArray<{ id: T }>, fallback: T, label: string): T => {
    const value = form.get(name)
    if (value === null || value === '') return fallback
    const match = typeof value === 'string' ? list.find(item => item.id === value) : undefined
    if (!match) errors.push(`${label}参数不正确，请刷新页面后重试。`)
    return match ? match.id : fallback
  }
  const style = pick('style', STYLES, DEFAULT_OPTIONS.style, '风格')
  const composition = pick('composition', COMPOSITIONS, DEFAULT_OPTIONS.composition, '构图')
  const ratio = pick('ratio', RATIOS, DEFAULT_OPTIONS.ratio, '比例')
  const proportion = pick('proportion', PROPORTIONS, DEFAULT_OPTIONS.proportion, '头身比')
  const expression = pick('expression', EXPRESSIONS, DEFAULT_OPTIONS.expression, '表情')
  const pose = pick('pose', POSES, DEFAULT_OPTIONS.pose, '姿势')
  const background = pick('background', BACKGROUNDS, DEFAULT_OPTIONS.background, '背景')
  if (errors.length) return errors[0]
  const rawCount = form.get('count')
  const count = rawCount === null || rawCount === '' ? DEFAULT_OPTIONS.count : Number(rawCount)
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return `一次只能生成 1 到 ${MAX_COUNT} 张。`
  const rawDescription = form.get('description')
  // 浏览器提交表单时会把换行编码成 \r\n；先还原成 \n，字数才和页面上的计数一致。
  const description = typeof rawDescription === 'string' ? rawDescription.replace(/\r\n?/g, '\n').trim() : ''
  if (Array.from(description).length > MAX_DESCRIPTION) return `补充描述不能超过 ${MAX_DESCRIPTION} 字。`
  return { style, composition, ratio, proportion, expression, pose, background, description, count }
}
class UpstreamShapeError extends Error {
  status: number
  constructor(message: string, options?: ErrorOptions & { status?: number }) {
    super(message, options)
    this.status = options?.status ?? 502
  }
}
const DOWNLOAD_FAILED = '模型服务返回了图片链接，但后端下载失败，请检查网络或代理后重试。'
const MAX_EVENT_CHARS = 48 * 1024 * 1024
type Usage = { input_tokens?: number; output_tokens?: number }
// partials 为 -1 表示上游没有按流式返回（部分中转会忽略 stream 参数，直接给普通 JSON）。
type Result = { b64?: string; url?: string; usage?: Usage; partials: number }

// 读响应体时也受总时限约束：上游发完响应头后卡住不动，也会按时结束。
function untilDeadline<T>(promise: Promise<T>, deadline: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    if (deadline.aborted) return reject(deadline.reason)
    const stop = () => reject(deadline.reason)
    deadline.addEventListener('abort', stop, { once: true })
    promise.then(
      value => { deadline.removeEventListener('abort', stop); resolve(value) },
      error => { deadline.removeEventListener('abort', stop); reject(error) },
    )
  })
}

async function readResult(response: Response, deadline: AbortSignal, trace: Trace): Promise<Result> {
  if (!response.body) throw new UpstreamShapeError('模型服务的响应是空的。')
  // 解码前按原始字节计数，超时时日志里能看出中转发了多少就停了。
  const counted = response.body.pipeThrough(new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({ transform(chunk, controller) { trace.bytes += chunk.byteLength; controller.enqueue(chunk) } }))
  const reader = counted.pipeThrough(new TextDecoderStream()).getReader()
  try {
    if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) return await parseEventStream(reader, deadline)
    let text = ''
    for (;;) {
      const { done, value } = await untilDeadline(reader.read(), deadline)
      if (value) text += value
      if (text.length > MAX_EVENT_CHARS) throw new UpstreamShapeError('模型服务的响应过大，已中止。')
      if (done) break
    }
    let body: unknown
    try { body = JSON.parse(text) }
    catch (error) { throw new UpstreamShapeError('模型服务返回的不是图片结果。如果用的是中转服务，请确认它支持图片编辑接口（/images/edits）。', { cause: error }) }
    throwIfError(body)
    const data = body as { data?: Array<{ b64_json?: string; url?: string }>; usage?: Usage }
    return { b64: data.data?.[0]?.b64_json, url: data.data?.[0]?.url, usage: data.usage, partials: -1 }
  } catch (error) {
    void reader.cancel().catch(() => {}) // 超时或出错时关闭上游连接，不在后台继续下载
    throw error
  }
}

// 有些中转在 HTTP 200 里返回 {error: ...}，或在流里推送 error 事件。
function throwIfError(body: unknown) {
  const value = body as { type?: string; error?: unknown; message?: unknown; code?: unknown } | null
  if (!value || (value.type !== 'error' && !value.error)) return
  const inner = (typeof value.error === 'object' && value.error ? value.error : value) as { message?: unknown; code?: unknown }
  const text = `${typeof inner.code === 'string' ? inner.code : ''} ${typeof inner.message === 'string' ? inner.message : typeof value.error === 'string' ? value.error : ''}`.trim()
  if (/moderation|safety/i.test(text)) throw new UpstreamShapeError('这张照片或描述没有通过模型的安全审核，请换一张照片或修改描述后重试。', { status: 422, cause: new Error(text) })
  throw new UpstreamShapeError(`模型服务返回了错误：${text.slice(0, 160) || '未知错误'}`, { cause: new Error(text) })
}

// 逐块读取 SSE，只保留最终图片；预览图（partial_image）读到就丢，不占内存。
async function parseEventStream(reader: ReadableStreamDefaultReader<string>, deadline: AbortSignal): Promise<Result> {
  const result: Result = { partials: 0 }
  let buffer = ''
  const handle = (block: string) => {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!data || data === '[DONE]') return
    let event: { type?: string; b64_json?: string; usage?: Usage; data?: Array<{ b64_json?: string }> }
    try { event = JSON.parse(data) } catch { return }
    throwIfError(event)
    if (event.type?.endsWith('.partial_image')) result.partials++
    else if (event.type?.endsWith('.completed') && event.b64_json) { result.b64 = event.b64_json; result.usage = event.usage }
    // 少数中转把普通 JSON 结果包在流里返回
    else if (event.data?.[0]?.b64_json) { result.b64 = event.data[0].b64_json; result.usage = event.usage }
  }
  for (;;) {
    const { done, value } = await untilDeadline(reader.read(), deadline)
    if (value) buffer += value
    let boundary: RegExpExecArray | null
    while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
      handle(buffer.slice(0, boundary.index))
      buffer = buffer.slice(boundary.index + boundary[0].length)
    }
    if (buffer.length > MAX_EVENT_CHARS) throw new UpstreamShapeError('模型服务的流式响应过大，已中止。')
    if (done) break
  }
  if (buffer.trim()) handle(buffer)
  if (!result.b64) throw new UpstreamShapeError(result.partials ? `模型只返回了 ${result.partials} 张预览图就中断了，请重试。` : '模型服务的流式响应里没有图片。')
  return result
}

function isLoopbackHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\.\d+\.\d+\.\d+$/.test(host)
}

// 只服务本机：拒绝局域网访问，也拒绝其他网站借用户的浏览器跨站提交（会花用户的钱）。
export function isLocalRequest(req: IncomingMessage) {
  if (!isLoopbackHost((req.socket.remoteAddress ?? '').replace(/^::ffff:/, ''))) return false
  const origin = req.headers.origin
  if (!origin) return true
  try { return new URL(origin).host === req.headers.host?.toLowerCase() }
  catch { return false }
}

function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: object) {
  if (!req.complete) req.resume() // 提前拒绝时丢弃还没读完的上传内容
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage, limit: number) {
  return new Promise<Buffer<ArrayBuffer> | null>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) resolve(null)
      else chunks.push(chunk)
    })
    req.on('end', () => resolve(size > limit ? null : Buffer.concat(chunks)))
    req.on('error', reject)
    req.on('close', () => { if (!req.complete) reject(new Error('上传被中断')) })
  })
}

// 下载也算在同一个总时限里，后端最长耗时不会超过浏览器的等待时间。不带密钥。
async function download(url: string, deadline: AbortSignal) {
  try {
    const target = new URL(url)
    if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error(`protocol ${target.protocol}`)
    const response = await fetch(target, { signal: AbortSignal.any([deadline, AbortSignal.timeout(60_000)]) })
    if (!response.ok) throw new Error(`http ${response.status}`)
    if (Number(response.headers.get('content-length') ?? 0) > MAX_RESULT_BYTES) throw new Error('too large')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > MAX_RESULT_BYTES) throw new Error('too large')
    return bytes
  } catch (error) {
    if (deadline.aborted) throw error
    throw new UpstreamShapeError(DOWNLOAD_FAILED, { cause: error })
  }
}

// 把上游错误翻译成用户看得懂的中文提示；日志里保留状态码和原始信息，但遮住密钥。
function describeUpstreamError(error: unknown, setup: Ready) {
  const secret = setup.apiKey
  const detail = brief(error, secret)
  if (error instanceof UpstreamShapeError) return { status: error.status, message: error.message, log: error.cause ? `${detail} (${brief(error.cause, secret)})` : detail }
  const aborted = error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')
  if (error instanceof APIConnectionTimeoutError || error instanceof APIUserAbortError || aborted) return { status: 504, message: '模型服务超过 5 分钟没有返回结果，请稍后重试。', log: 'timeout' }
  if (error instanceof APIConnectionError) return { status: 502, message: '连不上模型服务，请检查 .env 里的 OPENAI_BASE_URL，以及网络或代理设置。', log: `connection ${rootCause(error.cause)}` }
  if (!(error instanceof APIError)) return { status: 502, message: '调用模型服务时出错，请查看终端日志。', log: detail }
  const status = error.status ?? 0
  const log = `upstream ${status} ${error.code ?? ''} ${detail}`.replace(/\s+/g, ' ')
  if (status === 401) return { status: 502, message: 'API 密钥无效或已过期，请检查 .env 里的 OPENAI_API_KEY。', log }
  if (/moderation|safety/i.test(`${error.code ?? ''} ${error.message}`)) return { status: 422, message: '这张照片或描述没有通过模型的安全审核，请换一张照片或修改描述后重试。', log }
  if (status === 403) return { status: 502, message: `模型服务拒绝了请求，请确认这个密钥能使用该图像模型。（${detail}）`, log }
  if (status === 404) return { status: 502, message: '接口地址或模型名不对，请检查 .env 里的 OPENAI_BASE_URL 和 OPENAI_IMAGE_MODEL。', log }
  // 524/522 是 Cloudflare 等待源站超时；中转服务前面常有 Cloudflare，约 100 秒没有数据就会断开。
  if ([408, 504, 522, 524].includes(status)) {
    const tip = setup.stream ? '这个中转可能不转发流式数据，可以把 .env 里的 OPENAI_IMAGE_QUALITY 改成 medium 或 low，生成更快' : '可以去掉 .env 里的 OPENAI_IMAGE_STREAM=false 改用流式，或把 OPENAI_IMAGE_QUALITY 改成 medium'
    return { status: 504, message: `中转服务等模型结果超时断开了（${status}）。${tip}，再试一次。这次请求可能已经扣费，可以在中转后台查看。`, log }
  }
  if (status === 400 && setup.stream && /stream|partial_images/i.test(error.message)) return { status: 400, message: `模型服务不接受流式参数：${detail}。请在 .env 里加一行 OPENAI_IMAGE_STREAM=false 后重试。`, log }
  if (status === 400 && /background|transparen/i.test(error.message)) return { status: 400, message: `这个模型或中转不支持透明背景：${detail}。请换一种背景后重试。`, log }
  if (status === 400) return { status: 400, message: `模型服务拒绝了请求参数：${detail}`, log }
  if (status === 413) return { status: 413, message: '照片太大，模型服务不接受，请压缩后重试。', log }
  if (status === 429) return { status: 429, message: '请求太频繁或账户额度不足，请稍后再试，或检查账户余额。', log }
  return { status: 502, message: `模型服务出错（${status || '未知状态'}），请稍后重试。`, log }
}

function rootCause(error: unknown) {
  let current = error
  for (let depth = 0; current && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
    current = (current as { cause?: unknown }).cause
  }
  return brief(error, '')
}

function brief(error: unknown, secret: string) {
  const line = (error instanceof Error ? error.message : String(error ?? '')).split('\n')[0]
  const masked = secret.length >= 8 ? line.split(secret).join('***') : line
  return masked.replace(/\b(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]{8,}/g, '$1***').slice(0, 160)
}

const seconds = (started: number) => ((performance.now() - started) / 1000).toFixed(1)

function sniffImage(bytes: Uint8Array): ImageKind | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))
  if (bytes.length > 8 && bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png'
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  return null
}
