import { reactive, ref } from 'vue'
import type { CreationOptions, GenerationResult } from '../services/generator'

// 创作记录：只把生成的结果图存在本机浏览器（IndexedDB），不存上传的原照片，也不上传到任何地方。
export interface WorkRecord {
  id: string
  createdAt: number
  source: 'demo' | 'model' // 'demo' 只出现在旧版本存下的作品里
  model?: string
  options: CreationOptions
  blob: Blob
  extension: string
}
export interface Work extends WorkRecord { url: string }

export const MAX_WORKS = 60
const DB_NAME = 'tim-pet'
const STORE = 'works'
const works = reactive<Work[]>([])
const available = ref(true)
let loading: Promise<void> | null = null

function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
let opening: Promise<IDBDatabase> | null = null
function db() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1)
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'id' })
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
    open.onblocked = () => reject(new Error('blocked'))
  }).catch(error => { opening = null; throw error })
  return opening
}
async function store(mode: IDBTransactionMode) {
  return (await db()).transaction(STORE, mode).objectStore(STORE)
}
const toWork = (record: WorkRecord): Work => ({ ...record, url: URL.createObjectURL(record.blob) })

export function ensureLoaded() {
  loading ??= (async () => {
    try {
      const records = await request((await store('readonly')).getAll() as IDBRequest<WorkRecord[]>)
      records.sort((a, b) => b.createdAt - a.createdAt)
      works.splice(0, works.length, ...records.map(toWork))
    } catch { available.value = false } // 无痕模式或浏览器禁用存储时，记录功能不可用，但不影响生成
  })()
  return loading
}

// 一次生成的每张图各存一条，最新的在前；超过上限时删掉最早的。
export async function addWorks(result: GenerationResult) {
  await ensureLoaded()
  if (!available.value) return
  const now = Date.now()
  const records: WorkRecord[] = result.images.map((image, index) => ({
    id: `${now.toString(36)}-${index}-${Math.random().toString(36).slice(2, 10)}`, createdAt: now + index, source: result.source, model: result.model,
    options: { ...result.options }, blob: image.blob, extension: image.extension,
  }))
  try {
    const target = await store('readwrite')
    for (const record of records) target.put(record)
    await new Promise<void>((resolve, reject) => { target.transaction.oncomplete = () => resolve(); target.transaction.onerror = () => reject(target.transaction.error) })
  } catch { available.value = false; return }
  works.unshift(...records.reverse().map(toWork))
  if (works.length > MAX_WORKS) for (const old of works.slice(MAX_WORKS)) await removeWork(old.id)
}

export async function removeWork(id: string) {
  const index = works.findIndex(work => work.id === id)
  if (index < 0) return
  const [work] = works.splice(index, 1)
  URL.revokeObjectURL(work.url)
  try { await request((await store('readwrite')).delete(id)) } catch { /* 已从列表移除，下次加载时再试 */ }
}

export async function clearWorks() {
  for (const work of works) URL.revokeObjectURL(work.url)
  works.splice(0, works.length)
  try { await request((await store('readwrite')).clear()) } catch { /* 同上 */ }
}

export function useHistory() {
  void ensureLoaded()
  return { works, available, removeWork, clearWorks }
}
