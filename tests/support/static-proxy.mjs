import http from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
// 模拟 nginx：发 dist/ 静态文件，/api 转发给本机 8795 的正式后端
const dist = process.argv[2]
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml' }
http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const up = http.request({ host: '127.0.0.1', port: 8795, path: req.url, method: req.method, headers: { ...req.headers, 'x-real-ip': '203.0.113.50' } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
    return void req.pipe(up)
  }
  const path = req.url.split('?')[0]
  const file = join(dist, path)
  const target = path !== '/' && existsSync(file) ? file : join(dist, 'index.html')
  res.writeHead(200, { 'content-type': types[extname(target)] ?? 'application/octet-stream' })
  res.end(readFileSync(target))
}).listen(8794, '127.0.0.1')
