<template>
  <div class="container page-head">
    <div class="empty reveal" style="--i: 0">
      <svg viewBox="0 0 120 100" aria-hidden="true"><path d="M14 40 60 22l46 18-46 18z" /><path d="M14 40v34l46 18 46-18V40M60 58v34" /><path d="M14 40 4 26l46-18 10 14M106 40l10-14-46-18-10 14" stroke-dasharray="4 4" /></svg>
      <h1>这个盒子是空的</h1>
      <p>页面不存在，可能是地址输错了，或者它已经被搬走了。</p>
      <div class="hero-actions">
        <RouterLink class="btn btn-primary" to="/">回到首页</RouterLink>
        <RouterLink class="btn btn-secondary" to="/studio">去创作工坊</RouterLink>
      </div>
    </div>
  </div>
</template>
