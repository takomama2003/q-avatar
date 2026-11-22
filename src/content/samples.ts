// 示例作品（本站生成的 3D 公仔），首页、工坊和画廊共用。
const base = import.meta.env.BASE_URL
export const SAMPLES: ReadonlyArray<{ src: string; title: string; note: string }> = [
  { src: `${base}samples/full.png`, title: '3D 公仔 · 全身', note: '3D 公仔风格，全身构图。' },
  { src: `${base}samples/portrait.png`, title: '3D 公仔 · 头像', note: '3D 公仔风格，头像构图。' },
]
