# 云服务器部署

下面以一台 Ubuntu 24.04 云服务器为例。`<服务器IP>` 换成你的服务器公网 IP，`ubuntu` 换成你的登录用户名。

## 结构

- nginx 监听 443（HTTPS）：直接发 `/opt/q-avatar/dist` 里的网页，`/api/` 转发给本机 8787 端口。80 端口只给证书验证用，其余请求跳转到 https。配置：`nginx-q-avatar.conf` → `/etc/nginx/sites-available/q-avatar`。
- HTTPS 证书：Let's Encrypt 的 IP 证书，约 6 天有效，见下面“HTTPS 证书”。
- 后端 `node server/production.ts` 只监听 127.0.0.1:8787，由 systemd 管理，开机自启、出错自动重启，用系统用户 `qavatar` 运行。配置：`q-avatar.service` → `/etc/systemd/system/q-avatar.service`。
- Node.js v24.22.3 装在 `/opt/node/current`，链接到 `/usr/local/bin/node`。
- 服务器上的 `/opt/q-avatar/.env`（root:qavatar，640）存放 API 密钥和每天上限等配置，不在仓库里。
- 日志：`/opt/q-avatar/logs/image-api.log`，也可以 `sudo journalctl -u q-avatar -f`。账号和用量：`/opt/q-avatar/data/app.db`。

## 配置（.env）

```ini
DAILY_IMAGE_LIMIT=1000   # 全站每天最多生成多少张（所有人合计，北京时间零点重置）；不写时默认 20
PORT=8787
```

改完执行 `sudo systemctl restart q-avatar`。v0.1 的 `ACCESS_CODE`、`IP_HOURLY_LIMIT` 已经不用了，留着也不影响。

上游明确拒绝（余额不足、参数错误、没通过审核、连不上）的张数会退回额度；超时等可能已经扣费的照常计入。

## 账号和管理后台（v0.2）

- 任何人都能在 `/login` 注册；真实生成要登录，并在“我的账户”（`/account`）输入兑换码领取张数。没登录可以用演示模式。
- 用户没有兑换码时，可以在“我的账户”申请额度；管理员在 `/admin` 的“额度申请”里批准（直接加到账户）或拒绝。用户在“我的账户”自己改密码。
- 管理员在 `/admin`：额度申请、用户（搜索、调额度、停用、设密码、随机重置）、兑换码（生成、停用）、用量统计、生成记录。每次修改都记进 `admin_log`。
- 照片和生成的图片不保存在服务器上；生成记录只记时间、用户、风格、张数和结果。
- 数据在 `data/app.db`，后端每天自动备份到 `data/backups/`，保留 7 天。

**命令行应急工具**（后台进不去时用；用后端的运行账户执行，让数据库文件归属一致）：

```bash
cd /opt/q-avatar
sudo -u qavatar node server/admin-cli.ts create-admin tim        # 建管理员，临时密码只显示一次
sudo -u qavatar node server/admin-cli.ts reset-password tim      # 重置密码，所有设备下线
sudo -u qavatar node server/admin-cli.ts voucher 20 --note 给小王 # 建兑换码（--uses N 可兑换 N 次）
sudo -u qavatar node server/admin-cli.ts users                   # 列出账号和余额
```

**从 v0.1 升级**：部署后执行一次 `sudo -u qavatar node server/migrate-v02.ts`。它先备份 `data/`，再把 v0.1 的邀请码转成兑换码：哈希不变，所以原来的码可以直接在“我的账户”兑换，额度等于原来剩余的张数，只能兑换 1 次。重复运行不会重复创建。

## 首次部署

1. 云服务商的安全组放行 TCP 22、80、443，8787 不要放行。
2. 在服务器上安装 nginx 和 Node.js（22.18 以上，建议 24 LTS；下载后按 nodejs.org 公布的 SHA256 校验）：

   ```bash
   sudo apt-get update && sudo apt-get install -y nginx
   # Node.js：从 nodejs.org 或镜像下载 node-v24.x-linux-x64.tar.xz，校验后解压到 /opt/node，
   # 再把 node、npm 链接到 /usr/local/bin
   ```

3. 建运行账户和目录，上传代码和打包好的网页（命令同下面"更新代码"）：

   ```bash
   sudo useradd --system --home-dir /opt/q-avatar --shell /usr/sbin/nologin qavatar
   sudo mkdir -p /opt/q-avatar/logs /opt/q-avatar/data
   sudo chown qavatar:qavatar /opt/q-avatar/logs /opt/q-avatar/data
   ```

4. 在服务器上写 `/opt/q-avatar/.env`：照 `.env.example` 填模型密钥，再加上下面"访问控制"里的几行。权限设成只有程序能读：

   ```bash
   sudo chown root:qavatar /opt/q-avatar/.env && sudo chmod 640 /opt/q-avatar/.env
   ```

5. 安装服务和 nginx 配置，启动：

   ```bash
   sudo cp q-avatar.service /etc/systemd/system/
   sudo cp nginx-q-avatar.conf /etc/nginx/sites-available/q-avatar
   sudo ln -s /etc/nginx/sites-available/q-avatar /etc/nginx/sites-enabled/q-avatar
   sudo rm /etc/nginx/sites-enabled/default   # 停用 nginx 自带的欢迎页
   sudo nginx -t && sudo systemctl reload nginx
   sudo systemctl daemon-reload && sudo systemctl enable --now q-avatar
   ```

6. 按下面“HTTPS 证书”申请证书。
7. 建管理员账号（见上面“命令行应急工具”），打开 `https://<服务器IP>/login` 登录，在 `/admin` 生成兑换码，用另一个账号注册、兑换、真实生成一张。

## 一键部署

在项目根目录（Git Bash）：

```bash
bash deploy/deploy.sh
```

服务器地址写在项目根目录的 `deploy.local`（已被 git 忽略，不会公开）：

```bash
QA_SERVER=ubuntu@<服务器IP>
```

脚本按顺序执行，任何一步失败就停下，线上保持原样：

1. 检查本地没有未提交的改动：线上必须对应一个确定的 git 版本；
2. 跑后端测试、打包网页；
3. 把服务器上的代码和上次部署的版本逐个比对；有人直接在服务器上改过，就停下提示，确认可以覆盖时加 `--force`；
4. 上传；
5. 安装依赖、替换网页、重启服务；
6. 检查服务和 `/api/config`，把版本号和提交写进服务器上的 `/opt/q-avatar/DEPLOYED`。

退回上一个版本：`git checkout v0.1.0`，再执行一次 `bash deploy/deploy.sh --force`，最后 `git checkout main` 回来。版本说明见 [CHANGELOG.md](../CHANGELOG.md)。

## 手动更新代码

在本机项目目录（Git Bash）：

```bash
npm run test:server && npm run build
git archive --format=tar.gz -o /tmp/q-avatar-src.tar.gz HEAD -- server shared package.json package-lock.json
tar -czf /tmp/q-avatar-dist.tar.gz dist
scp /tmp/q-avatar-src.tar.gz /tmp/q-avatar-dist.tar.gz ubuntu@<服务器IP>:/tmp/
ssh ubuntu@<服务器IP> 'set -e
sudo tar -xzf /tmp/q-avatar-src.tar.gz -C /opt/q-avatar
sudo rm -rf /opt/q-avatar/dist && sudo tar -xzf /tmp/q-avatar-dist.tar.gz -C /opt/q-avatar
rm -f /tmp/q-avatar-src.tar.gz /tmp/q-avatar-dist.tar.gz
cd /opt/q-avatar && sudo npm ci --omit=dev --registry=https://registry.npmmirror.com
sudo systemctl restart q-avatar && systemctl is-active q-avatar'
```

只改了网页、没改后端时，最后不重启也可以，刷新页面即生效。

## HTTPS 证书

用 Let's Encrypt 的 IP 地址证书（2026 年起开放）。IP 证书只能是短期证书，**约 6 天有效**，所以必须自动续期。

**安装 certbot**（需要 5.4 以上；Ubuntu 软件源里的 2.9 太旧，单独装在 `/opt/certbot`，不动系统 Python）：

```bash
sudo apt-get install -y python3.12-venv
sudo python3 -m venv /opt/certbot
sudo /opt/certbot/bin/pip install -i https://mirrors.cloud.tencent.com/pypi/simple/ "certbot>=5.4,<6"
sudo ln -s /opt/certbot/bin/certbot /usr/local/bin/certbot
```

**申请证书**（nginx 的 80 端口先按 `nginx-q-avatar.conf` 配好 `/.well-known/acme-challenge/`；先加 `--staging` 试一次，成功再去掉）：

```bash
sudo mkdir -p /var/www/acme
sudo certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
  --preferred-profile shortlived --webroot -w /var/www/acme \
  --ip-address <服务器IP> --cert-name q-avatar
```

**自动续期**：`certbot-renew.timer` 每天 03:17 和 15:17 左右运行一次 `certbot renew`。证书用过一半（约 3 天）才真正续期，续期成功后自动重载 nginx。每次运行后 `cert-check.sh` 检查剩余时间，不到 48 小时会在日志里写告警。

```bash
sudo install -m 755 cert-check.sh /usr/local/bin/q-avatar-cert-check
sudo cp certbot-renew.service certbot-renew.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now certbot-renew.timer
```

常用检查：

```bash
systemctl list-timers certbot-renew.timer      # 下次续期时间
sudo certbot renew --dry-run                   # 演练一次续期（走测试环境，不替换证书）
sudo journalctl -u certbot-renew -n 30          # 最近的续期记录和剩余时间
grep '\[cert\]' /opt/q-avatar/logs/image-api.log  # 证书告警
```

**如果证书过期了**：网站会打不开（浏览器提示证书无效）。先看 `sudo journalctl -u certbot-renew -n 50` 找原因（常见：80 端口被安全组关了、nginx 配置改坏了验证路径），修好后手动执行 `sudo systemctl start certbot-renew.service`。

## 以后绑定域名

大陆服务器用域名访问前，要先在腾讯云做 ICP 备案。备案通过后：把域名解析到这台服务器；在 nginx 配置里加 `server_name`；用 `certbot certonly ... -d 域名` 申请域名证书（默认 90 天有效，比 IP 证书省心）；网站主地址换成域名。
