<script setup lang="ts">
import { CONTACT } from '../content/contact'

// 隐私政策（草稿）：逐条对应网站实际收集和处理的数据，正式对外前需要专业人士审核。
const sections = [
  { id: 'collect', title: '我们保存什么' },
  { id: 'photo', title: '照片和生成的图片' },
  { id: 'browser', title: '浏览器里的数据' },
  { id: 'use', title: '用途' },
  { id: 'rights', title: '你的权利' },
  { id: 'contact', title: '联系我们' },
]
</script>

<template>
  <div class="container ui-page help-page">
    <header class="ui-page-head reveal" style="--i: 0">
      <div>
        <h1>隐私政策</h1>
        <p>说明 Tim_pet 保存哪些数据、不保存哪些数据，以及怎么用。</p>
      </div>
    </header>
    <div class="help-layout">
      <nav class="help-toc" aria-label="本页目录">
        <a v-for="section in sections" :key="section.id" :href="`#${section.id}`">{{ section.title }}</a>
      </nav>
      <div class="help-content">
        <p class="ui-alert warn legal-draft" role="note">本政策为草稿版本，正式对外提供服务前会经专业人士审核后更新。</p>

        <section id="collect" class="help-section" aria-labelledby="collect-title">
          <h2 id="collect-title">一、我们在服务器上保存什么</h2>
          <ul>
            <li><strong>账号：</strong>用户名、经过加密处理的密码（无法还原成原文）、选择的头像、注册和最近登录时间。</li>
            <li><strong>你上传的头像：</strong>只有你主动上传头像（或把一张作品设为头像）时才保存这一张，已在你的浏览器里裁成 256×256 的小图，服务器会去掉拍摄地点等元数据。只有你自己登录后能看到；换回内置头像时立即删除。</li>
            <li><strong>登录状态：</strong>登录凭证保存在你浏览器的 Cookie 里，服务器只保存它的加密摘要；30 天不使用会自动失效。</li>
            <li><strong>额度记录：</strong>兑换、生成占用、自动退回、客服调整等每一笔张数变动。</li>
            <li><strong>生成记录：</strong>每次生成的时间、所选风格和构图、请求和成功的张数、失败原因摘要。<strong>不包括照片、补充描述和生成的图片。</strong></li>
            <li><strong>安全日志：</strong>登录、注册时的 IP 地址，用于防止恶意尝试密码，记录在服务器日志里，日志会自动轮换清理。</li>
          </ul>
          <p>我们不收集手机号、邮箱、真实姓名或身份证号。</p>
        </section>

        <section id="photo" class="help-section" aria-labelledby="photo-title">
          <h2 id="photo-title">二、照片和生成的图片</h2>
          <ul>
            <li>你上传的照片只在你点“生成”时，和所选的风格、补充描述一起，经本站服务器转发给第三方图像模型服务，用于生成图片。</li>
            <li>本站服务器<strong>不保存</strong>你上传的照片，也<strong>不保存</strong>生成的图片；图片生成后直接返回给你的浏览器。唯一的例外是你主动设为头像的那一张小图，见上一节。</li>
            <li>第三方模型服务如何处理收到的数据，以该服务商的隐私政策为准。</li>
            <li>生成的图片带有“AI 生成”标识：页面上显示角标，PNG 文件里写入了 AI 生成的说明。</li>
          </ul>
        </section>

        <section id="browser" class="help-section" aria-labelledby="browser-title">
          <h2 id="browser-title">三、你浏览器里的数据</h2>
          <p>作品画廊里的图片和当时的设置保存在你自己的浏览器里（IndexedDB），不上传到服务器，也不包含原照片。你可以在作品画廊里随时删除或清空；清除浏览器数据后也会消失。</p>
        </section>

        <section id="use" class="help-section" aria-labelledby="use-title">
          <h2 id="use-title">四、这些数据的用途</h2>
          <ul>
            <li>让你登录、查看张数和生成记录。</li>
            <li>核对兑换和扣费，处理你反馈的问题。</li>
            <li>统计用量、排查故障、防止滥用。</li>
          </ul>
          <p>我们不会出售你的数据，也不会把账号数据提供给第三方，法律法规另有规定的除外。</p>
        </section>

        <section id="rights" class="help-section" aria-labelledby="rights-title">
          <h2 id="rights-title">五、你的权利</h2>
          <ul>
            <li>你可以随时在“我的账户”里查看自己的额度变动和生成记录，修改密码和头像；换回内置头像就会删除上传的头像。</li>
            <li>如需注销账号、删除账号相关记录，请联系客服。注销后剩余张数作废。</li>
          </ul>
        </section>

        <section id="contact" class="help-section" aria-labelledby="contact-title">
          <h2 id="contact-title">六、联系我们</h2>
          <p>对隐私有任何疑问，请联系客服<template v-if="CONTACT.phone">（手机 {{ CONTACT.phoneDisplay }}，或扫描<RouterLink to="/help#buy" class="link-inline">帮助页</RouterLink>上的微信二维码）</template>。</p>
        </section>
      </div>
    </div>
  </div>
</template>
