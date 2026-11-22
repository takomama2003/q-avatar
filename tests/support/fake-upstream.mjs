import http from 'node:http'
import { readFileSync } from 'node:fs'
// 假模型：收到生成请求就返回项目里的示例公仔图，不花钱
const png = readFileSync(process.argv[2]).toString('base64')
http.createServer(async (req, res) => {
  for await (const _ of req);
  await new Promise(r => setTimeout(r, 400))
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ created: 1, data: [{ b64_json: png }] }))
}).listen(8796, '127.0.0.1')
