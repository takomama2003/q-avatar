// 每个内置头像的画法参数（ChibiAvatar.vue 用）：发型、发色、肤色、底色、表情、配饰颜色。编号见 shared/avatars.ts。
import type { AvatarId } from '../../shared/avatars'

export type Eyes = 'dot' | 'happy' | 'wink' | 'cool' | 'shy'
export interface AvatarLook { name: string; hair: string; skin: string; bg: string; eyes: Eyes; accent?: string }

export const AVATAR_LOOKS: Record<AvatarId, AvatarLook> = {
  bob: { name: '波波头', hair: '#3b2a33', skin: '#ffe2d1', bg: '#efe7fb', eyes: 'dot' },
  bun: { name: '丸子头', hair: '#7a4a35', skin: '#f6d0b5', bg: '#fdf1dc', eyes: 'happy', accent: '#e86a8f' },
  twin: { name: '双马尾', hair: '#d97a9f', skin: '#ffe2d1', bg: '#fde8ef', eyes: 'wink', accent: '#f4c542' },
  curl: { name: '小卷毛', hair: '#6f52a8', skin: '#f6d0b5', bg: '#efe7fb', eyes: 'dot' },
  buzz: { name: '短寸头', hair: '#2a2530', skin: '#e9b996', bg: '#e6f4ee', eyes: 'cool' },
  pony: { name: '马尾辫', hair: '#c98f3a', skin: '#ffe2d1', bg: '#fdf1dc', eyes: 'happy', accent: '#6f52a8' },
  cap: { name: '棒球帽', hair: '#3b2a33', skin: '#f6d0b5', bg: '#e5eefb', eyes: 'dot', accent: '#6f52a8' },
  bear: { name: '小熊帽', hair: '#a77b5a', skin: '#ffe2d1', bg: '#f3ece2', eyes: 'shy', accent: '#f2c9a8' },
  glasses: { name: '圆眼镜', hair: '#2a2530', skin: '#ffe2d1', bg: '#e5eefb', eyes: 'dot', accent: '#3b2a33' },
  clip: { name: '长直发', hair: '#3b2a33', skin: '#f6d0b5', bg: '#fde8ef', eyes: 'shy', accent: '#f4c542' },
  phones: { name: '戴耳机', hair: '#4f9c86', skin: '#ffe2d1', bg: '#e6f4ee', eyes: 'happy', accent: '#6f52a8' },
  bow: { name: '蝴蝶结', hair: '#7a4a35', skin: '#ffe2d1', bg: '#fde8ef', eyes: 'dot', accent: '#e86a8f' },
}
