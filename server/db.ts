// v0.2 数据库：用户、会话、兑换码、额度流水、生成记录、管理员操作记录，都在 data/app.db 一个文件里。
// 用 Node 24 自带的 node:sqlite，不另装数据库服务。表结构按 user_version 编号迁移，以后加字段往 MIGRATIONS 末尾追加。
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const MIGRATIONS: string[] = [
  // 1：v0.2.0 初始结构
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    username_key TEXT NOT NULL UNIQUE,          -- 小写后的用户名，用来判断重名和登录
    password_hash TEXT NOT NULL,                -- scrypt$N$r$p$盐$哈希
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,                -- 只存令牌的 SHA-256，令牌原文只在用户的 Cookie 里
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE vouchers (
    id INTEGER PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,             -- 兑换码的 SHA-256，原文只在创建时显示一次
    note TEXT NOT NULL DEFAULT '',
    credits INTEGER NOT NULL CHECK (credits > 0), -- 每次兑换给多少张
    max_uses INTEGER NOT NULL CHECK (max_uses > 0),
    used_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id)
  );
  CREATE TABLE redemptions (
    voucher_id INTEGER NOT NULL REFERENCES vouchers(id),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redeemed_at TEXT NOT NULL,
    PRIMARY KEY (voucher_id, user_id)          -- 同一个人不能重复兑换同一个码
  );
  CREATE TABLE credit_ledger (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta INTEGER NOT NULL,                     -- 正数加额度，负数扣额度
    reason TEXT NOT NULL CHECK (reason IN ('redeem', 'generate', 'refund', 'admin')),
    voucher_id INTEGER REFERENCES vouchers(id),
    generation_id INTEGER REFERENCES generations(id),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX ledger_user ON credit_ledger(user_id);
  CREATE TABLE generations (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    style TEXT NOT NULL,
    composition TEXT NOT NULL,
    requested INTEGER NOT NULL,
    succeeded INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    refunded INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
    error TEXT NOT NULL DEFAULT ''              -- 错误摘要；不存照片、生成的图片和用户描述
  );
  CREATE INDEX generations_user ON generations(user_id, created_at);
  CREATE INDEX generations_time ON generations(created_at);
  CREATE TABLE admin_log (
    id INTEGER PRIMARY KEY,
    admin_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  `,
  // 2：v0.2.0 额度申请。用户在“我的账户”提交，管理员在后台批准（直接加额度）或拒绝。
  `
  CREATE TABLE credit_requests (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL CHECK (amount > 0),     -- 用户想要的张数
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    granted INTEGER,                                  -- 批准时实际给的张数（可以和申请的不一样）
    reply TEXT NOT NULL DEFAULT '',                   -- 管理员的回复，用户能看到
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by INTEGER REFERENCES users(id)
  );
  CREATE INDEX credit_requests_status ON credit_requests(status, created_at);
  -- 每个人同时只能有一个待处理的申请
  CREATE UNIQUE INDEX credit_requests_one_pending ON credit_requests(user_id) WHERE status = 'pending';
  `,
  // 3：v0.2.0 改成只用兑换码买张数，去掉额度申请；加上用户自选的公仔头像（只存编号，见 shared/avatars.ts）。
  `
  DROP TABLE IF EXISTS credit_requests;
  ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT '';
  `,
  // 4：v0.2.0 用户自己上传的头像（浏览器裁成正方形、缩小后重新编码的 PNG，最大 300 KiB，见 server/avatar-image.ts）。每人一张，换回内置头像时删除。
  // users.avatar 为 'upload' 时用这张图。
  `
  CREATE TABLE user_avatars (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    mime TEXT NOT NULL CHECK (mime = 'image/png'),
    bytes BLOB NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
]

export type Db = DatabaseSync

export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  migrate(db)
  return db
}

function migrate(db: Db) {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  for (let version = current; version < MIGRATIONS.length; version++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version])
      db.exec(`PRAGMA user_version = ${version + 1}`)
    })
  }
}

// 同步事务：node:sqlite 是同步接口，事务里不能有 await，正好保证扣额度时不会被别的请求插进来。
export function transaction<T>(db: Db, work: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export const nowIso = (now = Date.now()) => new Date(now).toISOString()

// 在线备份：VACUUM INTO 生成一份一致的副本，不用停服务。
export function backupTo(db: Db, file: string) {
  mkdirSync(dirname(file), { recursive: true })
  db.prepare('VACUUM INTO ?').run(file)
}
