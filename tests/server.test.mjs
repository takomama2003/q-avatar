// 后端测试：用本地假上游服务器模拟模型接口，不调用真实 API，不花钱。运行：npm run test:server
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildPrompt, createImageApi, isLocalRequest, normalizeBaseURL, readImageSetup } from '../server/image-api.ts'
import { DEFAULT_OPTIONS, STYLES } from '../shared/options.ts'
import { clientIp, createAccessGuard, readAccessPolicy } from '../server/access.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x0c, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(4)])
const KEY = 'sk-test-0123456789abcdefghij'
const RELAY_KEY = 'relay-9f8e7d6c5b4a3f2e1d0c' // 中转密钥常常不是 sk- 开头

async function listen(handler) {
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}
// 假上游：记录请求，按 reply 回应。
async function fakeUpstream() {
  const state = { requests: [], reply: (req, res) => json(res, 200, { created: 1, data: [{ b64_json: PNG.toString('base64') }], usage: { input_tokens: 10, output_tokens: 20 } }) }
  const { server, url } = await listen(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    state.requests.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) })
    state.reply(req, res)
  })
  return Object.assign(state, { server, url })
}
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
// 假的流式响应：把事件拆成几段分批写出，检查跨数据块的解析。
const sse = events => async (req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const text = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
  for (let i = 0; i < text.length; i += 37) {
    res.write(text.slice(i, i + 37))
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  res.end()
}
// 模拟 Vite 把中间件挂在 /api 下：去掉前缀后交给后端。
async function apiServer(env, extra = {}) {
  const logs = []
  const api = createImageApi({ env: () => env, log: message => logs.push(message), ...extra })
  const { server, url } = await listen((req, res) => { req.url = req.url.replace(/^\/api/, '') || '/'; api(req, res) })
  return { server, url, logs }
}
function photoForm({ photo = PNG, type = 'image/png', name = 'photo.png', composition = 'portrait', description = '', ...extra } = {}) {
  const form = new FormData()
  form.append('photo', new Blob([photo], { type }), name)
  form.append('composition', composition)
  form.append('description', description)
  for (const [key, value] of Object.entries(extra)) form.append(key, String(value))
  return form
}
// 成功时后端返回 { images: [data URL…], failed, warning }
const dataUrlBytes = url => Buffer.from(url.split(',')[1], 'base64')
const post = (url, body, headers) => fetch(`${url}/api/generate`, { method: 'POST', body, headers })
const ok = () => (req, res) => json(res, 200, { created: 1, data: [{ b64_json: PNG.toString('base64') }] })
// 解析假上游收到的 multipart 请求体
const formOf = sent => new Request('http://x/', { method: 'POST', headers: { 'content-type': sent.headers['content-type'] }, body: sent.body }).formData()
async function waitFor(check, ms = 5000) {
  const end = performance.now() + ms
  while (!check()) {
    if (performance.now() > end) throw new Error('waitFor timed out')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
// 临时改环境变量，返回还原函数；值为 undefined 表示删除
function setEnv(values) {
  const saved = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]))
  const apply = entries => { for (const [name, value] of Object.entries(entries)) { if (value === undefined) delete process.env[name]; else process.env[name] = value } }
  apply(values)
  return () => apply(saved)
}

describe('配置解析', () => {
  test('规范化 OPENAI_BASE_URL', () => {
    assert.equal(normalizeBaseURL(undefined), 'https://api.openai.com/v1')
    assert.equal(normalizeBaseURL('https://relay.example.com'), 'https://relay.example.com/v1')
    assert.equal(normalizeBaseURL('https://relay.example.com/'), 'https://relay.example.com/v1')
    assert.equal(normalizeBaseURL(' https://relay.example.com/v1/ '), 'https://relay.example.com/v1')
    assert.equal(normalizeBaseURL('https://relay.example.com/openai/v1'), 'https://relay.example.com/openai/v1')
    assert.equal(normalizeBaseURL('https://relay.example.com/v1/images/edits'), 'https://relay.example.com/v1')
    assert.equal(normalizeBaseURL('https://relay.example.com/v1/chat/completions'), 'https://relay.example.com/v1')
    assert.equal(normalizeBaseURL('https://relay.example.com/api/v1?token=x'), 'https://relay.example.com/api/v1')
    assert.throws(() => normalizeBaseURL('ftp://relay.example.com'))
    assert.throws(() => normalizeBaseURL('relay.example.com'))
  })
  test('读取环境变量', () => {
    assert.deepEqual(readImageSetup({}), { status: 'off' })
    assert.deepEqual(readImageSetup({ OPENAI_API_KEY: '  ' }), { status: 'off' })
    assert.deepEqual(readImageSetup({ OPENAI_API_KEY: `Bearer ${KEY}` }), { status: 'ready', apiKey: KEY, baseURL: 'https://api.openai.com/v1', model: 'gpt-image-2', quality: 'high', stream: true })
    assert.equal(readImageSetup({ OPENAI_API_KEY: KEY, OPENAI_IMAGE_STREAM: 'false' }).stream, false)
    assert.equal(readImageSetup({ OPENAI_API_KEY: KEY, OPENAI_IMAGE_STREAM: 'Off' }).stream, false)
    assert.equal(readImageSetup({ OPENAI_API_KEY: KEY, OPENAI_IMAGE_STREAM: 'true' }).stream, true)
    assert.equal(readImageSetup({ OPENAI_API_KEY: KEY, OPENAI_BASE_URL: 'not a url' }).status, 'invalid')
    assert.equal(readImageSetup({ OPENAI_API_KEY: KEY, OPENAI_IMAGE_QUALITY: 'ultra' }).status, 'invalid')
    // 尺寸改由页面上的比例决定，旧的 OPENAI_IMAGE_SIZE 被忽略，不会让配置失效
    assert.equal(readImageSetup({ OPENAI_API_KEY: KEY, OPENAI_IMAGE_SIZE: 'big' }).status, 'ready')
  })
  test('提示词包含风格、构图、姿势、表情、背景和用户描述', () => {
    const base = { ...DEFAULT_OPTIONS }
    assert.match(buildPrompt(base), /collectible figurine[\s\S]*same person[\s\S]*head and shoulders[\s\S]*expression from the photo[\s\S]*#f1efec/)
    assert.doesNotMatch(buildPrompt(base), /Pose:|Proportions:/, '头像构图不写姿势和头身比')
    assert.match(buildPrompt({ ...base, composition: 'full', pose: 'heart', description: '抱着小猫' }), /3\.5 to 4 heads tall[\s\S]*soles of the feet[\s\S]*heart shape[\s\S]*抱着小猫/)
    assert.match(buildPrompt({ ...base, composition: 'full', proportion: 'chibi' }), /exactly 2\.5 heads tall/)
    assert.doesNotMatch(buildPrompt({ ...base, composition: 'full', proportion: 'chibi' }), /3\.5 to 4/)
    assert.doesNotMatch(buildPrompt({ ...base, composition: 'full' }), /Extra details/)
    for (const style of STYLES) assert.ok(buildPrompt({ ...base, style: style.id }).length > 200, style.id)
    assert.match(buildPrompt({ ...base, style: 'pixel', background: 'transparent', expression: 'wink' }), /pixel-art[\s\S]*wink[\s\S]*Transparent background/)
  })
})

describe('只接受本机页面的请求', () => {
  const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers: { host: '127.0.0.1:5173', ...headers } })
  test('按来源地址和 Origin 判断', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.ok(isLocalRequest(req(address)), address)
    // vite --host 时局域网设备能连上，这里是唯一拦住它们的地方
    for (const address of ['192.168.1.20', '::ffff:192.168.1.20', '10.0.0.5', undefined]) assert.ok(!isLocalRequest(req(address)), String(address))
    assert.ok(isLocalRequest(req('127.0.0.1', { origin: 'http://127.0.0.1:5173' })))
    assert.ok(isLocalRequest(req('127.0.0.1', { host: 'localhost:5173', origin: 'http://localhost:5173' })))
    assert.ok(!isLocalRequest(req('127.0.0.1', { origin: 'null' })))
    assert.ok(!isLocalRequest(req('127.0.0.1', { origin: 'http://127.0.0.1:8080' })))
    assert.ok(!isLocalRequest(req('127.0.0.1', { origin: 'https://evil.example' })))
  })
})
describe('GET /api/config', () => {
  test('未配置密钥时为演示模式，配置后报告模型名，且不泄露密钥', async () => {
    const off = await apiServer({})
    const on = await apiServer({ OPENAI_API_KEY: KEY, OPENAI_IMAGE_MODEL: 'gpt-image-2' })
    const bad = await apiServer({ OPENAI_API_KEY: KEY, OPENAI_IMAGE_QUALITY: 'ultra' })
    try {
      assert.deepEqual(await (await fetch(`${off.url}/api/config`)).json(), { enabled: false })
      const response = await fetch(`${on.url}/api/config`)
      const text = await response.text()
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.deepEqual(JSON.parse(text), { enabled: true, model: 'gpt-image-2' })
      assert.ok(!text.includes(KEY))
      const problem = await (await fetch(`${bad.url}/api/config`)).json()
      assert.equal(problem.enabled, false)
      assert.match(problem.problem, /OPENAI_IMAGE_QUALITY/)
      assert.equal((await fetch(`${on.url}/api/config`, { method: 'POST' })).status, 405)
      assert.equal((await fetch(`${on.url}/api/nope`)).status, 404)
    } finally { off.server.close(); on.server.close(); bad.server.close() }
  })
})

describe('POST /api/generate', () => {
  let upstream, api
  before(async () => {
    upstream = await fakeUpstream()
    api = await apiServer({ OPENAI_API_KEY: KEY, OPENAI_BASE_URL: `${upstream.url}/v1`, OPENAI_IMAGE_QUALITY: 'medium', OPENAI_IMAGE_SIZE: '1024x1024' })
  })
  after(async () => {
    for (const { server } of [upstream, api]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  })
  const fresh = reply => { upstream.requests.length = 0; if (reply) upstream.reply = reply }

  test('成功：按 gpt-image-2 的参数转发到 /v1/images/edits，返回 PNG', async () => {
    api.logs.length = 0
    fresh((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-oneapi-request-id': 'req-abc123' })
      res.end(JSON.stringify({ created: 1, data: [{ b64_json: PNG.toString('base64') }], usage: { input_tokens: 10, output_tokens: 20 } }))
    })
    // 用过 OpenAI 的人 shell 里可能有这两个变量；不能被带到中转服务去
    const restore = setEnv({ OPENAI_ORG_ID: 'org-from-shell', OPENAI_PROJECT_ID: 'proj-from-shell' })
    let response
    try { response = await post(api.url, photoForm({ composition: 'full', description: '抱着小猫' })) }
    finally { restore() }
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.failed, 0)
    assert.ok(result.images[0].startsWith('data:image/png;base64,'))
    assert.deepEqual(result.images.map(dataUrlBytes), [PNG])
    assert.equal(upstream.requests.length, 1)
    const sent = upstream.requests[0]
    assert.equal(sent.method, 'POST')
    assert.equal(sent.url, '/v1/images/edits')
    assert.equal(sent.headers.authorization, `Bearer ${KEY}`)
    assert.equal(sent.headers['openai-organization'], undefined)
    assert.equal(sent.headers['openai-project'], undefined)
    assert.match(sent.headers['content-type'], /^multipart\/form-data/)
    const form = await new Request('http://x/', { method: 'POST', headers: { 'content-type': sent.headers['content-type'] }, body: sent.body }).formData()
    assert.equal(form.get('model'), 'gpt-image-2')
    assert.equal(form.get('quality'), 'medium')
    assert.equal(form.get('size'), '1024x1024')
    assert.equal(form.get('output_format'), 'png')
    assert.equal(form.get('n'), '1')
    assert.equal(form.get('stream'), 'true')
    assert.equal(form.get('partial_images'), '2')
    assert.equal(form.get('input_fidelity'), null)
    assert.match(form.get('prompt'), /soles of the feet[\s\S]*抱着小猫/)
    // 单张图用 image 字段（有些中转只认这个名字），不是 image[]
    assert.equal(form.has('image[]'), false)
    const image = form.get('image')
    assert.ok(image instanceof File)
    assert.equal(image.type, 'image/png')
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG)
    assert.ok(api.logs.some(line => line.includes('生成完成 full') && line.includes('输入 10 / 输出 20')))
    // 诊断日志：响应头（带中转的请求 ID，便于在中转后台对照）和读完结果各一行，都在“生成完成”之前
    const headers = api.logs.findIndex(line => line.includes('收到响应头：200 · application/json') && line.includes('x-oneapi-request-id=req-abc123'))
    const body = api.logs.findIndex(line => /读完结果 \d+(\.\d)? (B|KB)，图片在响应里（base64）/.test(line))
    assert.ok(headers >= 0 && body > headers && body < api.logs.findIndex(line => line.includes('生成完成')), api.logs.join('\n'))
    assert.ok(api.logs.every(line => !line.includes(KEY)))
  })

  test('中转服务返回图片链接时由后端下载', async () => {
    fresh((req, res) => {
      if (req.url === '/files/result.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG) }
      json(res, 200, { created: 1, data: [{ url: `${upstream.url}/files/result.png` }] })
    })
    const response = await post(api.url, photoForm())
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).images.map(dataUrlBytes), [PNG])
    // 图片链接常在第三方 CDN 上，下载时不能带密钥
    const fetched = upstream.requests.find(request => request.url === '/files/result.png')
    assert.equal(fetched.headers.authorization, undefined)
  })

  test('图片链接下载失败时给出明确提示', async () => {
    for (const fail of [res => { res.writeHead(404); res.end() }, res => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('not an image') }]) {
      fresh((req, res) => req.url === '/files/result.png' ? fail(res) : json(res, 200, { created: 1, data: [{ url: `${upstream.url}/files/result.png` }] }))
      const response = await post(api.url, photoForm())
      assert.equal(response.status, 502)
      assert.match((await response.json()).error, /下载失败|没有返回可用的图片/)
    }
  })

  test('流式返回：跳过预览图，取最终图片；事件跨数据块也能解析', async () => {
    fresh(sse([
      { type: 'image_edit.partial_image', b64_json: 'cHJldmlldw==', partial_image_index: 0 },
      { type: 'image_edit.completed', b64_json: PNG.toString('base64'), usage: { input_tokens: 7, output_tokens: 9 } },
    ]))
    const response = await post(api.url, photoForm())
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).images.map(dataUrlBytes), [PNG])
    assert.ok(api.logs.some(line => line.includes('流式（预览 1 张）') && line.includes('输入 7 / 输出 9')))
  })

  test('流式错误事件和只有预览图的中断都会报错', async () => {
    fresh(sse([{ type: 'error', error: { code: 'moderation_blocked', message: 'rejected by the safety system' } }]))
    let response = await post(api.url, photoForm())
    assert.equal(response.status, 422)
    assert.match((await response.json()).error, /安全审核/)
    fresh(sse([{ type: 'image_edit.partial_image', b64_json: 'cHJldmlldw==' }]))
    response = await post(api.url, photoForm())
    assert.equal(response.status, 502)
    assert.match((await response.json()).error, /1 张预览图就中断/)
  })

  test('OPENAI_IMAGE_STREAM=false 时不发送流式参数', async () => {
    const plain = await apiServer({ OPENAI_API_KEY: KEY, OPENAI_BASE_URL: upstream.url, OPENAI_IMAGE_STREAM: 'false' })
    try {
      fresh((req, res) => json(res, 200, { created: 1, data: [{ b64_json: PNG.toString('base64') }] }))
      assert.equal((await post(plain.url, photoForm())).status, 200)
      const sent = upstream.requests[0]
      const form = await new Request('http://x/', { method: 'POST', headers: { 'content-type': sent.headers['content-type'] }, body: sent.body }).formData()
      assert.equal(form.get('stream'), null)
      assert.equal(form.get('partial_images'), null)
    } finally { plain.server.close() }
  })

  test('超时：上游不响应或推送一张预览后卡住，都会在时限内返回 504 并释放锁', async () => {
    const quick = await apiServer({ OPENAI_API_KEY: KEY, OPENAI_BASE_URL: upstream.url }, { timeoutMs: 300 })
    // 每种卡住的情况，日志都要写明卡在哪一步、收到了多少字节
    const stalled = pattern => assert.ok(quick.logs.splice(0).some(line => pattern.test(line)), quick.logs.join('\n'))
    try {
      fresh(() => {})
      let response = await post(quick.url, photoForm())
      assert.equal(response.status, 504)
      assert.match((await response.json()).error, /5 分钟/)
      assert.equal(upstream.requests.length, 1, '超时后不能自动重试（会重复扣费）')
      stalled(/在“等中转的响应头”时中断，已收到 0 B/)
      fresh((req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ type: 'image_edit.partial_image', b64_json: 'cHJldmlldw==' })}\n\n`) })
      const started = performance.now()
      response = await post(quick.url, photoForm())
      assert.equal(response.status, 504)
      assert.ok(performance.now() - started < 3000, 'deadline should cover reading the stream body')
      stalled(/在“读取中转返回的结果”时中断，已收到 [1-9]\d* B/)
      fresh((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"created":1,"data":[{"b64_json":"') })
      assert.equal((await post(quick.url, photoForm())).status, 504)
      stalled(/在“读取中转返回的结果”时中断，已收到 34 B/)
      fresh((req, res) => json(res, 200, { created: 1, data: [{ b64_json: PNG.toString('base64') }] }))
      assert.equal((await post(quick.url, photoForm())).status, 200)
    } finally { quick.server.close(); upstream.server.closeAllConnections() }
  })

  test('上游错误翻译成中文提示，不泄露密钥', async () => {
    const cases = [
      [401, { error: { message: `Incorrect API key provided: ${KEY}`, type: 'invalid_request_error', code: 'invalid_api_key' } }, 502, /OPENAI_API_KEY/],
      [404, { error: { message: 'model not found' } }, 502, /OPENAI_BASE_URL/],
      [400, { error: { message: 'Your request was rejected by the safety system.', code: 'moderation_blocked' } }, 422, /安全审核/],
      // 400/403 会把上游原文带给页面，正好检查原文里的密钥有没有遮住
      [400, { error: { message: `Invalid size 999x999 (request key ${KEY})`, param: 'size' } }, 400, /Invalid size[\s\S]*\*\*\*/],
      [403, { error: { message: `Key ${KEY} cannot use gpt-image-2` } }, 502, /拒绝了请求[\s\S]*\*\*\*/],
      [429, { error: { message: 'quota exceeded' } }, 429, /额度/],
      [503, { error: { message: 'overloaded' } }, 502, /模型服务出错/],
      [524, { title: 'Error 524: A timeout occurred' }, 504, /超时断开了（524）[\s\S]*medium/],
      [400, { error: { message: 'stream is not supported for this model' } }, 400, /OPENAI_IMAGE_STREAM=false/],
      [400, { error: { message: 'background transparent is not supported' } }, 400, /透明背景/],
      [200, { created: 1, data: [] }, 502, /没有返回可用的图片/],
      [200, { error: { message: 'relay quota exhausted' } }, 502, /relay quota exhausted/],
    ]
    for (const [upstreamStatus, body, status, message] of cases) {
      fresh((req, res) => json(res, upstreamStatus, body))
      const response = await post(api.url, photoForm())
      const text = await response.text()
      assert.equal(response.status, status, `upstream ${upstreamStatus} → ${text}`)
      assert.match(JSON.parse(text).error, message)
      assert.ok(!text.includes(KEY), `upstream ${upstreamStatus} leaked the key`)
      // maxRetries 为 0：SDK 默认会对 429/5xx/超时重试两次，那样一次点击可能扣三次费
      assert.equal(upstream.requests.length, 1, `upstream ${upstreamStatus} was retried`)
    }
    assert.ok(api.logs.every(line => !line.includes(KEY)))
    // 中转报错时，日志记下状态码和它的请求 ID
    api.logs.length = 0
    fresh((req, res) => { res.writeHead(500, { 'content-type': 'application/json', 'x-oneapi-request-id': 'req-err-9' }); res.end(JSON.stringify({ error: { message: "invalid character 'e'" } })) })
    assert.equal((await post(api.url, photoForm())).status, 502)
    assert.ok(api.logs.some(line => line.includes('中转返回错误：500 · application/json') && line.includes('x-oneapi-request-id=req-err-9')), api.logs.join('\n'))
  })

  test('连不上上游时提示检查地址', async () => {
    const dead = await listen(() => {})
    const deadUrl = dead.url
    dead.server.close()
    const unreachable = await apiServer({ OPENAI_API_KEY: KEY, OPENAI_BASE_URL: deadUrl })
    try {
      const response = await post(unreachable.url, photoForm())
      assert.equal(response.status, 502)
      assert.match((await response.json()).error, /连不上模型服务/)
    } finally { unreachable.server.close() }
  })

  test('校验输入：不合格的请求不会转发给上游', async () => {
    fresh()
    const check = async (response, status, message) => {
      assert.equal(response.status, status)
      assert.match((await response.json()).error, message)
    }
    await check(await post(api.url, photoForm({ photo: Buffer.from('not an image'), type: 'image/png' })), 400, /JPG、PNG 或 WebP/)
    await check(await post(api.url, photoForm({ composition: 'square' })), 400, /构图/)
    await check(await post(api.url, photoForm({ description: '想'.repeat(201) })), 400, /200 字/)
    await check(await post(api.url, 'hello', { 'content-type': 'text/plain' }), 415, /格式/)
    await check(await post(api.url, photoForm({ photo: Buffer.alloc(12 * 1024 * 1024) })), 413, /10 MiB/)
    await check(await fetch(`${api.url}/api/generate`), 405, /POST/)
    assert.equal(upstream.requests.length, 0)
  })

  test('拒绝其他网站发起的跨站请求', async () => {
    fresh()
    const response = await post(api.url, photoForm(), { origin: 'https://evil.example' })
    assert.equal(response.status, 403)
    assert.equal((await fetch(`${api.url}/api/config`, { headers: { origin: 'https://evil.example' } })).status, 403)
    assert.equal(upstream.requests.length, 0)
  })

  test('同一时间只生成一张', async () => {
    let release
    fresh((req, res) => { release = () => json(res, 200, { created: 1, data: [{ b64_json: PNG.toString('base64') }] }) })
    let firstDone = false
    const first = post(api.url, photoForm()).finally(() => { firstDone = true })
    try {
      // 第一张还没到上游就结束（例如校验出错）时立刻失败，而不是一直等下去
      await waitFor(() => release || firstDone)
      assert.ok(release, '第一张请求没有到达上游')
      const second = await post(api.url, photoForm())
      assert.equal(second.status, 429)
    } finally { release?.() }
    assert.equal((await first).status, 200)
  })

  test('改了 .env 后 Vite 重启（新的后端实例），也知道上一张还在生成', async () => {
    let release
    fresh((req, res) => { release = () => json(res, 200, { created: 1, data: [{ b64_json: PNG.toString('base64') }] }) })
    const restarted = await apiServer({ OPENAI_API_KEY: KEY, OPENAI_BASE_URL: `${upstream.url}/v1` })
    let firstDone = false
    const first = post(api.url, photoForm()).finally(() => { firstDone = true })
    try {
      await waitFor(() => release || firstDone)
      assert.ok(release, '第一张请求没有到达上游')
      assert.equal((await post(restarted.url, photoForm())).status, 429)
    } finally { release?.(); restarted.server.close() }
    assert.equal((await first).status, 200)
  })

  test('一次生成多张：每张一个请求；部分失败时返回成功的几张和提示', async () => {
    let calls = 0
    fresh((req, res) => (++calls === 2
      ? json(res, 429, { error: { message: 'rate limited' } })
      : json(res, 200, { created: 1, data: [{ b64_json: PNG.toString('base64') }], usage: { input_tokens: 5, output_tokens: 6 } })))
    const response = await post(api.url, photoForm({ count: 3 }))
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.images.length, 2)
    assert.equal(result.failed, 1)
    assert.match(result.warning, /1 张没有生成成功[\s\S]*额度/)
    assert.equal(upstream.requests.length, 3)
    for (const sent of upstream.requests) assert.equal((await formOf(sent)).get('n'), '1')
    assert.ok(api.logs.some(line => line.includes('3 张') && line.includes('失败 1 张') && line.includes('输入 10 / 输出 12')))
  })

  test('校验创作选项：不认识的风格、比例、数量等直接拒绝', async () => {
    fresh()
    const cases = [['style', 'anime', /风格/], ['ratio', '16:9', /比例/], ['expression', 'angry', /表情/], ['pose', 'fly', /姿势/], ['proportion', 'giant', /头身比/],['background', 'red', /背景/], ['count', '5', /1 到 4/], ['count', '0', /1 到 4/], ['count', '1.5', /1 到 4/]]
    for (const [field, value, message] of cases) {
      const response = await post(api.url, photoForm({ [field]: value }))
      assert.equal(response.status, 400, `${field}=${value}`)
      assert.match((await response.json()).error, message)
    }
    assert.equal(upstream.requests.length, 0)
  })

  test('比例决定尺寸；透明背景带上 background 参数；头像构图不写姿势', async () => {
    fresh(ok())
    assert.equal((await post(api.url, photoForm({ style: 'clay', ratio: 'tall', background: 'transparent', pose: 'jump' }))).status, 200)
    const form = await formOf(upstream.requests[0])
    assert.equal(form.get('size'), '1024x1536')
    assert.equal(form.get('background'), 'transparent')
    assert.match(form.get('prompt'), /claymation[\s\S]*Transparent background/)
    assert.doesNotMatch(form.get('prompt'), /Pose:/)
    fresh(ok())
    assert.equal((await post(api.url, photoForm({ composition: 'full', pose: 'jump', ratio: 'wide', proportion: 'chibi' }))).status, 200)
    const full = await formOf(upstream.requests[0])
    assert.equal(full.get('size'), '1536x1024')
    assert.equal(full.get('background'), null)
    assert.match(full.get('prompt'), /2\.5 heads tall[\s\S]*jumping/)
  })

  test('JPEG 和 WebP 按文件内容识别并转发', async () => {
    for (const [bytes, name, type] of [[JPEG, 'photo.jpg', 'image/jpeg'], [WEBP, 'photo.webp', 'image/webp']]) {
      fresh(ok())
      // 声明的类型故意写错：以文件内容为准
      assert.equal((await post(api.url, photoForm({ photo: bytes, type: 'application/octet-stream', name: 'x.bin' }))).status, 200)
      const image = (await formOf(upstream.requests[0])).get('image')
      assert.equal(image.name, name)
      assert.equal(image.type, type)
      assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes)
    }
  })

  test('描述按页面上的字数计算：换行、emoji 不会多算', async () => {
    const accepted = [
      '想'.repeat(200),
      ('想'.repeat(49) + '\r\n').repeat(4).trim(), // 浏览器提交时换行是 \r\n，页面计数 199
      '🐱'.repeat(200),
    ]
    for (const description of accepted) {
      fresh(ok())
      const response = await post(api.url, photoForm({ description }))
      assert.equal(response.status, 200, `${Array.from(description).length} chars → ${response.status}`)
    }
    fresh()
    assert.equal((await post(api.url, photoForm({ description: '想'.repeat(201) }))).status, 400)
  })

  test('连接被重置时也不重试', async () => {
    fresh(req => req.socket.destroy())
    const response = await post(api.url, photoForm())
    assert.equal(response.status, 502)
    assert.equal(upstream.requests.length, 1)
  })

  test('不是 sk- 开头的中转密钥也会被遮住', async () => {
    const relay = await apiServer({ OPENAI_API_KEY: RELAY_KEY, OPENAI_BASE_URL: upstream.url })
    try {
      fresh((req, res) => json(res, 400, { error: { message: `bad request for key ${RELAY_KEY}` } }))
      const text = await (await post(relay.url, photoForm())).text()
      assert.ok(!text.includes(RELAY_KEY))
      assert.match(text, /\*\*\*/)
      assert.ok(relay.logs.every(line => !line.includes(RELAY_KEY)))
    } finally { relay.server.close() }
  })

  test('上传中途断开也会释放锁', async () => {
    const { port } = new URL(api.url)
    const socket = net.connect(Number(port), '127.0.0.1')
    await once(socket, 'connect')
    socket.write(`POST /api/generate HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: multipart/form-data; boundary=x\r\nContent-Length: 200000\r\n\r\n--x\r\n`)
    await new Promise(resolve => setTimeout(resolve, 100))
    socket.destroy()
    await new Promise(resolve => setTimeout(resolve, 100))
    fresh(ok())
    assert.equal((await post(api.url, photoForm())).status, 200)
  })

  test('超大上传：没有 Content-Length 的分块上传，以及刚好超 1 字节的照片', async () => {
    fresh()
    const chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    const body = new ReadableStream({ pull(controller) { if (sent++ < 12) controller.enqueue(chunk); else controller.close() } })
    const chunked = await fetch(`${api.url}/api/generate`, { method: 'POST', body, duplex: 'half', headers: { 'content-type': 'multipart/form-data; boundary=x' } })
    assert.equal(chunked.status, 413)
    const tooBig = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 + 1 - PNG.length)])
    assert.equal((await post(api.url, photoForm({ photo: tooBig }))).status, 413)
    assert.equal(upstream.requests.length, 0)
  })
})

describe('公网部署的访问控制', () => {
  const CODE = 'open-sesame-42'
  const policy = (extra = {}) => readAccessPolicy({ ACCESS_CODE: CODE, ...extra })
  test('读取配置：没有口令不启用；口令太短或数字不合法时报错', () => {
    assert.equal(readAccessPolicy({}), null)
    assert.deepEqual(policy(), { code: CODE, dailyImages: 20, ipHourly: 6, timeZone: 'Asia/Shanghai' })
    assert.equal(policy({ DAILY_IMAGE_LIMIT: '5', IP_HOURLY_LIMIT: '2' }).dailyImages, 5)
    assert.throws(() => readAccessPolicy({ ACCESS_CODE: '12345' }), /6 个字符/)
    assert.throws(() => policy({ DAILY_IMAGE_LIMIT: '0' }), /DAILY_IMAGE_LIMIT/)
    assert.throws(() => policy({ IP_HOURLY_LIMIT: 'abc' }), /IP_HOURLY_LIMIT/)
  })
  test('只信任本机转发的 X-Real-IP', () => {
    const req = (remoteAddress, ip) => ({ socket: { remoteAddress }, headers: ip ? { 'x-real-ip': ip } : {} })
    assert.equal(clientIp(req('127.0.0.1', '203.0.113.7')), '203.0.113.7')
    assert.equal(clientIp(req('::ffff:127.0.0.1', '203.0.113.7')), '203.0.113.7')
    assert.equal(clientIp(req('198.51.100.2', '203.0.113.7')), '198.51.100.2')
    assert.equal(clientIp(req('127.0.0.1')), '127.0.0.1')
  })

  test('没有口令或口令错误时不读照片、不调用模型；正确口令可以生成', async () => {
    const upstream = await fakeUpstream()
    upstream.reply = ok()
    const access = createAccessGuard(policy())
    const api = await apiServer({ OPENAI_API_KEY: KEY, OPENAI_BASE_URL: `${upstream.url}/v1` }, { access })
    try {
      assert.deepEqual(await (await fetch(`${api.url}/api/config`)).json(), { enabled: true, model: 'gpt-image-2', needsCode: true, remainingToday: 20 })
      const none = await post(api.url, photoForm())
      assert.equal(none.status, 401)
      assert.equal((await none.json()).code, 'bad_code')
      assert.equal((await post(api.url, photoForm(), { 'x-access-code': 'wrong-code-00' })).status, 401)
      assert.equal(upstream.requests.length, 0)
      const good = await post(api.url, photoForm(), { 'x-access-code': ` ${CODE} ` })
      assert.equal(good.status, 200)
      assert.equal(upstream.requests.length, 1)
      assert.equal((await (await fetch(`${api.url}/api/config`)).json()).remainingToday, 19)
      assert.ok(api.logs.some(line => /拒绝 127\.0\.0\.1：访问口令不正确/.test(line)))
      assert.ok(!api.logs.join('\n').includes(CODE), '日志里不出现口令')
    } finally { api.server.close(); upstream.server.close() }
  })

  test('每天总张数和每个 IP 每小时次数用完后拒绝，不调用模型', async () => {
    const upstream = await fakeUpstream()
    upstream.reply = ok()
    let clock = Date.parse('2026-11-17T10:00:00+08:00')
    const access = createAccessGuard(policy({ DAILY_IMAGE_LIMIT: '3', IP_HOURLY_LIMIT: '2' }), { now: () => clock })
    const api = await apiServer({ OPENAI_API_KEY: KEY, OPENAI_BASE_URL: `${upstream.url}/v1` }, { access })
    const send = (count, ip = '203.0.113.7') => post(api.url, photoForm({ count }), { 'x-access-code': CODE, 'x-real-ip': ip })
    try {
      assert.equal((await send(2)).status, 200)
      // 同一 IP 第 3 次：超过每小时 2 次
      assert.equal((await send(1)).status, 200)
      const hourly = await send(1)
      assert.equal(hourly.status, 429)
      assert.match((await hourly.json()).error, /每小时最多生成 2 次/)
      // 换个 IP：每天总共 3 张已经用完
      const daily = await send(1, '198.51.100.9')
      assert.equal(daily.status, 429)
      assert.match((await daily.json()).error, /今天的生成次数已经用完/)
      assert.equal(upstream.requests.length, 3)
      // 第二天额度恢复；一小时后同一 IP 也可以再生成
      clock += 24 * 60 * 60 * 1000
      assert.equal((await send(1)).status, 200)
      // 超过剩余额度的张数会被拒绝，并说明还剩几张
      const tooMany = await send(4, '198.51.100.9')
      assert.equal(tooMany.status, 429)
      assert.match((await tooMany.json()).error, /只剩 2 张/)
    } finally { api.server.close(); upstream.server.close() }
  })

  test('输错口令太多次后，同一 IP 一小时内正确口令也被拒绝', async () => {
    const access = createAccessGuard(policy())
    const req = (code, ip = '203.0.113.7') => ({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': ip, 'x-access-code': code } })
    for (let i = 0; i < 10; i++) assert.equal(access.checkCode(req('nope-nope'))?.status, 401)
    assert.equal(access.checkCode(req(CODE))?.status, 429)
    assert.equal(access.checkCode(req(CODE, '198.51.100.9')), null)
  })

  test('当天已用张数写入文件，重启后仍然计数', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tim-pet-usage-'))
    const usageFile = join(dir, 'data', 'usage.json')
    const now = () => Date.parse('2026-11-17T10:00:00+08:00')
    const req = { socket: { remoteAddress: '127.0.0.1' }, headers: {} }
    try {
      const first = createAccessGuard(policy({ DAILY_IMAGE_LIMIT: '5' }), { usageFile, now })
      assert.equal(first.reserve(req, 3), null)
      const restarted = createAccessGuard(policy({ DAILY_IMAGE_LIMIT: '5' }), { usageFile, now })
      assert.equal(restarted.remainingToday(), 2)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})

describe('未配置时', () => {
  test('POST /api/generate 返回 503', async () => {
    const off = await apiServer({})
    try {
      const response = await post(off.url, photoForm())
      assert.equal(response.status, 503)
      assert.match((await response.json()).error, /OPENAI_API_KEY/)
    } finally { off.server.close() }
  })
})

describe('Vite 开发和预览服务器', () => {
  // 只读临时目录里的测试 .env，并清空进程里的 OPENAI_*：项目 .env 里有真实密钥，绝不能被测试用到。
  test('vite.config.ts 把后端挂在 /api 下（dev 和 preview）', async () => {
    const upstream = await fakeUpstream()
    const dir = await mkdtemp(join(tmpdir(), 'tim-pet-vite-'))
    const restore = setEnv(Object.fromEntries(Object.keys(process.env).filter(name => name.startsWith('OPENAI_')).map(name => [name, undefined])))
    const { createServer, preview } = await import('vite')
    const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url))
    let dev, prev
    try {
      await writeFile(join(dir, '.env'), `OPENAI_API_KEY=${KEY}\nOPENAI_BASE_URL=${upstream.url}\nOPENAI_IMAGE_MODEL=gpt-image-2\nOPENAI_IMAGE_STREAM=false\n`)
      await mkdir(join(dir, 'dist'))
      dev = await createServer({ configFile, envDir: dir, logLevel: 'silent', server: { port: 0, host: '127.0.0.1', strictPort: false } })
      await dev.listen()
      const url = `http://127.0.0.1:${dev.httpServer.address().port}`
      assert.deepEqual(await (await fetch(`${url}/api/config`, { headers: { accept: '*/*' } })).json(), { enabled: true, model: 'gpt-image-2' })
      const response = await post(url, photoForm())
      assert.equal(response.status, 200)
      assert.equal(upstream.requests[0]?.url, '/v1/images/edits')
      const missing = await fetch(`${url}/api/unknown`, { headers: { accept: 'text/html' } })
      assert.equal(missing.status, 404)
      assert.match(missing.headers.get('content-type'), /json/)

      prev = await preview({ configFile, envDir: dir, logLevel: 'silent', build: { outDir: join(dir, 'dist') }, preview: { port: 0, host: '127.0.0.1', strictPort: false } })
      const previewUrl = `http://127.0.0.1:${prev.httpServer.address().port}`
      const config = await fetch(`${previewUrl}/api/config`, { headers: { accept: '*/*' } })
      assert.match(config.headers.get('content-type'), /json/)
      assert.deepEqual(await config.json(), { enabled: true, model: 'gpt-image-2' })
    } finally {
      await dev?.close()
      await prev?.close()
      upstream.server.close()
      restore()
      await rm(dir, { recursive: true, force: true, maxRetries: 3 })
    }
  })
})
