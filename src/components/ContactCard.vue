<script setup lang="ts">
import { CONTACT } from '../content/contact'

// 客服联系卡：购买兑换码、找回密码、生成出问题时都用它。
withDefaults(defineProps<{ title?: string; lead?: string; compact?: boolean }>(), {
  title: '购买兑换码',
  lead: '加客服微信，说明想要的张数，付款后会收到兑换码，在“我的账户”里输入就能用。',
  compact: false,
})
</script>

<template>
  <div class="contact-card" :class="{ compact }">
    <img v-if="CONTACT.wechatQr" class="contact-qr" :src="CONTACT.wechatQr" alt="客服微信二维码" width="160" height="160" loading="lazy">
    <div class="contact-text">
      <h3>{{ title }}</h3>
      <p>{{ lead }}</p>
      <dl v-if="CONTACT.configured" class="contact-ways">
        <template v-if="CONTACT.wechatQr"><dt>微信</dt><dd>扫左边的二维码添加</dd></template>
        <template v-if="CONTACT.phone"><dt>手机</dt><dd><a :href="`tel:${CONTACT.phone}`">{{ CONTACT.phoneDisplay }}</a></dd></template>
      </dl>
      <p v-else class="ui-hint">客服联系方式暂未配置。</p>
      <slot />
    </div>
  </div>
</template>
