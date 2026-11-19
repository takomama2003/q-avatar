// 公网部署的后端入口：只提供 /api（网页由 nginx 直接发 dist/），只监听本机，由 nginx 转发。
// 运行：node server/production.ts（Node 22.18+ 或 24 可以直接运行 .ts）
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAccessGuard, readAccessPolicy } from './access.ts'
import { codesPath, codeUsagePath, dataDir } from './codes.ts'
import { createImageApi, describeSetup, readImageSetup } from './image-api.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envFile = join(root, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const logFile = join(root, 'logs', 'image-api.log')
function log(message: string) {
  const line = `${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })} ${message}`
  console.log(line)
  try {
    mkdirSync(dirname(logFile), { recursive: true })
    appendFileSync(logFile, `${line}\n`)
  } catch (error) {
    console.error(`[image-api] 写日志文件失败：${(error as Error).message}`)
  }
}

const setup = readImageSetup(process.env)
let policy
try { policy = readAccessPolicy(process.env) }
catch (error) { console.error(`[production] ${(error as Error).message}`); process.exit(1) }
// 公网上开了真实生成却没有口令，谁都能花钱：直接拒绝启动。
if (setup.status === 'ready' && !policy) {
  console.error('[production] 已配置 OPENAI_API_KEY，但没有设置 ACCESS_CODE。公网部署必须设置访问口令，拒绝启动。')
  process.exit(1)
}

// 数据目录默认是项目下的 data/；本地试跑时可以用 Q_AVATAR_DATA_DIR 指到临时目录。
const data = dataDir()
const access = policy ? createAccessGuard(policy, { usageFile: join(data, 'usage.json'), codesFile: codesPath(data), codeUsageFile: codeUsagePath(data) }) : undefined
const api = createImageApi({ env: () => process.env, log, access })

const port = Number(process.env.PORT ?? 8787)
const server = http.createServer((req, res) => {
  const url = req.url ?? '/'
  if (url === '/api' || url.startsWith('/api/') || url.startsWith('/api?')) {
    req.url = url.slice(4) || '/'
    return void api(req, res)
  }
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ error: '接口不存在。' }))
})
// 生成最长 5 分钟，留出余量；默认的请求超时会提前断开上传。
server.requestTimeout = 6 * 60 * 1000
server.listen(port, '127.0.0.1', () => {
  log(describeSetup(setup))
  if (policy) log(`[production] 访问控制已开启：每天最多 ${policy.dailyImages} 张，每个 IP 每小时最多 ${policy.ipHourly} 次，今天还剩 ${access?.remainingToday()} 张。`)
  log(`[production] 后端已启动：http://127.0.0.1:${port}/api`)
})
