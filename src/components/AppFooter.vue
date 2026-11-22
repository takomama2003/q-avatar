<script setup lang="ts">
import { CONTACT } from '../content/contact'
</script>

<template>
  <footer class="site-footer">
    <div class="container footer-inner">
      <div class="footer-brand">
        <span class="brand" aria-hidden="true"><span class="brand-mark">t<span>·</span></span><span class="brand-name">Tim_pet</span></span>
        <p>上传一张照片，做成你的 Q 版公仔。</p>
      </div>
      <nav class="footer-col" aria-label="站点">
        <h2>开始</h2>
        <ul>
          <li><RouterLink to="/studio">创作工坊</RouterLink></li>
          <li><RouterLink to="/gallery">作品画廊</RouterLink></li>
          <li><RouterLink to="/account">我的账户</RouterLink></li>
        </ul>
      </nav>
      <nav class="footer-col" aria-label="帮助">
        <h2>帮助</h2>
        <ul>
          <li><RouterLink to="/help#start">怎么用</RouterLink></li>
          <li><RouterLink to="/help#buy">购买兑换码</RouterLink></li>
          <li><RouterLink to="/help#faq">常见问题</RouterLink></li>
          <li v-if="CONTACT.phone">客服电话 <a :href="`tel:${CONTACT.phone}`">{{ CONTACT.phoneDisplay }}</a></li>
        </ul>
      </nav>
    </div>
    <div class="container footer-bottom">
      <span>© {{ new Date().getFullYear() }} Tim_pet · 图片由 AI 生成</span>
      <span class="footer-legal"><RouterLink to="/terms">用户协议</RouterLink><RouterLink to="/privacy">隐私政策</RouterLink></span>
    </div>
  </footer>
</template>
