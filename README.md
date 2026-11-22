# Tim_pet

Vue 3 + TypeScript + Vite 做的 Q 版公仔生成网站：上传一张照片，选一个风格系列，生成一个可以收藏的小公仔。

页面：

- 首页（`/`）：介绍、示例作品、五种风格、怎么开始、购买张数、常见问题。
- 创作工坊（`/studio`）：上传照片，选风格、构图、比例、表情、姿势、背景，一次生成 1 到 4 张。生成要登录并有张数。
- 作品画廊（`/gallery`）：本机保存的作品，可以查看、下载、用同样的设置再做、删除。
- 我的账户（`/account`）：换头像（内置、上传或用自己的作品）、兑换码、额度变动、生成记录、改密码。
- 帮助（`/help`）、用户协议（`/terms`）、隐私政策（`/privacy`）。
- 管理后台（`/admin`）：兑换码、用户、用量统计、生成记录。

额度按张算，和中转站的充值卡一样：顾客联系客服买兑换码，在“我的账户”兑换张数，生成 1 张图用 1 张，没生成出来的自动退回。

上传的照片从不保存，刷新就清除。作品画廊只在本机浏览器（IndexedDB）里保存生成的结果图和当时的设置，最多 60 张。唯一存在服务器上的图片是用户主动设为头像的那一张 256×256 小图。生成的 PNG 里写有 AI 生成说明，页面上也有“AI 生成”角标。

**客服联系方式**不在仓库里：手机号写在 `.env.production.local` 的 `VITE_CONTACT_PHONE`，微信二维码放在 `public/contact/` 并在 `VITE_CONTACT_WECHAT_QR` 里写路径（例如 `contact/wechat-qr.png`）。这两样都已被 git 忽略，打包时写进页面；没配置时页面显示“暂未配置”。

## 运行

需要 Node.js 22.18 或更新版本（后端用 Node 直接运行 TypeScript）。

```bash
git clone https://github.com/takomama2003/q-avatar.git
cd q-avatar
npm install
npm run dev
```

打开终端显示的地址。生产构建：`npm run build`；本地检查构建：`npm run preview`。

## 真实生成（gpt-image-2）

1. 复制 `.env.example` 为 `.env`，填 `OPENAI_BASE_URL`（中转地址，带不带 `/v1` 都行）和 `OPENAI_API_KEY`。`.env` 已被 git 忽略。
2. 保存后刷新页面，终端会打印一行 `[image-api] 真实生成已开启…`。没配置时创作工坊显示“暂时不能生成”。
3. 在创作工坊上传照片，选好设置后点“生成”。high 画质通常要一到两分钟。期间可以去别的页面，完成后会提示。
4. 生成期间不要刷新页面，也不要改 `.env` 或后端代码：改了会让开发服务器重启，正在生成的这次可能已经扣费，却拿不到结果。

输出尺寸由页面上选的比例决定。旧的 `OPENAI_IMAGE_SIZE` 已不再使用，`.env` 里留着也没关系。

后端的安全和计费保护：

- 密钥只在后端读取，不进入浏览器；终端日志和页面报错里会遮住密钥。
- 只接受本机页面的请求：用局域网 IP 打开、或其他网站跨站提交，都会被拒绝。
- 同一时间只有一次生成在进行；失败不自动重试，避免一次点击重复扣费。
- 一次多张时，每张是一个独立请求，同时发出。账号模式下没生成出来的张数全部退回用户；上游可能已扣费的情况写进 `[billing]` 日志，方便和中转后台对账。
- 默认流式返回（`OPENAI_IMAGE_STREAM=true`）：生成过程中持续有数据，中转前面的 Cloudflare 不会因为约 100 秒没有响应而断开。
- 总时限 5 分钟。

常见报错及处理见网站的帮助页，或 `src/pages/HelpPage.vue`。每次生成的结果、耗时和 token 用量都会记在终端里（`[image-api] 生成完成 / 生成失败 …`），同时追加到 `logs/image-api.log`（本地时间，可以和中转后台的记录对照；密钥已遮住；已被 git 忽略）。

## 代码从哪里看

- `shared/options.ts`：所有风格和参数（中文名、可选值、默认值），前后端共用。新增一个风格时，在这里加一项，再在 `server/image-api.ts` 的 `STYLE_PROMPTS` 里写它的英文提示词。少写了，类型检查会报错。
- `src/router.ts`：页面路由。首页和工坊直接打包，其余页面按需加载。
- `src/App.vue`：网站外壳，包括导航栏、页脚和“生成好了”的提示。
- `src/stores/studio.ts`：工坊的状态，包括照片、选项、生成进度和结果。放在页面之外，所以切换页面不会丢；只在内存里，所以刷新就清空。
- `src/stores/history.ts`：作品记录（IndexedDB），只存结果图和设置。
- `src/services/generator.ts`：`detectMode` 询问后端能不能生成，`generateWithModel` 把照片发给后端。
- `src/pages/`：各个页面。`src/components/`：页面共用的部件，包括公仔头像（`ChibiAvatar`）、头像裁剪、弹窗（`Modal`）、客服联系卡、风格示意插画、选项标签、作品卡片和大图查看。
- `shared/avatars.ts`：内置头像编号；`server/avatar-image.ts`：检查和清理上传的头像；`server/ai-label.ts`：在生成的 PNG 里写入 AI 生成标识。
- `server/image-api.ts`：本地后端。`GET /api/config` 告诉页面用哪种模式；`POST /api/generate` 校验照片和选项后调用模型，并把上游错误翻译成中文提示。
- `vite.config.ts`：把后端挂在开发和预览服务器的 `/api` 下，所以 `npm run dev` 一条命令就能同时启动前后端。这个后端只用于本地测试，正式部署需要另外的服务器。
- `src/styles/`：样式按用途拆分。`base` 是设计规则（字号、间距、圆角、颜色变量）和通用元素，`ui` 是通用部件（按钮、输入框、卡片、标签页、菜单、弹窗），`site` 是顶栏和页脚，其余按页面分。
- `src/main.ts`：挂载应用并加载字体。Fredoka（拉丁字母和数字）随首屏加载；站酷快乐体（中文标题）异步加载，失败时回退系统字体。两种字体都是 SIL OFL 授权的开源字体，通过 @fontsource 打包在本地，不依赖外部 CDN。
- `public/samples/`：3D 公仔示例作品，全身版 1024×1024，头像裁切版 640×640，用在首页、工坊和画廊。

需求见 requirements.md（第一版和 2026-11-01 确认的第二版）。出错时保留输入和上次结果，由用户手动重试；刷新会清空照片。构图和描述的修改在下一次生成时生效。

## 检查

- `npm run build`：类型检查与打包。
- `npm run test:server`：后端测试。用本地假的模型服务模拟各种情况，包括参数、多张、流式、超时、错误提示、密钥遮挡、跨站拒绝和并发锁。不调用真实接口，不花钱，也不读取项目里的 `.env`。
- `tests/e2e.py`：浏览器完整流程（注册、换头像、兑换、生成、退出、后台弹窗、忘记密码、协议页），使用 Playwright 和系统 Edge，跑在本机试用环境上，不调用真实模型，不花钱：
  1. `npm run build`；
  2. `node tests/support/fake-upstream.mjs public/samples/full.png`（假模型，端口 8796）；
  3. 用临时数据目录启动正式后端：`Q_AVATAR_DATA_DIR=<临时目录> COOKIE_SECURE=false OPENAI_API_KEY=sk-fake-local-0123456789 OPENAI_BASE_URL=http://127.0.0.1:8796/v1 OPENAI_IMAGE_STREAM=false PORT=8795 node server/production.ts`；
  4. `node tests/support/static-proxy.mjs dist`（模拟 nginx，端口 8794）；
  5. 用 `server/admin-cli.ts` 在同一个数据目录建管理员 `tim` 和一个 3 张的兑换码，然后运行 `python -X utf8 tests/e2e.py http://127.0.0.1:8794 <截图目录> <兑换码> <管理员密码> public/samples/portrait.png <新用户名>`。

## 部署到服务器

`server/production.ts` 是公网部署用的后端：只提供 `/api`，只监听本机，由 nginx 转发。v0.2 起有账号系统：任何人都能注册，生成要登录，并用兑换码领取张数；管理员在 `/admin` 后台生成兑换码、管理账号和张数，查看用量和生成记录。数据存在 `data/app.db`（Node 24 自带的 SQLite）。另有全站每天总张数的上限。nginx 配置、systemd 服务文件和完整步骤见 [deploy/README.md](deploy/README.md)。

## 许可证

[MIT](LICENSE)。示例图（`public/samples/`）和界面字体随项目一起发布，字体按各自的 SIL OFL 授权。
