// 固定示例图（用户提供的 3D 公仔示例），首页展示柜和画廊“官方示例”共用。
const base = import.meta.env.BASE_URL
export const SAMPLES: ReadonlyArray<{ src: string; title: string; note: string }> = [
  { src: `${base}samples/full.png`, title: '3D 公仔 · 全身', note: '固定示例图，演示模式下“全身”构图会得到它。' },
  { src: `${base}samples/portrait.png`, title: '3D 公仔 · 头像', note: '同一张示例的头像裁切版，演示模式下“头像”构图会得到它。' },
]
