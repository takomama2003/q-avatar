// 命令行应急工具（在服务器上用后端的运行账户执行，让数据库文件归属一致）：
//   sudo -u qavatar node server/admin-cli.ts create-admin <用户名>      建管理员，密码随机生成、只显示一次
//   sudo -u qavatar node server/admin-cli.ts reset-password <用户名>    重置任意账号密码，该账号所有设备下线
//   sudo -u qavatar node server/admin-cli.ts voucher <张数> [--uses N] [--note 备注]
//   sudo -u qavatar node server/admin-cli.ts users
// 平时用网页后台 /admin；这里是后台进不去时的兜底。
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createUser, setPassword, temporaryPassword, usernameKey } from './auth.ts'
import { createVoucher } from './credits.ts'
import { openDb, type Db } from './db.ts'

const USAGE = '用法：node server/admin-cli.ts create-admin <用户名> | reset-password <用户名> | voucher <张数> [--uses N] [--note 备注] | users'
class CliError extends Error {}

export function dbPath() {
  const data = process.env.Q_AVATAR_DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
  return join(data, 'app.db')
}
const flag = (args: string[], name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

export async function runAdminCli(args: string[], db: Db): Promise<string> {
  const [command, ...rest] = args
  const findUser = (name: string | undefined) => {
    const row = name ? db.prepare('SELECT id, username, role FROM users WHERE username_key = ?').get(usernameKey(name)) as { id: number; username: string; role: string } | undefined : undefined
    if (!row) throw new CliError(`没有叫“${name ?? ''}”的账号。`)
    return row
  }
  switch (command) {
    case 'create-admin': {
      const name = rest[0]
      if (!name) throw new CliError(USAGE)
      const existing = db.prepare('SELECT id, role FROM users WHERE username_key = ?').get(usernameKey(name)) as { id: number; role: string } | undefined
      const password = temporaryPassword()
      if (existing) {
        db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id)
        await setPassword(db, existing.id, password)
        return `已把“${name}”设为管理员，并重置了密码。\n临时密码：${password}\n（只显示这一次；登录后请尽快改成自己的密码）`
      }
      try { await createUser(db, name, password, 'admin') } catch (error) { throw new CliError((error as Error).message) }
      return `已创建管理员：${name}\n临时密码：${password}\n（只显示这一次；登录后请尽快改成自己的密码）`
    }
    case 'reset-password': {
      const user = findUser(rest[0])
      const password = temporaryPassword()
      await setPassword(db, user.id, password)
      return `已重置 ${user.username} 的密码，这个账号所有设备已下线。\n临时密码：${password}\n（只显示这一次）`
    }
    case 'voucher': {
      const credits = Number(rest[0])
      const uses = flag(rest, '--uses')
      try {
        const created = createVoucher(db, { credits, maxUses: uses === undefined ? 1 : Number(uses), note: flag(rest, '--note') ?? '' })
        return `已创建兑换码 #${created.id}：${credits} 张 × ${uses ?? 1} 次\n兑换码：${created.code}\n（只显示这一次）`
      } catch (error) { throw new CliError((error as Error).message) }
    }
    case 'users': {
      const rows = db.prepare(`SELECT u.username, u.role, u.status, u.created_at,
        COALESCE((SELECT SUM(delta) FROM credit_ledger WHERE user_id = u.id), 0) AS balance FROM users u ORDER BY u.id`).all() as
        { username: string; role: string; status: string; created_at: string; balance: number }[]
      if (!rows.length) return '还没有账号。'
      return ['用户名\t角色\t状态\t余额\t注册时间', ...rows.map(r => [r.username, r.role, r.status === 'active' ? '正常' : '已停用', r.balance, r.created_at.slice(0, 10)].join('\t'))].join('\n')
    }
    default:
      throw new CliError(USAGE)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const db = openDb(dbPath())
  try {
    console.log(await runAdminCli(process.argv.slice(2), db))
  } catch (error) {
    console.error(error instanceof CliError ? error.message : error)
    process.exitCode = 1
  } finally {
    db.close()
  }
}
