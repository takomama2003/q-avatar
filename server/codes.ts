// 邀请码管理（在服务器上运行，用后端的运行账户，让文件归属一致）：
//   sudo -u qavatar node server/codes.ts add 小王 --quota 10
//   sudo -u qavatar node server/codes.ts list
//   sudo -u qavatar node server/codes.ts quota 小王 20
//   sudo -u qavatar node server/codes.ts disable 小王   （enable 恢复）
// 邀请码原文只在 add 时显示一次；文件里只存 SHA-256。后端会自动读取修改，不用重启。
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateCode, hashCode, readJson, writeJsonAtomic, type CodeRecord, type CodesFile, type CodeUsage } from './access.ts'

export function dataDir() {
  return process.env.Q_AVATAR_DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
}
export const codesPath = (dir = dataDir()) => join(dir, 'codes.json')
export const codeUsagePath = (dir = dataDir()) => join(dir, 'code-usage.json')

const DEFAULT_QUOTA = 10
const USAGE = '用法：node server/codes.ts add <名字> [--quota 张数] | list | quota <名字> <张数> | disable <名字> | enable <名字>'

class CliError extends Error {}

function quotaOf(raw: string | undefined) {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > 100_000) throw new CliError('张数必须是 0 到 100000 之间的整数。')
  return value
}
function nameOf(raw: string | undefined) {
  const name = raw?.trim() ?? ''
  if (!name || Array.from(name).length > 32 || /[\u0000-\u001f\u007f]/.test(name)) throw new CliError('名字不能为空，最多 32 个字，不能包含控制字符。')
  return name
}

// 返回要打印的文字；出错抛 CliError。写成函数方便测试。
export function runCodes(args: string[], dir = dataDir(), now = () => new Date()): string {
  const [command, ...rest] = args
  const file = readJson<CodesFile>(codesPath(dir)) ?? { codes: [] }
  const usage = readJson<CodeUsage>(codeUsagePath(dir)) ?? {}
  const find = (name: string) => {
    const record = file.codes.find(item => item.name === name)
    if (!record) throw new CliError(`没有叫“${name}”的邀请码。用 list 查看全部。`)
    return record
  }
  const save = () => writeJsonAtomic(codesPath(dir), file)

  switch (command) {
    case 'add': {
      const name = nameOf(rest[0])
      const flag = rest.indexOf('--quota')
      const quota = flag >= 0 ? quotaOf(rest[flag + 1]) : DEFAULT_QUOTA
      if (file.codes.some(item => item.name === name)) throw new CliError(`已经有叫“${name}”的邀请码了，换个名字，或用 quota 改额度。`)
      const code = generateCode()
      const record: CodeRecord = { name, hash: hashCode(code), quota, createdAt: now().toISOString() }
      file.codes.push(record)
      save()
      return `已创建：${name}，总额度 ${quota} 张\n邀请码：${code}\n（只显示这一次，请现在复制给对方）`
    }
    case 'list': {
      if (!file.codes.length) return '还没有邀请码。用 add 创建。'
      const rows = file.codes.map(record => {
        const used = usage[record.hash]?.used ?? 0
        const last = usage[record.hash]?.lastUsedAt
        return [
          record.name,
          String(record.quota),
          String(used),
          String(Math.max(0, record.quota - used)),
          record.disabled ? '已停用' : '正常',
          last ? new Date(last).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }) : '从未使用',
        ].join('\t')
      })
      return ['名字\t总额度\t已用\t剩余\t状态\t最近使用', ...rows].join('\n')
    }
    case 'quota': {
      const record = find(nameOf(rest[0]))
      record.quota = quotaOf(rest[1])
      save()
      const used = usage[record.hash]?.used ?? 0
      return `${record.name} 的总额度改为 ${record.quota} 张（已用 ${used}，剩余 ${Math.max(0, record.quota - used)}）`
    }
    case 'disable':
    case 'enable': {
      const record = find(nameOf(rest[0]))
      record.disabled = command === 'disable'
      save()
      return `${record.name} 已${record.disabled ? '停用' : '恢复'}`
    }
    default:
      throw new CliError(USAGE)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log(runCodes(process.argv.slice(2)))
  } catch (error) {
    console.error(error instanceof CliError ? error.message : error)
    process.exit(1)
  }
}
