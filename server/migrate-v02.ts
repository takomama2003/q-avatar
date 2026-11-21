// 一次性迁移：v0.1 的邀请码（data/codes.json + data/code-usage.json）变成 v0.2 的兑换码。
// 哈希不变，所以小王、小李输入手里原来的码就能兑换；额度 = 原来的剩余张数，只能兑换 1 次。
// 运行前先备份 data/；重复运行不会重复创建（已存在的哈希会跳过）。
//   sudo -u qavatar node server/migrate-v02.ts
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createVoucher } from './credits.ts'
import { openDb, type Db } from './db.ts'

type OldCode = { name: string; hash: string; quota: number; disabled?: boolean }
type OldUsage = Record<string, { used: number }>

// v0.1 的邀请码哈希是 sha256(原文去空格)；v0.2 的兑换码哈希是 sha256(原文去空格后转小写)。
// 旧码由小写字母、数字和连字符组成，两种算法结果一样，可以直接沿用。
export function migrateCodes(db: Db, dataDir: string) {
  const read = <T>(name: string): T | null => {
    const file = join(dataDir, name)
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : null
  }
  const codes = read<{ codes: OldCode[] }>('codes.json')?.codes ?? []
  const usage = read<OldUsage>('code-usage.json') ?? {}
  const lines: string[] = []
  for (const code of codes) {
    const left = Math.max(0, code.quota - (usage[code.hash]?.used ?? 0))
    if (db.prepare('SELECT 1 FROM vouchers WHERE code_hash = ?').get(code.hash)) { lines.push(`跳过 ${code.name}：已经迁移过`); continue }
    if (code.disabled) { lines.push(`跳过 ${code.name}：v0.1 里已停用`); continue }
    if (!left) { lines.push(`跳过 ${code.name}：额度已经用完`); continue }
    createVoucher(db, { credits: left, maxUses: 1, note: `v0.1 邀请码 · ${code.name}`, codeHash: code.hash })
    lines.push(`已迁移 ${code.name}：兑换码可领 ${left} 张，原来的邀请码直接兑换`)
  }
  return lines.length ? lines : ['没有 v0.1 的邀请码需要迁移。']
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const data = process.env.Q_AVATAR_DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
  const backup = join(data, `before-v02-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(backup, { recursive: true })
  for (const name of ['codes.json', 'code-usage.json', 'usage.json', 'app.db']) {
    if (existsSync(join(data, name))) copyFileSync(join(data, name), join(backup, name))
  }
  console.log(`已备份到 ${backup}`)
  const db = openDb(join(data, 'app.db'))
  try { for (const line of migrateCodes(db, data)) console.log(line) }
  finally { db.close() }
}
