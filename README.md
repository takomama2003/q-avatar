# Tim_pet

Vue 3 + TypeScript + Vite 做的 Q 版公仔生成网站：上传一张照片，选一个风格系列，生成一个可以收藏的小公仔。

页面：

- 首页（`/`）：介绍、四步流程、五个系列、展示柜、常见问题。
- 创作工坊（`/studio`）：上传照片，选风格、构图、比例、表情、姿势、背景，一次生成 1 到 4 张。
- 作品画廊（`/gallery`）：本机保存的作品，可以查看、下载、用同样的设置再做、删除；另有官方示例。
- 帮助（`/help`）：使用说明、照片去向、费用、常见报错、常见问题。

有两种模式：

- **演示模式**（默认）：照片不上传，结果是固定的本地 PNG 示例图，不是根据照片生成。
- **真实生成**：在 `.env` 里配置密钥后，本地后端把照片发给 gpt-image-2，按照片生成公仔。

上传的照片从不保存，刷新就清除。作品画廊只在本机浏览器（IndexedDB）里保存生成的结果图和当时的设置，最多 60 张。

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
2. 保存后刷新页面。右上角显示“已配置 gpt-image-2”，终端会打印一行 `[image-api] 真实生成已开启…`。
3. 在创作工坊上传照片，选好设置后点“生成”。high 画质通常要一到两分钟。期间可以去别的页面，完成后会提示。
4. 生成期间不要刷新页面，也不要改 `.env` 或后端代码：改了会让开发服务器重启，正在生成的这次可能已经扣费，却拿不到结果。

输出尺寸由页面上选的比例决定。旧的 `OPENAI_IMAGE_SIZE` 已不再使用，`.env` 里留着也没关系。

后端的安全和计费保护：

- 密钥只在后端读取，不进入浏览器；终端日志和页面报错里会遮住密钥。
- 只接受本机页面的请求：用局域网 IP 打开、或其他网站跨站提交，都会被拒绝。
- 同一时间只有一次生成在进行；失败不自动重试，避免一次点击重复扣费。
- 一次多张时，每张是一个独立请求，同时发出，每张单独计费。
- 默认流式返回（`OPENAI_IMAGE_STREAM=true`）：生成过程中持续有数据，中转前面的 Cloudflare 不会因为约 100 秒没有响应而断开。
- 总时限 5 分钟。

常见报错及处理见网站的帮助页，或 `src/pages/HelpPage.vue`。每次生成的结果、耗时和 token 用量都会记在终端里（`[image-api] 生成完成 / 生成失败 …`），同时追加到 `logs/image-api.log`（本地时间，可以和中转后台的记录对照；密钥已遮住；已被 git 忽略）。

## 代码从哪里看

- `shared/options.ts`：所有风格和参数（中文名、可选值、默认值），前后端共用。新增一个风格时，在这里加一项，再在 `server/image-api.ts` 的 `STYLE_PROMPTS` 里写它的英文提示词。少写了，类型检查会报错。
- `src/router.ts`：页面路由。首页和工坊直接打包，画廊、帮助、404 按需加载。
- `src/App.vue`：网站外壳，包括导航栏、页脚和“生成好了”的提示。
- `src/stores/studio.ts`：工坊的状态，包括照片、选项、生成进度和结果。放在页面之外，所以切换页面不会丢；只在内存里，所以刷新就清空。
- `src/stores/history.ts`：作品记录（IndexedDB），只存结果图和设置。
- `src/services/generator.ts`：`detectMode` 询问后端用哪种模式，`generateDemo` 返回固定示例，`generateWithModel` 把照片发给本地后端。
- `src/pages/`：各个页面。`src/components/`：页面共用的部件，包括展示盒、风格示意插画、选项标签、作品卡片和大图查看。
- `server/image-api.ts`：本地后端。`GET /api/config` 告诉页面用哪种模式；`POST /api/generate` 校验照片和选项后调用模型，并把上游错误翻译成中文提示。
- `vite.config.ts`：把后端挂在开发和预览服务器的 `/api` 下，所以 `npm run dev` 一条命令就能同时启动前后端。这个后端只用于本地测试，正式部署需要另外的服务器。
- `src/styles/`：样式按用途拆分。`base` 是配色变量和通用元素，`site` 是导航、页脚、按钮等公共部分，其余按页面分。
- `src/main.ts`：挂载应用并加载字体。Fredoka（拉丁字母和数字）随首屏加载；站酷快乐体（中文标题）异步加载，失败时回退系统字体。两种字体都是 SIL OFL 授权的开源字体，通过 @fontsource 打包在本地，不依赖外部 CDN。
- `public/samples/`：用户提供的 3D 公仔示例图，全身版 1024×1024，头像裁切版 640×640。演示模式的结果和画廊的“官方示例”用的都是它们。

需求见 requirements.md（第一版和 2026-11-01 确认的第二版）。出错时保留输入和上次结果，由用户手动重试；刷新会清空照片。构图和描述的修改在下一次生成时生效。

## 检查

- `npm run build`：类型检查与打包。
- `npm run test:server`：后端测试。用本地假的模型服务模拟各种情况，包括参数、多张、流式、超时、错误提示、密钥遮挡、跨站拒绝和并发锁。不调用真实接口，不花钱，也不读取项目里的 `.env`。
- `tests/e2e.py`：端到端回归，使用 Playwright 和系统 Edge，需要先启动开发服务器。
  - 运行：先 `pip install playwright`，再 `python tests/e2e.py`。
  - 测试会拦截所有 `/api` 请求，所以即使 `.env` 里有真实密钥，也只跑演示模式和模拟的真实模式，不花钱。
  - 每次运行（包括失败时）都会把检查结果、日期和源文件 SHA-256 写入 `artifacts/test-results.json`。
  - Windows 终端里中文输出乱码时，先在 PowerShell 执行 `$env:PYTHONIOENCODING='utf-8'`。

## 部署到服务器

`server/production.ts` 是公网部署用的后端：只提供 `/api`，只监听本机，由 nginx 转发；配置了模型密钥却没有设置访问口令（`ACCESS_CODE`）时拒绝启动。真实生成需要输入主口令或邀请码；每个邀请码有自己的总额度，用 `server/codes.ts` 管理。另有全站每天总张数的上限。nginx 配置、systemd 服务文件和完整步骤见 [deploy/README.md](deploy/README.md)。

## 许可证

[MIT](LICENSE)。示例图（`public/samples/`）和界面字体随项目一起发布，字体按各自的 SIL OFL 授权。
