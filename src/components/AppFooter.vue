<template>
  <footer class="site-footer">
    <div class="container footer-inner">
      <div class="footer-brand">
        <span class="brand" aria-hidden="true"><span class="brand-mark">t<span>·</span></span><span class="brand-name">Tim_pet</span></span>
        <p>把一张日常照片，变成一个可以收藏的小小公仔。留住一点可爱。</p>
      </div>
      <nav class="footer-col" aria-label="站点">
        <h2>逛一逛</h2>
        <ul>
          <li><RouterLink to="/">首页</RouterLink></li>
          <li><RouterLink to="/studio">创作工坊</RouterLink></li>
          <li><RouterLink to="/gallery">作品画廊</RouterLink></li>
        </ul>
      </nav>
      <nav class="footer-col" aria-label="帮助">
        <h2>需要帮助</h2>
        <ul>
          <li><RouterLink to="/help#start">使用说明</RouterLink></li>
          <li><RouterLink to="/help#privacy">照片去哪了</RouterLink></li>
          <li><RouterLink to="/help#billing">费用说明</RouterLink></li>
          <li><RouterLink to="/help#faq">常见问题</RouterLink></li>
        </ul>
      </nav>
    </div>
    <div class="container footer-bottom">
      <span>Tim_pet · LITTLE COLLECTION</span>
      <span>本地运行 · 无需登录</span>
    </div>
  </footer>
</template>
