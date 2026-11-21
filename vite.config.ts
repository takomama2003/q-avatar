import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, loadEnv, type Connect, type Plugin, type ResolvedConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createApp } from './server/app'
import { openDb } from './server/db'
import { createImageApi, describeSetup, readImageSetup } from './server/image-api'

// 后端日志同时写到终端和 logs/image-api.log（本地时间，便于和中转后台的记录对照）。
// 日志放在 .env 所在的目录下：测试用临时目录当 envDir，就不会写进项目里。日志里的密钥已在 image-api 里遮住。
function backendLogger(config: ResolvedConfig) {
  const dir = join(config.envDir || config.root, 'logs')
  const file = join(dir, 'image-api.log')
  return (message: string) => {
    config.logger.info(message, { timestamp: true })
    try {
      mkdirSync(dir, { recursive: true })
      appendFileSync(file, `${new Date().toLocaleString('sv-SE')} ${message}\n`)
    } catch (error) {
      config.logger.warn(`[image-api] 写日志文件失败：${(error as Error).message}`)
    }
  }
}

// 本地后端：在开发和预览服务器上挂载 /api。每次请求重新读取 .env，改完配置刷新页面即可生效。
// .env 里加 ACCOUNTS=1 时挂完整的账号后端（注册登录、额度、后台），数据存在 .local/app.db，和线上无关。
function imageApi(): Plugin {
  const mount = (config: ResolvedConfig, use: (handler: Connect.NextHandleFunction) => void) => {
    const env = () => loadEnv(config.mode, config.envDir, '')
    const log = backendLogger(config)
    if (env().ACCOUNTS === '1') {
      const db = openDb(join(config.envDir || config.root, '.local', 'app.db'))
      const app = createApp({ db, env, log, secureCookie: false })
      use((req, res) => void app(req, res))
      log(`[accounts] 本地账号后端已开启，数据在 .local/app.db。建管理员：Q_AVATAR_DATA_DIR=.local node server/admin-cli.ts create-admin <用户名>`)
    } else {
      use(createImageApi({ env, log }) as Connect.NextHandleFunction)
    }
    log(describeSetup(readImageSetup(env())))
  }
  return {
    name: 'tim-pet-image-api',
    configureServer(server) { mount(server.config, handler => server.middlewares.use('/api', handler)) },
    configurePreviewServer(server) { mount(server.config, handler => server.middlewares.use('/api', handler)) },
  }
}

export default defineConfig({ plugins: [vue(), imageApi()] })
