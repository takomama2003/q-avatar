// 客服联系方式：手机号和微信二维码从本机的 .env.production.local 读取（打包时写进页面），不进开源仓库。
// 没配置时页面显示“暂未配置”，不报错。
const env = import.meta.env as Record<string, string | undefined>
const phone = (env.VITE_CONTACT_PHONE ?? '').trim()
const qr = (env.VITE_CONTACT_WECHAT_QR ?? '').trim().replace(/^\/+/, '')

export const CONTACT = {
  phone,
  // 手机号按 3-4-4 分组显示，方便看清
  phoneDisplay: /^\d{11}$/.test(phone) ? `${phone.slice(0, 3)} ${phone.slice(3, 7)} ${phone.slice(7)}` : phone,
  wechatQr: qr ? `${import.meta.env.BASE_URL}${qr}` : '',
  configured: !!(phone || qr),
}
