// AI 生成内容的隐式标识：在模型返回的 PNG 里写入文本块，说明这是 AI 生成的、由哪个服务生成。
// 下载的文件、画廊里存的都是这一份。页面上另有“AI 生成”角标作为显式标识。
// 只处理 PNG（服务端固定要求 output_format=png）；不是 PNG 时原样返回。
import { crc32 } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

// iTXt 支持 UTF-8，中文说明不会乱码
const itxt = (keyword: string, text: string) => chunk('iTXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0, 0, 0, 0, 0]), Buffer.from(text, 'utf8')]))

export function labelPng(bytes: Uint8Array, meta: { site: string; at: Date }): Uint8Array {
  const png = Buffer.from(bytes)
  if (png.length < 33 || !png.subarray(0, 8).equals(SIGNATURE)) return bytes
  // 第一个块必须是 IHDR，文本块放在它后面
  const ihdrEnd = 8 + 12 + png.readUInt32BE(8)
  if (png.subarray(12, 16).toString('latin1') !== 'IHDR' || ihdrEnd > png.length) return bytes
  const labels = Buffer.concat([
    itxt('Description', `AI 生成内容：本图片由 ${meta.site} 使用人工智能模型根据用户上传的照片生成。`),
    itxt('Software', meta.site),
    itxt('Creation Time', meta.at.toISOString()),
    itxt('AIGC', JSON.stringify({ Label: 'AI-generated', ContentProducer: meta.site, ProduceTime: meta.at.toISOString() })),
  ])
  return Buffer.concat([png.subarray(0, ihdrEnd), labels, png.subarray(ihdrEnd)])
}
