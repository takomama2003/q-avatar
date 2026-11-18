import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, loadEnv, type Plugin, type ResolvedConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
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
function imageApi(): Plugin {
  return {
    name: 'tim-pet-image-api',
    configureServer(server) {
      const env = () => loadEnv(server.config.mode, server.config.envDir, '')
      const log = backendLogger(server.config)
      server.middlewares.use('/api', createImageApi({ env, log }))
      log(describeSetup(readImageSetup(env())))
    },
    configurePreviewServer(server) {
      const env = () => loadEnv(server.config.mode, server.config.envDir, '')
      const log = backendLogger(server.config)
      server.middlewares.use('/api', createImageApi({ env, log }))
      log(describeSetup(readImageSetup(env())))
    },
  }
}

export default defineConfig({ plugins: [vue(), imageApi()] })
