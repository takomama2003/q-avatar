# 云服务器部署

下面以一台 Ubuntu 24.04 云服务器为例。`<服务器IP>` 换成你的服务器公网 IP，`ubuntu` 换成你的登录用户名。

## 结构

- nginx 监听 80 端口：直接发 `/opt/q-avatar/dist` 里的网页，`/api/` 转发给本机 8787 端口。配置：`nginx-q-avatar.conf` → `/etc/nginx/sites-available/q-avatar`。
- 后端 `node server/production.ts` 只监听 127.0.0.1:8787，由 systemd 管理，开机自启、出错自动重启，用系统用户 `qavatar` 运行。配置：`q-avatar.service` → `/etc/systemd/system/q-avatar.service`。
- Node.js v24.22.3 装在 `/opt/node/current`，链接到 `/usr/local/bin/node`。
- 服务器上的 `/opt/q-avatar/.env`（root:qavatar，640）存放 API 密钥和访问控制配置，不在仓库里。
- 日志：`/opt/q-avatar/logs/image-api.log`，也可以 `sudo journalctl -u q-avatar -f`。当天已用张数：`/opt/q-avatar/data/usage.json`。

## 访问控制（.env）

```
ACCESS_CODE=...          # 真实生成要输入的口令，至少 6 个字符；没有它后端拒绝启动
DAILY_IMAGE_LIMIT=20     # 每天最多生成多少张（所有人合计，北京时间零点重置）
IP_HOURLY_LIMIT=6        # 每个 IP 每小时最多发起几次生成
PORT=8787
```

改完执行 `sudo systemctl restart q-avatar`。

## 首次部署

1. 云服务商的安全组放行 TCP 22 和 80，8787 不要放行。
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

6. 打开 `http://<服务器IP>` 检查：不填口令只能用演示模式，填入口令后能真实生成。

## 更新代码

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

## 以后绑定域名

大陆服务器用域名访问前，要先在腾讯云做 ICP 备案。备案通过后把域名解析到这台服务器，在 nginx 配置里加 `server_name`，再用 certbot 申请 HTTPS 证书。
