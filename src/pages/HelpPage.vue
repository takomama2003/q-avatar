<script setup lang="ts">
import { STYLES } from '../../shared/options'
import StyleSwatch from '../components/StyleSwatch.vue'
import { FAQ } from '../content/faq'

const sections = [
  { id: 'start', title: '快速上手' },
  { id: 'modes', title: '两种模式' },
  { id: 'styles', title: '风格和参数' },
  { id: 'privacy', title: '照片去哪了' },
  { id: 'billing', title: '费用说明' },
  { id: 'errors', title: '常见报错' },
  { id: 'faq', title: '常见问题' },
]
const errors = [
  ['中转服务等模型结果超时断开了（524）', '中转前面的 Cloudflare 约 100 秒没收到数据就断开。在 .env 里把 OPENAI_IMAGE_QUALITY 改成 medium 或 low；这次可能已扣费，可在中转后台查看。'],
  ['模型服务不接受流式参数', '这个中转不支持流式返回。在 .env 里加一行 OPENAI_IMAGE_STREAM=false。'],
  ['这个模型或中转不支持透明背景', '换成奶油灰、纯白或淡紫背景。'],
  ['API 密钥无效或已过期', '检查 .env 里的 OPENAI_API_KEY，注意不要多复制空格。'],
  ['接口地址或模型名不对', '检查 OPENAI_BASE_URL（中转地址，带不带 /v1 都可以）和 OPENAI_IMAGE_MODEL。'],
  ['没有通过模型的安全审核', '换一张照片，或改一改描述里的词。'],
  ['请求太频繁或账户额度不足', '稍等一会儿再试，或去服务商后台查看余额；一次生成多张时更容易遇到。'],
  ['连不上模型服务 / 连不上本地后端', '检查网络和地址；如果刚改过 .env，开发服务器会自动重启，等几秒再试。'],
  ['图像接口只接受本机页面的请求', '请用 http://127.0.0.1 或 localhost 打开页面，不要用局域网 IP。'],
]
</script>

<template>
  <div class="container">
    <header class="page-head reveal" style="--i: 0">
      <p class="eyebrow">THE LITTLE MANUAL</p>
      <h1>使用<mark class="hl">说明书</mark></h1>
      <p class="subtitle">从上传照片到下载公仔，以及照片去向、费用和出错时怎么办。</p>
    </header>
    <div class="help-layout">
      <nav class="help-toc" aria-label="本页目录">
        <strong>目录</strong>
        <a v-for="section in sections" :key="section.id" :href="`#${section.id}`">{{ section.title }}</a>
      </nav>
      <div class="help-content">
        <section id="start" class="help-section" aria-labelledby="start-title">
          <h2 id="start-title"><span class="step-no">01</span>快速上手</h2>
          <ol>
            <li>打开<RouterLink to="/studio" class="link-more">创作工坊</RouterLink>，上传一张 JPG、PNG 或 WebP 照片（不超过 10 MiB）。正脸、光线均匀、只有一个人的照片效果最好。</li>
            <li>选一个系列，再选构图（头像或全身）、比例、头身比、表情、姿势和背景。</li>
            <li>想加点什么就写在“加一点想象”里，最多 200 字。</li>
            <li>选一次生成几张，点“生成”。生成时可以去别的页面逛逛，好了会提示你。</li>
            <li>点缩略图挑一张，下载到本地。做好的作品也会自动摆进作品画廊。</li>
          </ol>
        </section>

        <section id="modes" class="help-section" aria-labelledby="modes-title">
          <h2 id="modes-title"><span class="step-no">02</span>两种模式</h2>
          <p>页面右上角的标签会告诉你当前是哪种模式。</p>
          <div class="mode-cards">
            <div class="mode-card"><h3>前端演示版</h3><p>没有配置模型时的默认模式。点生成会得到固定的示例图，只跟“头像 / 全身”有关，不根据照片生成，也不花钱。适合先熟悉流程。</p></div>
            <div class="mode-card"><h3>已配置模型</h3><p>在项目的 <code>.env</code> 里填好接口地址和密钥后自动开启。照片会发给图像模型，按你的样子真实生成，按张计费。</p></div>
          </div>
        </section>

        <section id="styles" class="help-section" aria-labelledby="styles-title">
          <h2 id="styles-title"><span class="step-no">03</span>风格和参数</h2>
          <ul class="style-list">
            <li v-for="style in STYLES" :key="style.id"><StyleSwatch :style="style.id" /><div><strong>{{ style.name }} · {{ style.tagline }}</strong><span>{{ style.note }}</span></div></li>
          </ul>
          <dl class="param-list">
            <dt>构图</dt><dd>头像是胸口以上的半身像；全身是从头到脚的整个小人。</dd>
            <dt>比例</dt><dd>方图 1:1（1024×1024）、竖图 2:3（1024×1536）、横图 3:2（1536×1024）。</dd>
            <dt>头身比</dt><dd>只对全身构图有效：轻 Q（约 4 头身，头稍大、腿修长，默认）或 Q 版（2.5 头身，大头小身子）。</dd>
            <dt>表情</dt><dd>“照片原样”保留照片里的表情，也可以换成微笑、大笑、酷酷的、害羞或眨眼。</dd>
            <dt>姿势</dt><dd>只对全身构图有效：自然站立、挥手、比心、坐着、跳起来。</dd>
            <dt>背景</dt><dd>奶油灰、纯白、淡紫，或透明背景（下载的 PNG 可以直接贴到别的图上；少数中转不支持）。</dd>
            <dt>数量</dt><dd>一次 1 到 4 张，每张单独计费，方便挑出最喜欢的一张。</dd>
          </dl>
        </section>

        <section id="privacy" class="help-section" aria-labelledby="privacy-title">
          <h2 id="privacy-title"><span class="step-no">04</span>照片去哪了</h2>
          <p><strong>上传的照片不保存。</strong>它只在当前页面里使用，刷新页面就清除。</p>
          <p><strong>演示模式</strong>下照片不离开你的浏览器。<strong>真实生成</strong>时，照片和描述只在点击生成那一刻，经本地后端和你配置的接口发给模型服务；对方如何保存以服务商的政策为准。密钥只在本地后端读取，不会出现在网页里。</p>
          <p><strong>作品画廊</strong>里的结果图存在这台电脑的浏览器里（IndexedDB），不含原照片，也不会上传。换浏览器或清除浏览器数据后会消失，可以在画廊里一键清空。</p>
        </section>

        <section id="billing" class="help-section" aria-labelledby="billing-title">
          <h2 id="billing-title"><span class="step-no">05</span>费用说明</h2>
          <ul>
            <li>演示模式不花钱。</li>
            <li>真实生成每张单独计费：一次生成 3 张就是 3 张的费用。具体价格看你使用的模型服务。</li>
            <li>失败时不会自动重试，避免一次点击重复扣费；要不要再试由你决定。</li>
            <li>超时或连接中断时，模型那边可能已经生成并扣费，建议先去服务商后台看一下再重试。</li>
            <li>画质由 <code>.env</code> 里的 <code>OPENAI_IMAGE_QUALITY</code> 决定（默认 high）。改成 medium 或 low 会更快；官方接口也更便宜，有些中转按次收固定价格，画质不影响费用。</li>
          </ul>
        </section>

        <section id="errors" class="help-section" aria-labelledby="errors-title">
          <h2 id="errors-title"><span class="step-no">06</span>常见报错</h2>
          <p>出错时照片和设置都会保留，改好后直接点“重试”。终端里也会记一行 <code>[image-api]</code> 日志，方便排查。</p>
          <div class="table-wrap">
            <table class="error-table">
              <thead><tr><th scope="col">页面提示</th><th scope="col">原因和处理</th></tr></thead>
              <tbody><tr v-for="[message, fix] in errors" :key="message"><td>{{ message }}</td><td>{{ fix }}</td></tr></tbody>
            </table>
          </div>
        </section>

        <section id="faq" class="help-section" aria-labelledby="faq-title">
          <h2 id="faq-title"><span class="step-no">07</span>常见问题</h2>
          <div class="faq">
            <details v-for="item in FAQ" :key="item.q"><summary>{{ item.q }}</summary><p>{{ item.a }}</p></details>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
