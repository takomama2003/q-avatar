// 公网部署的后端入口：只提供 /api（网页由 nginx 直接发 dist/），只监听本机，由 nginx 转发。
// 运行：node server/production.ts（Node 22.18+ 或 24 可以直接运行 .ts）
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.ts'
import { DEFAULT_DAILY_LIMIT } from './credits.ts'
import { backupTo, openDb } from './db.ts'
import { describeSetup, generationsRunning, readImageSetup } from './image-api.ts'

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

const dailyRaw = process.env.DAILY_IMAGE_LIMIT?.trim()
const dailyLimit = dailyRaw ? Number(dailyRaw) : DEFAULT_DAILY_LIMIT
if (!Number.isInteger(dailyLimit) || dailyLimit < 1) {
  console.error('[production] DAILY_IMAGE_LIMIT 必须是正整数。')
  process.exit(1)
}

// 数据目录默认是项目下的 data/；本地试跑时可以用 Q_AVATAR_DATA_DIR 指到临时目录。
const data = process.env.Q_AVATAR_DATA_DIR || join(root, 'data')
const db = openDb(join(data, 'app.db'))
// 本地试跑走 http，Cookie 不能带 Secure；线上走 https 时保持默认。
const secureCookie = process.env.COOKIE_SECURE !== 'false'
const api = createApp({ db, env: () => process.env, log, dailyLimit, secureCookie })

// 每天备份一次数据库，保留 7 天
const backups = join(data, 'backups')
function backupDaily() {
  try {
    const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
    const file = join(backups, `app-${day}.db`)
    if (!existsSync(file)) {
      backupTo(db, file)
      log(`[backup] 已备份数据库 ${file}`)
    }
    const old = readdirSync(backups).filter(name => /^app-\d{4}-\d{2}-\d{2}\.db$/.test(name)).sort().slice(0, -7)
    for (const name of old) rmSync(join(backups, name))
  } catch (error) {
    log(`[backup] 备份失败：${(error as Error).message}`)
  }
}
backupDaily()
setInterval(backupDaily, 60 * 60 * 1000).unref()

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
  log(describeSetup(readImageSetup(process.env)))
  const admins = Number((db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n)
  log(`[production] 账号系统已开启：全站每天最多 ${dailyLimit} 张；管理员 ${admins} 个${admins ? '' : '（用 node server/admin-cli.ts create-admin 建一个）'}。`)
  log(`[production] 后端已启动：http://127.0.0.1:${port}/api`)
})
// 重启或部署时：先不再接新请求，等正在进行的生成跑完（最多 6 分钟，和生成时限一致）再关数据库。
// 否则用户已经付费的图片会因为记账时数据库已关闭而丢掉。
let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  log(`[production] 收到 ${signal}，等待 ${generationsRunning()} 个进行中的生成结束后退出`)
  server.close()
  const deadline = Date.now() + 6 * 60 * 1000
  while (generationsRunning() > 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500))
  db.close()
  process.exit(0)
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown(signal))
