// 内置的 Q 版公仔头像：账号里只存编号，图案由前端 ChibiAvatar.vue 按编号画出来，服务器不存图片。
// 注意：这里只能用 Node 可以直接去掉类型运行的写法（不要用 enum、namespace）。

export const AVATARS = [
  'bob', 'bun', 'twin', 'curl', 'buzz', 'pony',
  'cap', 'bear', 'glasses', 'clip', 'phones', 'bow',
] as const
export type AvatarId = typeof AVATARS[number]

export const isAvatar = (value: unknown): value is AvatarId => typeof value === 'string' && (AVATARS as readonly string[]).includes(value)

// 没选过头像的账号：按用户编号固定分一个，每次看到的都一样。
export const avatarFor = (stored: string, userId: number): AvatarId => isAvatar(stored) ? stored : AVATARS[Math.abs(userId) % AVATARS.length]
