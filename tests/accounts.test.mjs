// v0.2 账号系统测试：注册登录、会话、兑换码、额度扣减与退回、管理后台、迁移。
// 每个测试用内存数据库和本地假模型服务，不调用真实接口，不花钱。运行：npm run test:server
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import { runAdminCli } from '../server/admin-cli.ts'
import { createApp } from '../server/app.ts'
import { createUser, hashPassword, verifyPassword } from '../server/auth.ts'
import { beijingDayStart, createVoucher, hashCode } from '../server/credits.ts'
import { openDb } from '../server/db.ts'
import { AVATARS } from '../shared/avatars.ts'
import { migrateCodes } from '../server/migrate-v02.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const KEY = 'sk-test-0123456789abcdefghij'
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }

async function listen(handler) {
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}

// 一套完整环境：内存数据库 + 假模型服务 + 挂在 /api 下的后端；client 自动保存 Cookie，像一个浏览器。
async function setup({ dailyLimit, now, reply } = {}) {
  const requests = []
  const upstream = await listen(async (req, res) => {
    for await (const _ of req);
    requests.push(req.url)
    ;(upstream.reply ?? ((q, s) => json(s, 200, { created: 1, data: [{ b64_json: PNG.toString('base64') }] })))(req, res)
  })
  upstream.reply = reply
  const db = openDb(':memory:')
  const logs = []
  const app = createApp({ db, env: () => ({ OPENAI_API_KEY: KEY, OPENAI_BASE_URL: `${upstream.url}/v1` }), log: line => logs.push(line), dailyLimit, now, secureCookie: false, timeoutMs: 400 })
  const api = await listen((req, res) => { req.url = req.url.replace(/^\/api/, '') || '/'; app(req, res) })
  const client = (ip = '203.0.113.7') => {
    let cookie = ''
    const call = async (path, { method = 'GET', body, form, headers = {} } = {}) => {
      const init = { method, headers: { 'x-real-ip': ip, ...(cookie ? { cookie } : {}), ...headers } }
      if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json' }
      if (form) init.body = form
      const response = await fetch(`${api.url}/api${path}`, init)
      const set = response.headers.get('set-cookie')
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]
      return { status: response.status, body: await response.json().catch(() => null), setCookie: set }
    }
    return {
      call,
      get cookie() { return cookie },
      set cookie(value) { cookie = value },
      register: (username, password = 'password123') => call('/auth/register', { method: 'POST', body: { username, password, privacyAccepted: true } }),
      login: (username, password = 'password123') => call('/auth/login', { method: 'POST', body: { username, password } }),
      generate: (count = 1) => { const form = new FormData(); form.append('photo', new Blob([PNG], { type: 'image/png' }), 'p.png'); form.append('count', String(count)); return call('/generate', { method: 'POST', form }) },
      redeem: code => call('/account/redeem', { method: 'POST', body: { code } }),
      upload: bytes => call('/account/avatar/upload', { method: 'POST', form: new Blob([bytes], { type: 'image/png' }), headers: { 'content-type': 'image/png' } }),
    }
  }
  const close = () => { upstream.server.closeAllConnections(); upstream.server.close(); api.server.close(); db.close() }
  return { db, logs, upstream, requests, client, close, url: api.url }
}
const balance = (db, username) => Number(db.prepare("SELECT COALESCE(SUM(delta),0) n FROM credit_ledger l JOIN users u ON u.id = l.user_id WHERE u.username = ?").get(username).n)

describe('注册和登录', () => {
  test('注册：校验用户名和密码、要同意隐私说明、不能重名（不区分大小写）', async () => {
    const env = await setup()
    try {
      const c = env.client()
      assert.equal((await c.call('/auth/register', { method: 'POST', body: { username: 'ab', password: 'password123', privacyAccepted: true } })).status, 400)
      assert.equal((await c.call('/auth/register', { method: 'POST', body: { username: 'tim_one', password: 'short', privacyAccepted: true } })).status, 400)
      assert.equal((await c.call('/auth/register', { method: 'POST', body: { username: 'bad name', password: 'password123', privacyAccepted: true } })).status, 400)
      assert.match((await c.call('/auth/register', { method: 'POST', body: { username: 'tim_one', password: 'password123' } })).body.error, /用户协议/)
      const ok = await c.register('Tim_One')
      assert.equal(ok.status, 200)
      assert.deepEqual({ ...ok.body.user, avatar: undefined }, { username: 'Tim_One', role: 'user', credits: 0, avatar: undefined })
      assert.ok(AVATARS.includes(ok.body.user.avatar))
      assert.match(ok.setCookie, /HttpOnly/)
      assert.match(ok.setCookie, /SameSite=Lax/)
      assert.equal((await env.client('198.51.100.1').register('tim_one')).status, 409)
      // 注册后已经登录
      assert.equal((await c.call('/auth/me')).body.user.username, 'Tim_One')
      // 中文用户名可以用
      assert.equal((await env.client('198.51.100.2').register('小王同学')).status, 200)
    } finally { env.close() }
  })

  test('密码只存哈希；数据库和日志里没有密码和会话令牌原文', async () => {
    const env = await setup()
    try {
      const c = env.client()
      await c.register('alice_01', 'my-secret-pass')
      const row = env.db.prepare('SELECT password_hash FROM users').get()
      assert.match(row.password_hash, /^scrypt\$/)
      assert.ok(await verifyPassword('my-secret-pass', row.password_hash))
      assert.ok(!(await verifyPassword('wrong-pass-00', row.password_hash)))
      const token = c.cookie.split('=')[1]
      const dump = JSON.stringify(env.db.prepare('SELECT * FROM sessions').all()) + JSON.stringify(env.db.prepare('SELECT * FROM users').all())
      for (const secret of ['my-secret-pass', token]) {
        assert.ok(!dump.includes(secret), '数据库里不应有原文')
        assert.ok(!env.logs.join('\n').includes(secret), '日志里不应有原文')
      }
    } finally { env.close() }
  })

  test('登录：错误密码、用户名不存在提示相同；同一账号连续输错会锁定；退出后令牌失效', async () => {
    const env = await setup()
    try {
      await env.client().register('bob_0001')
      const c = env.client('198.51.100.3')
      const wrong = await c.login('bob_0001', 'wrong-password')
      const missing = await c.login('nobody_00', 'wrong-password')
      assert.equal(wrong.status, 401)
      assert.equal(missing.body.error, wrong.body.error)
      // 同一个网络里连续输错 8 次后锁定，锁定期间正确密码也不行
      for (let i = 0; i < 7; i++) await c.login('bob_0001', 'wrong-password')
      assert.equal((await c.login('bob_0001')).status, 429, '锁定期间正确密码也不行')
      // 另一个账号不受影响
      await env.client('198.51.100.60').register('carol_01')
      const d = env.client('198.51.100.61')
      assert.equal((await d.login('CAROL_01')).status, 200, '登录不区分大小写')
      const saved = d.cookie
      assert.equal((await d.call('/auth/logout', { method: 'POST', body: {} })).status, 200)
      d.cookie = saved
      assert.equal((await d.call('/auth/me')).status, 401, '退出后旧令牌失效')
    } finally { env.close() }
  })

  test('会话 30 天不活动过期；停用的账号立即下线、不能登录', async () => {
    let clock = Date.parse('2026-11-21T10:00:00Z')
    const env = await setup({ now: () => clock })
    try {
      const c = env.client()
      await c.register('dave_001')
      clock += 29 * 86400_000
      assert.equal((await c.call('/auth/me')).status, 200, '29 天内有活动，仍然登录')
      clock += 31 * 86400_000
      assert.equal((await c.call('/auth/me')).status, 401, '超过 30 天不活动就过期')
      await c.login('dave_001')
      env.db.prepare("UPDATE users SET status = 'disabled' WHERE username = 'dave_001'").run()
      assert.equal((await c.call('/auth/me')).status, 401)
      assert.match((await c.login('dave_001')).body.error, /已停用/)
    } finally { env.close() }
  })

  test('别人从别的 IP 乱试密码，锁不住本人；同时发很多请求也绕不过锁定', async () => {
    const env = await setup()
    try {
      await env.client('198.51.100.1').register('peggy_01')
      // 攻击者从另一个 IP 连错 20 次
      for (let i = 0; i < 20; i++) await env.client('203.0.113.66').login('peggy_01', 'wrong-password')
      assert.equal((await env.client('198.51.100.1').login('peggy_01')).status, 200, '本人在自己的网络里照常登录')
      // 同一 IP 同时发 30 个错误密码：只有前 8 个真正去核对，其余直接 429
      const burst = await Promise.all(Array.from({ length: 30 }, () => env.client('203.0.113.77').login('peggy_01', 'wrong-password')))
      assert.equal(burst.filter(r => r.status === 401).length, 8, JSON.stringify(burst.map(r => r.status)))
      assert.equal(burst.filter(r => r.status === 429).length, 22)
    } finally { env.close() }
  })

  test('同时发很多注册请求，也绕不过每小时 5 个的限制', async () => {
    const env = await setup()
    try {
      const burst = await Promise.all(Array.from({ length: 12 }, (_, i) => env.client('203.0.113.88').register(`burst_${i}_u`)))
      assert.equal(burst.filter(r => r.status === 200).length, 5, JSON.stringify(burst.map(r => r.status)))
    } finally { env.close() }
  })

  test('一直在用的账号不会在第 30 天被登出：活动时续 Cookie 有效期', async () => {
    let clock = Date.parse('2026-11-21T10:00:00Z')
    const env = await setup({ now: () => clock })
    try {
      const c = env.client()
      await c.register('quinn_01')
      clock += 20 * 86400_000
      const touched = await c.call('/auth/me')
      assert.match(touched.setCookie ?? '', /Max-Age=2592000/, '超过 10 分钟没活动后再访问，会重发 Cookie')
      clock += 20 * 86400_000
      assert.equal((await c.call('/auth/me')).status, 200, '登录后第 40 天，中间有活动，仍然登录')
    } finally { env.close() }
  })

  test('同一 IP 一小时最多注册 5 个账号', async () => {
    const env = await setup()
    try {
      for (let i = 0; i < 5; i++) assert.equal((await env.client('203.0.113.99').register(`user_${i}_x`)).status, 200)
      assert.equal((await env.client('203.0.113.99').register('user_5_x')).status, 429)
      assert.equal((await env.client('203.0.113.100').register('user_6_x')).status, 200)
    } finally { env.close() }
  })

  test('其他网站发起的请求被拒绝', async () => {
    const env = await setup()
    try {
      const c = env.client()
      await c.register('erin_001')
      assert.equal((await c.call('/account/redeem', { method: 'POST', body: { code: 'x' }, headers: { origin: 'https://evil.example' } })).status, 403)
      assert.equal((await c.call('/auth/login', { method: 'POST', body: { username: 'erin_001', password: 'password123' }, headers: { origin: 'https://evil.example' } })).status, 403)
    } finally { env.close() }
  })
})

describe('兑换码和额度', () => {
  test('兑换：加额度；同一人不能重复兑换；次数用完、停用、不存在都拒绝；大小写和空格不影响', async () => {
    const env = await setup()
    try {
      const { code } = createVoucher(env.db, { credits: 10, maxUses: 2, note: '测试' })
      const a = env.client('198.51.100.1'); await a.register('frank_01')
      const b = env.client('198.51.100.2'); await b.register('grace_01')
      const c = env.client('198.51.100.3'); await c.register('heidi_01')
      const first = await a.redeem(`  ${code.toUpperCase()} `)
      assert.equal(first.status, 200)
      assert.deepEqual(first.body, { credits: 10, balance: 10 })
      assert.equal((await a.redeem(code)).status, 409)
      assert.equal((await b.redeem(code)).status, 200)
      assert.match((await c.redeem(code)).body.error, /次数已经用完/)
      assert.equal((await c.redeem('nope-nope-nope')).status, 404)
      const off = createVoucher(env.db, { credits: 5 })
      env.db.prepare("UPDATE vouchers SET status = 'disabled' WHERE id = ?").run(off.id)
      assert.match((await c.redeem(off.code)).body.error, /已停用/)
      assert.equal((await c.call('/account/history')).body.balance, 0)
      // 数据库里只有兑换码的哈希
      assert.ok(!JSON.stringify(env.db.prepare('SELECT * FROM vouchers').all()).includes(code))
    } finally { env.close() }
  })

  test('生成：没登录 401；没额度 402；按张数扣；余额不够时拒绝且不调用模型', async () => {
    const env = await setup()
    try {
      const anon = env.client()
      const denied = await anon.generate()
      assert.equal(denied.status, 401)
      assert.equal(denied.body.code, 'login_required')
      const c = env.client(); await c.register('ivan_001')
      const empty = await c.generate()
      assert.equal(empty.status, 402)
      assert.equal(empty.body.code, 'no_credits')
      assert.equal(env.requests.length, 0)
      await c.redeem(createVoucher(env.db, { credits: 3 }).code)
      const ok = await c.generate(2)
      assert.equal(ok.status, 200)
      assert.equal(ok.body.images.length, 2)
      assert.equal(ok.body.balance, 1)
      const tooMany = await c.generate(2)
      assert.equal(tooMany.status, 402)
      assert.match(tooMany.body.error, /只剩 1 张/)
      assert.equal(env.requests.length, 2)
      const history = (await c.call('/account/history')).body
      assert.equal(history.generations[0].succeeded, 2)
      assert.deepEqual(history.ledger.map(row => [row.reason, row.delta]), [['generate', -2], ['redeem', 3]])
      assert.ok(env.logs.some(line => /生成完成 .*用户 ivan_001/.test(line)))
    } finally { env.close() }
  })

  test('没生成出来的张数全部退回：上游拒绝和超时都退；生成记录写明结果', async () => {
    const env = await setup()
    try {
      const c = env.client(); await c.register('judy_001')
      await c.redeem(createVoucher(env.db, { credits: 10 }).code)
      env.upstream.reply = (req, res) => json(res, 403, { error: { message: '用户额度不足', code: 'insufficient_user_quota' } })
      const rejected = await c.generate()
      assert.equal(rejected.status, 502)
      assert.equal(rejected.body.balance, 10)
      env.upstream.reply = () => {}
      const slow = await c.generate()
      assert.equal(slow.status, 504)
      assert.equal(slow.body.balance, 10)
      assert.ok(env.logs.some(line => line.includes('[billing]')), '超时退回要记一行日志，方便和上游对账')
      const rows = env.db.prepare('SELECT status, requested, succeeded, failed, refunded FROM generations ORDER BY id').all()
      assert.deepEqual(rows.map(r => ({ ...r })), [
        { status: 'failed', requested: 1, succeeded: 0, failed: 1, refunded: 1 },
        { status: 'failed', requested: 1, succeeded: 0, failed: 1, refunded: 1 },
      ])
    } finally { env.close() }
  })

  test('一个人在生成时，别人照样能生成；同一个人不能同时生成两次', async () => {
    const env = await setup()
    let release
    env.upstream.reply = (req, res) => { release = () => json(res, 200, { created: 1, data: [{ b64_json: PNG.toString('base64') }] }) }
    try {
      const a = env.client('198.51.100.1'); await a.register('rupert01')
      const b = env.client('198.51.100.2'); await b.register('sybil_01')
      for (const c of [a, b]) await c.redeem(createVoucher(env.db, { credits: 5 }).code)
      const slow = a.generate()
      while (!release) await new Promise(r => setTimeout(r, 10))
      const first = release; release = undefined
      assert.equal((await a.generate()).status, 429, '自己的上一张还没完')
      env.upstream.reply = (req, res) => json(res, 200, { created: 1, data: [{ b64_json: PNG.toString('base64') }] })
      assert.equal((await b.generate()).status, 200, '别人不受影响')
      first()
      assert.equal((await slow).status, 200)
    } finally { env.close() }
  })

  test('记账出错时，已经生成好的图片照样交给用户', async () => {
    const env = await setup()
    try {
      const c = env.client(); await c.register('trent_01')
      await c.redeem(createVoucher(env.db, { credits: 3 }).code)
      env.upstream.reply = (req, res) => {
        // 模拟上游返回时数据库出了问题（比如服务正在关闭）
        env.db.exec('ALTER TABLE generations RENAME TO generations_gone')
        json(res, 200, { created: 1, data: [{ b64_json: PNG.toString('base64') }] })
      }
      const r = await c.generate()
      assert.equal(r.status, 200)
      assert.equal(r.body.images.length, 1)
      assert.ok(env.logs.some(line => /记账失败（用户 trent_01，成功 1 张/.test(line)))
    } finally { env.close() }
  })

  test('两个请求同时扣额度，不会扣成负数', async () => {
    const env = await setup()
    try {
      const c = env.client(); await c.register('kate_001')
      await c.redeem(createVoucher(env.db, { credits: 1 }).code)
      // 后端一次只跑一个生成，所以第二个要么被锁挡住（429），要么因余额不够被拒（402）
      const results = await Promise.all([c.generate(), c.generate(), c.generate()])
      assert.equal(results.filter(r => r.status === 200).length, 1)
      assert.ok(results.every(r => [200, 402, 429].includes(r.status)), JSON.stringify(results.map(r => r.status)))
      assert.equal(balance(env.db, 'kate_001'), 0)
    } finally { env.close() }
  })

  test('全站每天上限：按北京时间零点重置', async () => {
    let clock = Date.parse('2026-11-21T15:00:00Z') // 北京时间 23:00
    const env = await setup({ dailyLimit: 2, now: () => clock })
    try {
      const c = env.client(); await c.register('leo_0001')
      await c.redeem(createVoucher(env.db, { credits: 10 }).code)
      assert.equal((await c.generate(2)).status, 200)
      assert.match((await c.generate(1)).body.error, /今天全站的生成次数已经用完/)
      clock += 2 * 3600_000 // 北京时间第二天 01:00
      assert.equal((await c.generate(1)).status, 200)
      // 零点前发起、零点后才退回的那几张，算在发起那天，不会让第二天多出额度
      clock = Date.parse('2026-11-22T15:59:59Z') // 北京时间 23:59:59
      env.upstream.reply = (req, res) => setTimeout(() => json(res, 400, { error: { message: 'bad request' } }), 300)
      const late = c.generate(1)
      await new Promise(r => setTimeout(r, 100))
      clock = Date.parse('2026-11-22T16:00:30Z') // 北京时间第二天 00:00:30
      assert.equal((await late).status, 400)
      assert.equal(env.db.prepare('SELECT COALESCE(SUM(requested - refunded), 0) n FROM generations WHERE created_at >= ?').get('2026-11-22T16:00:00.000Z').n, 0)
      env.upstream.reply = undefined
      assert.equal((await c.generate(2)).status, 200, '第二天正常有 2 张')
      assert.match((await c.generate(1)).body.error, /用完/, '而且不会多出来')
      assert.equal(beijingDayStart(Date.parse('2026-11-21T15:59:59Z')), '2026-11-20T16:00:00.000Z')
      assert.equal(beijingDayStart(Date.parse('2026-11-21T16:00:00Z')), '2026-11-21T16:00:00.000Z')
    } finally { env.close() }
  })
})

describe('管理后台', () => {
  async function withAdmin(env) {
    await createUser(env.db, 'tim_admin', 'admin-password-1', 'admin')
    const admin = env.client('198.51.100.200')
    await admin.login('tim_admin', 'admin-password-1')
    return admin
  }

  test('普通用户和未登录都进不了后台', async () => {
    const env = await setup()
    try {
      assert.equal((await env.client().call('/admin/users')).status, 401)
      const c = env.client(); await c.register('mallory1')
      assert.equal((await c.call('/admin/users')).status, 403)
      assert.equal((await c.call('/admin/vouchers', { method: 'POST', body: { credits: 100 } })).status, 403)
    } finally { env.close() }
  })

  test('建兑换码、调额度、停用账号、重置密码；每次操作都有记录', async () => {
    const env = await setup()
    try {
      const admin = await withAdmin(env)
      const made = await admin.call('/admin/vouchers', { method: 'POST', body: { credits: 20, maxUses: 1, note: '给小王' } })
      assert.equal(made.status, 200)
      assert.match(made.body.code, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/)
      assert.equal((await admin.call('/admin/vouchers', { method: 'POST', body: { credits: 0 } })).status, 400)

      const user = env.client(); await user.register('niaj_001')
      await user.redeem(made.body.code)
      const id = env.db.prepare("SELECT id FROM users WHERE username = 'niaj_001'").get().id
      const listed = (await admin.call('/admin/users?q=NIAJ')).body.users
      assert.equal(listed.length, 1)
      // 带下划线的搜索要能找到，而且下划线不是通配符
      await env.client('198.51.100.30').register('niajX001')
      assert.deepEqual((await admin.call('/admin/users?q=niaj_001')).body.users.map(u => u.username), ['niaj_001'])
      assert.equal((await admin.call(`/admin/users?q=${encodeURIComponent('%')}`)).body.users.length, 0)
      assert.equal(listed[0].balance, 20)
      assert.equal((await admin.call('/admin/vouchers')).body.vouchers[0].redeemed_by, 'niaj_001')

      assert.equal((await admin.call('/admin/users/credits', { method: 'POST', body: { userId: id, delta: 5, note: '补偿' } })).body.balance, 25)
      assert.equal((await admin.call('/admin/users/credits', { method: 'POST', body: { userId: id, delta: -100 } })).status, 400, '不能扣成负数')

      const reset = await admin.call('/admin/users/reset-password', { method: 'POST', body: { userId: id } })
      assert.equal((await user.call('/auth/me')).status, 401, '重置密码后旧设备下线')
      assert.equal((await env.client('198.51.100.9').login('niaj_001', reset.body.password)).status, 200)

      await admin.call('/admin/users/status', { method: 'POST', body: { userId: id, status: 'disabled' } })
      assert.match((await env.client('198.51.100.8').login('niaj_001', reset.body.password)).body.error, /已停用/)
      const self = env.db.prepare("SELECT id FROM users WHERE username = 'tim_admin'").get().id
      assert.equal((await admin.call('/admin/users/status', { method: 'POST', body: { userId: self, status: 'disabled' } })).status, 400)

      const log = env.db.prepare('SELECT action FROM admin_log ORDER BY id').all().map(r => r.action)
      assert.deepEqual(log, ['新建兑换码', '调整额度', '重置密码', '停用账号'])
      assert.ok(!env.logs.join('\n').includes(made.body.code), '日志里没有兑换码原文')
      assert.ok(!env.logs.join('\n').includes(reset.body.password), '日志里没有临时密码')
    } finally { env.close() }
  })

  test('用量统计和生成记录', async () => {
    const env = await setup()
    try {
      const admin = await withAdmin(env)
      const c = env.client(); await c.register('olivia01')
      await c.redeem(createVoucher(env.db, { credits: 5 }).code)
      await c.generate(2)
      const stats = (await admin.call('/admin/stats')).body
      assert.equal(stats.totals.users, 2)
      assert.equal(stats.totals.succeeded, 2)
      assert.equal(stats.days[0].succeeded, 2)
      assert.equal(stats.top[0].username, 'olivia01')
      const gens = (await admin.call('/admin/generations?limit=10')).body
      assert.equal(gens.total, 1)
      assert.equal(gens.generations[0].username, 'olivia01')
      assert.equal(gens.generations[0].succeeded, 2)
    } finally { env.close() }
  })

  test('命令行：建管理员、重置密码、建兑换码、列账号', async () => {
    const db = openDb(':memory:')
    try {
      const created = await runAdminCli(['create-admin', 'tim'], db)
      const password = created.match(/临时密码：(\S+)/)[1]
      const row = db.prepare("SELECT role, password_hash FROM users WHERE username = 'tim'").get()
      assert.equal(row.role, 'admin')
      assert.ok(await verifyPassword(password, row.password_hash))
      assert.match(await runAdminCli(['voucher', '50', '--uses', '3', '--note', '活动'], db), /50 张 × 3 次/)
      assert.match(await runAdminCli(['users'], db), /tim\tadmin\t正常\t0/)
      await assert.rejects(runAdminCli(['reset-password', 'nobody'], db), /没有叫/)
      await assert.rejects(runAdminCli(['voucher', '0'], db), /1 到 100000/)
    } finally { db.close() }
  })
})

describe('改密码', () => {
  test('用户自己改：要先输对旧密码；改完其他设备下线，当前设备继续登录', async () => {
    const env = await setup()
    try {
      const phone = env.client('198.51.100.1'); await phone.register('ursula01', 'old-password')
      const laptop = env.client('198.51.100.1'); await laptop.login('ursula01', 'old-password')
      const change = body => phone.call('/account/password', { method: 'POST', body })
      assert.match((await change({ currentPassword: 'wrong-old-pw', newPassword: 'new-password' })).body.error, /现在的密码不对/)
      assert.match((await change({ currentPassword: 'old-password', newPassword: 'short' })).body.error, /新密码至少 8 位/)
      assert.match((await change({ currentPassword: 'old-password', newPassword: 'old-password' })).body.error, /一样/)
      assert.equal((await change({ currentPassword: 'old-password', newPassword: 'new-password' })).status, 200)
      assert.equal((await phone.call('/auth/me')).status, 200, '改密码的这台设备继续登录')
      assert.equal((await laptop.call('/auth/me')).status, 401, '其他设备下线')
      assert.equal((await env.client('198.51.100.2').login('ursula01', 'old-password')).status, 401)
      assert.equal((await env.client('198.51.100.3').login('ursula01', 'new-password')).status, 200)
      assert.ok(!env.logs.join('\n').includes('new-password'), '日志里没有新密码')
    } finally { env.close() }
  })

  test('反复猜旧密码会被锁定', async () => {
    const env = await setup()
    try {
      const c = env.client(); await c.register('victor01', 'old-password')
      for (let i = 0; i < 8; i++) await c.call('/account/password', { method: 'POST', body: { currentPassword: `guess-${i}-xx`, newPassword: 'new-password' } })
      assert.equal((await c.call('/account/password', { method: 'POST', body: { currentPassword: 'old-password', newPassword: 'new-password' } })).status, 429)
    } finally { env.close() }
  })

  test('管理员设置别人和自己的密码', async () => {
    const env = await setup()
    try {
      await createUser(env.db, 'tim_admin', 'admin-password-1', 'admin')
      const admin = env.client('198.51.100.200'); await admin.login('tim_admin', 'admin-password-1')
      const user = env.client('198.51.100.5'); await user.register('walter01')
      const uid = env.db.prepare("SELECT id FROM users WHERE username = 'walter01'").get().id
      const aid = env.db.prepare("SELECT id FROM users WHERE username = 'tim_admin'").get().id
      const set = (userId, password) => admin.call('/admin/users/set-password', { method: 'POST', body: { userId, password } })
      assert.equal((await set(uid, 'short')).status, 400)
      assert.equal((await set(uid, 'walter-new-pw')).status, 200)
      assert.equal((await user.call('/auth/me')).status, 401, '对方所有设备下线')
      assert.equal((await env.client('198.51.100.6').login('walter01', 'walter-new-pw')).status, 200)
      assert.equal((await set(aid, 'admin-password-2')).status, 200)
      assert.equal((await admin.call('/auth/me')).status, 200, '改自己的密码，当前设备不下线')
      assert.equal((await env.client('198.51.100.7').login('tim_admin', 'admin-password-2')).status, 200)
      assert.equal((await user.call('/admin/users/set-password', { method: 'POST', body: { userId: aid, password: 'hacked-pass' } })).status, 401)
      assert.deepEqual(env.db.prepare('SELECT action, target FROM admin_log ORDER BY id').all().map(r => `${r.action} ${r.target}`), ['设置密码 walter01', '设置密码 tim_admin'])
    } finally { env.close() }
  })
})

describe('AI 生成标识', () => {
  test('返回的 PNG 里写了 AI 生成说明，图片仍然是有效的 PNG', async () => {
    const env = await setup()
    try {
      const c = env.client(); await c.register('ada_0001')
      await c.redeem(createVoucher(env.db, { credits: 2 }).code)
      const done = await c.generate()
      assert.equal(done.status, 200)
      const png = Buffer.from(done.body.images[0].split(',')[1], 'base64')
      assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      assert.equal(png.subarray(12, 16).toString('latin1'), 'IHDR')
      assert.ok(png.includes(Buffer.from('AI 生成内容', 'utf8')))
      assert.ok(png.includes(Buffer.from('"Label":"AI-generated"')))
      assert.ok(png.subarray(-8, -4).toString('latin1') === 'IEND', '原来的图像数据和结尾都保留')
    } finally { env.close() }
  })
})

describe('头像', () => {
  test('默认按用户编号分一个；只能选内置的；没登录不能改；登录和 /auth/me 都带头像', async () => {
    const env = await setup()
    try {
      const c = env.client(); const reg = await c.register('zoe_0001')
      assert.ok(AVATARS.includes(reg.body.user.avatar))
      const pick = avatar => c.call('/account/avatar', { method: 'POST', body: { avatar } })
      assert.equal((await pick('../../etc/passwd')).status, 400)
      assert.equal((await pick('')).status, 400)
      assert.equal((await pick(['bun'])).status, 400)
      assert.equal((await pick('bun')).status, 200)
      assert.equal((await c.call('/auth/me')).body.user.avatar, 'bun')
      assert.equal((await env.client('203.0.113.9').call('/account/avatar', { method: 'POST', body: { avatar: 'bun' } })).status, 401)
      const again = env.client('203.0.113.10')
      assert.equal((await again.login('zoe_0001')).body.user.avatar, 'bun')
    } finally { env.close() }
  })
})

describe('上传头像', () => {
  const fixture = name => readFile(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name))
  // 在 IHDR 后面塞一个带“拍摄地点”的文字块和一个 EXIF 块，模拟手机照片的元数据
  const withMetadata = png => {
    const chunk = (type, data) => {
      const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1')
      return Buffer.concat([head, data, Buffer.alloc(4)])
    }
    const ihdrEnd = 8 + 12 + png.readUInt32BE(8)
    return Buffer.concat([png.subarray(0, ihdrEnd), chunk('tEXt', Buffer.from('Location\0GPS 31.2304,121.4737')), chunk('eXIf', Buffer.from('MM\0*fake-exif')), png.subarray(ihdrEnd)])
  }

  test('上传后头像变成 upload:时间戳；只有本人能取；元数据被去掉', async () => {
    const env = await setup()
    try {
      const c = env.client(); await c.register('ivy_0001')
      const up = await c.upload(withMetadata(await fixture('avatar-96.png')))
      assert.equal(up.status, 200)
      assert.match(up.body.avatar, /^upload:\d+$/)
      assert.equal((await c.call('/auth/me')).body.user.avatar, up.body.avatar)
      const res = await fetch(`${env.url}/api/account/avatar/image`, { headers: { cookie: c.cookie, 'x-real-ip': '203.0.113.7' } })
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('content-type'), 'image/png')
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
      const bytes = Buffer.from(await res.arrayBuffer())
      assert.ok(!bytes.includes(Buffer.from('GPS')), '拍摄地点被去掉')
      assert.ok(!bytes.includes(Buffer.from('eXIf')), 'EXIF 被去掉')
      assert.ok(bytes.includes(Buffer.from('IDAT')) && bytes.subarray(-8, -4).toString('latin1') === 'IEND')
      // 别人（另一个登录用户）取到的是自己的，没有就 404；没登录 401
      const other = env.client('203.0.113.20'); await other.register('jay_0001')
      assert.equal((await fetch(`${env.url}/api/account/avatar/image`, { headers: { cookie: other.cookie, 'x-real-ip': '203.0.113.20' } })).status, 404)
      assert.equal((await fetch(`${env.url}/api/account/avatar/image`, { headers: { 'x-real-ip': '203.0.113.21' } })).status, 401)
    } finally { env.close() }
  })

  test('只收正方形 PNG，尺寸和大小有限制；没登录不能传；换回内置头像时删掉上传的图', async () => {
    const env = await setup()
    try {
      const c = env.client(); await c.register('kit_0001')
      assert.match((await c.upload(await fixture('wide-120x80.png'))).body.error, /正方形/)
      assert.match((await c.upload(Buffer.from('GIF89a not a png at all'))).body.error, /格式不对/)
      assert.match((await c.upload(Buffer.concat([await fixture('avatar-96.png')]).subarray(0, 60))).body.error, /不完整|不是有效/)
      assert.equal((await c.upload(Buffer.alloc(301 * 1024, 1))).status, 413)
      assert.equal((await env.client('203.0.113.30').upload(await fixture('avatar-96.png'))).status, 401)
      assert.equal((await c.upload(await fixture('avatar-96.png'))).status, 200)
      assert.equal(env.db.prepare('SELECT COUNT(*) n FROM user_avatars').get().n, 1)
      assert.equal((await c.call('/account/avatar', { method: 'POST', body: { avatar: 'bun' } })).status, 200)
      assert.equal(env.db.prepare('SELECT COUNT(*) n FROM user_avatars').get().n, 0, '换回内置头像后，服务器上不留上传的图')
      assert.equal((await c.call('/auth/me')).body.user.avatar, 'bun')
      // 不能直接把头像设成 upload（只能通过上传）
      assert.equal((await c.call('/account/avatar', { method: 'POST', body: { avatar: 'upload' } })).status, 400)
    } finally { env.close() }
  })
})

describe('数据库升级', () => {
  test('从 v0.2 第二版升级：去掉额度申请表，用户表加上头像列，原有账号保留', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const dir = await mkdtemp(join(tmpdir(), 'qa-upgrade-'))
    try {
      const file = join(dir, 'app.db')
      // 模拟第 2 版：用户表没有 avatar 列，还有申请表
      const old = new DatabaseSync(file)
      old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, username_key TEXT UNIQUE, password_hash TEXT, role TEXT DEFAULT 'user', status TEXT DEFAULT 'active', created_at TEXT, last_login_at TEXT);
        INSERT INTO users (username, username_key, password_hash, created_at) VALUES ('old_user', 'old_user', 'x', '2026-11-21T00:00:00.000Z');
        CREATE TABLE credit_requests (id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER);
        PRAGMA user_version = 2;`)
      old.close()
      const db = openDb(file)
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4)
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'user_avatars'").get())
      assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'credit_requests'").get(), undefined)
      assert.deepEqual({ ...db.prepare('SELECT username, avatar FROM users').get() }, { username: 'old_user', avatar: '' })
      db.close()
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})

describe('从 v0.1 迁移', () => {
  test('旧邀请码变成兑换码：原码可直接兑换剩余额度；停用和用完的跳过；重复运行不重复创建', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qa-migrate-'))
    const env = await setup()
    try {
      // v0.1 的哈希是 sha256(原文)；旧码都是小写，和 v0.2 的 hashCode 一致
      const codes = { wang: 'wang-test-code', li: 'lili-test-code', off: 'offf-test-code', done: 'done-test-code' }
      await writeFile(join(dir, 'codes.json'), JSON.stringify({ codes: [
        { name: '小王', hash: hashCode(codes.wang), quota: 100 },
        { name: '小李', hash: hashCode(codes.li), quota: 50 },
        { name: '停用的', hash: hashCode(codes.off), quota: 10, disabled: true },
        { name: '用完的', hash: hashCode(codes.done), quota: 5 },
      ] }))
      await writeFile(join(dir, 'code-usage.json'), JSON.stringify({ [hashCode(codes.li)]: { used: 8 }, [hashCode(codes.done)]: { used: 5 } }))
      const lines = migrateCodes(env.db, dir)
      assert.equal(lines.filter(l => l.startsWith('已迁移')).length, 2)
      assert.deepEqual(migrateCodes(env.db, dir).filter(l => l.startsWith('已迁移')), [], '重复运行不重复创建')
      const wang = env.client('198.51.100.1'); await wang.register('xiaowang')
      assert.deepEqual((await wang.redeem(codes.wang)).body, { credits: 100, balance: 100 })
      const li = env.client('198.51.100.2'); await li.register('xiaoli_1')
      assert.deepEqual((await li.redeem(codes.li)).body, { credits: 42, balance: 42 })
      assert.equal((await li.redeem(codes.off)).status, 404)
      assert.equal((await env.client('198.51.100.3').register('someone1').then(() => li.redeem(codes.wang))).status, 410, '只能兑换一次')
    } finally { env.close(); await rm(dir, { recursive: true, force: true }) }
  })

  test('哈希函数和 v0.1 兼容', async () => {
    const { createHash } = await import('node:crypto')
    const v01 = code => createHash('sha256').update(code.trim()).digest('hex')
    assert.equal(hashCode('abcd-efgh-jkmn'), v01('abcd-efgh-jkmn'))
    assert.ok((await hashPassword('x-password')).startsWith('scrypt$16384$8$1$'))
  })
})
