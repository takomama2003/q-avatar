<script setup lang="ts">
import { STYLES } from '../../shared/options'
import ContactCard from '../components/ContactCard.vue'
import StyleSwatch from '../components/StyleSwatch.vue'
import { FAQ } from '../content/faq'

const sections = [
  { id: 'start', title: '怎么用' },
  { id: 'buy', title: '购买和兑换' },
  { id: 'billing', title: '张数怎么算' },
  { id: 'styles', title: '风格和选项' },
  { id: 'privacy', title: '照片去哪了' },
  { id: 'trouble', title: '没生成成功' },
  { id: 'faq', title: '常见问题' },
]
</script>

<template>
  <div class="container ui-page help-page">
    <header class="ui-page-head reveal" style="--i: 0">
      <div>
        <h1>使用帮助</h1>
        <p>从注册、购买张数到下载公仔，以及照片怎么处理、出了问题怎么办。</p>
      </div>
    </header>
    <div class="help-layout">
      <nav class="help-toc" aria-label="本页目录">
        <a v-for="section in sections" :key="section.id" :href="`#${section.id}`">{{ section.title }}</a>
      </nav>
      <div class="help-content">
        <section id="start" class="help-section" aria-labelledby="start-title">
          <h2 id="start-title">怎么用</h2>
          <ol class="help-steps">
            <li><strong>注册账号。</strong>只要用户名和密码，不需要手机号。</li>
            <li><strong>兑换张数。</strong>加客服微信购买兑换码，在“我的账户”里输入。</li>
            <li><strong>上传照片。</strong>打开<RouterLink to="/studio" class="link-inline">创作工坊</RouterLink>，上传一张 JPG、PNG 或 WebP 照片（不超过 10 MiB）。正脸、光线均匀、只有一个人的照片效果最好。</li>
            <li><strong>选好风格和细节。</strong>风格、构图、比例、表情、姿势、背景，还可以写一句补充描述。</li>
            <li><strong>生成并下载。</strong>一次 1 到 4 张，通常一两分钟。挑喜欢的下载，作品也会自动存进作品画廊。</li>
          </ol>
        </section>

        <section id="buy" class="help-section" aria-labelledby="buy-title">
          <h2 id="buy-title">购买和兑换</h2>
          <ContactCard />
          <p class="help-note">兑换码只能用一次。兑换后张数直接加到你的账户，可以在“我的账户 → 额度变动”里查看每一笔记录。</p>
        </section>

        <section id="billing" class="help-section" aria-labelledby="billing-title">
          <h2 id="billing-title">张数怎么算</h2>
          <ul>
            <li>生成 1 张图用 1 张额度，一次生成 3 张就用 3 张。</li>
            <li>点生成时先占用张数；<strong>没生成出来的会自动退回</strong>，不用找客服。</li>
            <li>一次生成多张时，如果有几张失败，成功的照样给你，失败的那几张退回。</li>
            <li>兑换来的张数没有使用期限。</li>
          </ul>
        </section>

        <section id="styles" class="help-section" aria-labelledby="styles-title">
          <h2 id="styles-title">风格和选项</h2>
          <ul class="style-list">
            <li v-for="style in STYLES" :key="style.id"><StyleSwatch :style="style.id" /><div><strong>{{ style.name }} · {{ style.tagline }}</strong><span>{{ style.note }}</span></div></li>
          </ul>
          <dl class="param-list">
            <dt>构图</dt><dd>头像是胸口以上的半身像；全身是从头到脚的整个小人。</dd>
            <dt>比例</dt><dd>方图 1:1、竖图 2:3、横图 3:2。</dd>
            <dt>头身比</dt><dd>只对全身构图有效：轻 Q（约 4 头身，默认）或 Q 版（2.5 头身，大头小身子）。</dd>
            <dt>表情</dt><dd>“照片原样”保留照片里的表情，也可以换成微笑、大笑、酷酷的、害羞或眨眼。</dd>
            <dt>姿势</dt><dd>只对全身构图有效：自然站立、挥手、比心、坐着、跳起来。</dd>
            <dt>背景</dt><dd>奶油灰、纯白、淡紫，或透明背景（下载的 PNG 可以直接贴到别的图上）。</dd>
          </dl>
        </section>

        <section id="privacy" class="help-section" aria-labelledby="privacy-title">
          <h2 id="privacy-title">照片去哪了</h2>
          <p><strong>上传的照片不保存。</strong>照片只在你点“生成”的那一刻发给图像模型服务，本站服务器不保存照片，也不保存生成的图片。</p>
          <p><strong>作品只在你的浏览器里。</strong>作品画廊里的图存在你当前使用的浏览器里，不含原照片。换浏览器或清除浏览器数据后会消失，喜欢的请及时下载。</p>
          <p><strong>服务器记录什么。</strong>账号（用户名和加密后的密码）、兑换和额度变动、每次生成的时间、风格和结果（成功几张），用来对账和处理问题。</p>
          <p><strong>头像是例外。</strong>如果你上传了头像，或把一张作品设为头像，服务器会保存这一张裁好的小图，只有你自己能看到；换回内置头像时会删除。</p>
          <p><strong>AI 生成标识。</strong>生成的图在页面上标有“AI 生成”，下载的 PNG 文件里也写有 AI 生成的说明。</p>
          <p>详细说明见<RouterLink to="/privacy" class="link-inline">隐私政策</RouterLink>和<RouterLink to="/terms" class="link-inline">用户协议</RouterLink>。</p>
        </section>

        <section id="trouble" class="help-section" aria-labelledby="trouble-title">
          <h2 id="trouble-title">没生成成功</h2>
          <ul>
            <li><strong>提示没通过安全审核：</strong>换一张照片，或改一改补充描述里的词。</li>
            <li><strong>提示透明背景没成功：</strong>换成奶油灰、纯白或淡紫背景再试。</li>
            <li><strong>其他失败或等太久：</strong>照片和设置都会保留，稍等一会儿直接点“重新生成”。没生成出来的张数会自动退回。</li>
            <li>一直不成功，或者觉得张数不对，请联系客服，说明大概时间和用户名。</li>
          </ul>
        </section>

        <section id="faq" class="help-section" aria-labelledby="faq-title">
          <h2 id="faq-title">常见问题</h2>
          <div class="faq">
            <details v-for="item in FAQ" :key="item.q"><summary>{{ item.q }}</summary><p>{{ item.a }}</p></details>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
