// 前后端共用的创作选项。页面用中文名展示，后端用 id 校验并拼提示词（英文提示词只在 server/ 里）。
// 注意：这里只能用 Node 可以直接去掉类型运行的写法（不要用 enum、namespace）。

export type Composition = 'portrait' | 'full'
export type StyleId = 'figure' | 'blindbox' | 'clay' | 'pixel' | 'watercolor'
export type ExpressionId = 'keep' | 'smile' | 'laugh' | 'cool' | 'shy' | 'wink'
export type PoseId = 'stand' | 'wave' | 'heart' | 'sit' | 'jump'
export type BackgroundId = 'cream' | 'white' | 'lilac' | 'transparent'
export type RatioId = 'square' | 'tall' | 'wide'
export type ProportionId = 'light' | 'chibi'

export interface CreationOptions {
  style: StyleId
  composition: Composition
  ratio: RatioId
  proportion: ProportionId
  expression: ExpressionId
  pose: PoseId
  background: BackgroundId
  description: string
  count: number
}

export const STYLES: ReadonlyArray<{ id: StyleId; name: string; tagline: string; note: string }> = [
  { id: 'figure', name: '3D 公仔', tagline: '软软的搪胶手办', note: '圆润的大头比例，哑光材质，像摆在书桌上的小手办。' },
  { id: 'blindbox', name: '盲盒潮玩', tagline: '亮面 PVC 小摆件', note: '亮晶晶的大眼睛和光泽感，脚下带一个展示底座。' },
  { id: 'clay', name: '黏土小人', tagline: '手捏黏土定格动画', note: '能看到手捏痕迹的黏土质感，温暖又有点笨拙的可爱。' },
  { id: 'pixel', name: '像素小人', tagline: '复古游戏角色', note: '清晰的像素块和有限的颜色，像老游戏里的主角。' },
  { id: 'watercolor', name: '水彩贴纸', tagline: '手绘贴纸插画', note: '柔和的水彩笔触，外面一圈白色贴纸描边。' },
]
export const COMPOSITIONS: ReadonlyArray<{ id: Composition; name: string; note: string }> = [
  { id: 'portrait', name: '头像', note: '记录你的表情' },
  { id: 'full', name: '全身', note: '收藏整个小小的你' },
]
export const RATIOS: ReadonlyArray<{ id: RatioId; name: string; size: string }> = [
  { id: 'square', name: '方图 1:1', size: '1024x1024' },
  { id: 'tall', name: '竖图 2:3', size: '1024x1536' },
  { id: 'wide', name: '横图 3:2', size: '1536x1024' },
]
// 头身比只对全身构图有意义（头像只拍到胸口）
export const PROPORTIONS: ReadonlyArray<{ id: ProportionId; name: string; note: string }> = [
  { id: 'light', name: '轻 Q · 约 4 头身', note: '头稍大、腿修长，像精致的小手办' },
  { id: 'chibi', name: 'Q 版 · 2.5 头身', note: '大头小身子，更萌' },
]
export const EXPRESSIONS: ReadonlyArray<{ id: ExpressionId; name: string }> = [
  { id: 'keep', name: '照片原样' },
  { id: 'smile', name: '微笑' },
  { id: 'laugh', name: '开怀大笑' },
  { id: 'cool', name: '酷酷的' },
  { id: 'shy', name: '害羞' },
  { id: 'wink', name: '眨眼' },
]
// 姿势只对全身构图有意义
export const POSES: ReadonlyArray<{ id: PoseId; name: string }> = [
  { id: 'stand', name: '自然站立' },
  { id: 'wave', name: '挥手' },
  { id: 'heart', name: '比心' },
  { id: 'sit', name: '坐着' },
  { id: 'jump', name: '跳起来' },
]
export const BACKGROUNDS: ReadonlyArray<{ id: BackgroundId; name: string; swatch: string }> = [
  { id: 'cream', name: '奶油灰', swatch: '#f1efec' },
  { id: 'white', name: '纯白', swatch: '#ffffff' },
  { id: 'lilac', name: '淡紫', swatch: '#ece4f7' },
  { id: 'transparent', name: '透明', swatch: 'transparent' },
]
export const MAX_COUNT = 4
export const MAX_DESCRIPTION = 200

export const DEFAULT_OPTIONS: CreationOptions = {
  style: 'figure',
  composition: 'portrait',
  ratio: 'square',
  proportion: 'light',
  expression: 'keep',
  pose: 'stand',
  background: 'cream',
  description: '',
  count: 1,
}

export function nameOf<T extends { id: string; name: string }>(list: ReadonlyArray<T>, id: string) {
  return list.find(item => item.id === id)?.name ?? id
}
