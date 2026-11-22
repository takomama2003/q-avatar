<template>
  <div class="container ui-page">
    <div class="ui-card not-found reveal" style="--i: 0">
      <p class="not-found-code">404</p>
      <h1>页面不存在</h1>
      <p>可能是地址输错了，或者这个页面已经搬走了。</p>
      <div class="not-found-actions">
        <RouterLink class="ui-btn ui-btn-primary" to="/">回到首页</RouterLink>
        <RouterLink class="ui-btn ui-btn-secondary" to="/studio">去创作工坊</RouterLink>
      </div>
    </div>
  </div>
</template>
