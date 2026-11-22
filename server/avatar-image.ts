// 用户上传的头像：只收浏览器裁好、缩小后重新编码的 PNG（64–512 像素见方，最大 300 KiB）。
// 按文件内容核对格式和尺寸，再只保留解码必需的数据块重新拼一份：拍摄地点、相机信息、文字注释等元数据都会被丢掉。
export const MAX_AVATAR_BYTES = 300 * 1024
const MIN_SIDE = 64
const MAX_SIDE = 512
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// PNG 里解码必需的块；其余（tEXt、iTXt、zTXt、eXIf、tIME 等）一律丢掉
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'])

export type CleanAvatar = { mime: 'image/png'; bytes: Buffer; width: number; height: number }
type Problem = { error: string }

const sizeProblem = (width: number, height: number): Problem | null => {
  if (width !== height) return { error: '头像要是正方形的图片。' }
  if (width < MIN_SIDE || width > MAX_SIDE) return { error: `头像的边长要在 ${MIN_SIDE} 到 ${MAX_SIDE} 像素之间。` }
  return null
}

function cleanPng(input: Buffer): CleanAvatar | Problem {
  const parts: Buffer[] = [PNG_SIGNATURE]
  let width = 0, height = 0, offset = 8, sawIdat = false, ended = false
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset)
    const type = input.subarray(offset + 4, offset + 8).toString('latin1')
    const end = offset + 12 + length
    if (end > input.length) return { error: '图片文件不完整，请重新选择。' }
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13) return { error: '不是有效的 PNG 图片。' }
      width = input.readUInt32BE(offset + 8)
      height = input.readUInt32BE(offset + 12)
    }
    if (type === 'IDAT') sawIdat = true
    if (PNG_KEEP.has(type)) parts.push(input.subarray(offset, end))
    offset = end
    if (type === 'IEND') { ended = true; break }
  }
  if (!width || !sawIdat || !ended) return { error: '不是有效的 PNG 图片。' }
  return sizeProblem(width, height) ?? { mime: 'image/png', bytes: Buffer.concat(parts), width, height }
}

export function cleanAvatar(input: Buffer): CleanAvatar | Problem {
  if (input.length > MAX_AVATAR_BYTES) return { error: '头像图片太大了，请换一张或缩小后再试。' }
  if (input.length >= 8 && input.subarray(0, 8).equals(PNG_SIGNATURE)) return cleanPng(input)
  return { error: '头像图片格式不对，请重新选择一张图片。' }
}
