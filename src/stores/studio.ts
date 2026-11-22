import { computed, reactive, ref } from 'vue'
import { DEFAULT_OPTIONS, MAX_DESCRIPTION, type CreationOptions } from '../../shared/options'
import { currentUser, loadCurrentUser } from '../services/auth'
import { AccountError, detectMode, generateWithModel, type GenerationResult, type ServiceMode } from '../services/generator'
import { addWorks } from './history'

// 工坊的状态放在页面之外：切到画廊或帮助页时，照片、选项和正在进行的生成都不会丢。
// 只存在内存里，刷新页面就清空（不保存上传的照片）。
const mode = ref<ServiceMode>({ kind: 'off' })
const modeReady = ref(false)
const photo = ref<File | null>(null)
const photoUrl = ref('')
const options = reactive<CreationOptions>({ ...DEFAULT_OPTIONS })
const busy = ref(false)
const validating = ref(false)
const error = ref('')
const failed = ref(false)
const status = ref('')
const result = ref<GenerationResult | null>(null)
const selected = ref(0)
const elapsed = ref(0)
// 生成完成但用户还没回到工坊看：导航栏显示小圆点，并弹出提示
const unseen = ref(false)
let ticker = 0
let selection = 0
let detecting: Promise<void> | null = null

// 生成要登录（公网部署开着账号）：没登录时也能选照片和选项，点生成再去登录。
const accounts = computed(() => mode.value.kind === 'model' && mode.value.accounts)
const signedIn = computed(() => !!currentUser.value)
// 后端配好了模型才能生成；没配好时页面显示“暂时不能生成”
const available = computed(() => mode.value.kind === 'model')
// 上次生成被拒的原因：没登录，或者额度用完了
const accountProblem = ref<'' | 'login_required' | 'no_credits'>('')
const modelName = computed(() => mode.value.kind === 'model' ? mode.value.model : '')
const locked = computed(() => busy.value || validating.value)
const charCount = computed(() => Array.from(options.description).length)
const current = computed(() => result.value?.images[selected.value] ?? null)

function clearResult() {
  for (const image of result.value?.images ?? []) URL.revokeObjectURL(image.url)
  result.value = null
  selected.value = 0
}

function init() {
  detecting ??= (async () => {
    // 模式和登录状态一起查：登录了才算真实生成模式
    const [detected] = await Promise.all([detectMode(), loadCurrentUser()])
    mode.value = detected
    modeReady.value = true
    if (mode.value.kind === 'off') console.warn('[Tim_pet] 生成服务未启用：', mode.value.problem ?? '后端没有配置模型')
    else if (photo.value && !busy.value) status.value = readyText()
  })()
  return detecting
}
const readyText = () => accounts.value && !signedIn.value ? '照片已就绪，登录后就能生成。' : '照片已就绪，可以生成了。'

async function choose(files: FileList | File[]) {
  if (locked.value) return
  error.value = ''
  const candidate = files[0]
  if (files.length !== 1 || !candidate) { error.value = '请一次选择一张照片。'; return }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(candidate.type)) { error.value = '请选择 JPG、PNG 或 WebP 图片。'; return }
  if (candidate.size > 10 * 1024 * 1024) { error.value = '照片不能超过 10 MiB，请压缩后重试。'; return }
  const ticket = ++selection
  const url = URL.createObjectURL(candidate)
  validating.value = true
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (ticket !== selection) { URL.revokeObjectURL(url); return }
    if (photoUrl.value) URL.revokeObjectURL(photoUrl.value)
    photo.value = candidate
    photoUrl.value = url
    clearResult(); failed.value = false
    status.value = readyText()
  } catch { URL.revokeObjectURL(url); error.value = '无法读取这张图片，请选择其他照片。' }
  finally { validating.value = false }
}

function removePhoto() {
  if (locked.value) return
  selection++
  if (photoUrl.value) URL.revokeObjectURL(photoUrl.value)
  photo.value = null; photoUrl.value = ''; clearResult(); failed.value = false; error.value = ''; status.value = ''
}

function setDescription(value: string) {
  options.description = Array.from(value).slice(0, MAX_DESCRIPTION).join('')
}

// 画廊里“用同样的设置再做”：照片没有保存，需要重新上传。
function applyOptions(next: CreationOptions) {
  if (locked.value) return
  Object.assign(options, { ...next, description: Array.from(next.description).slice(0, MAX_DESCRIPTION).join('') })
  status.value = photo.value ? '已套用这组设置，可以直接生成。' : '已套用这组设置。原照片没有保存，请重新上传一张。'
}

async function generate() {
  if (locked.value || !modeReady.value || !available.value) return false
  if (!photo.value) { error.value = '请先上传一张照片。'; return false }
  const model = modelName.value
  const count = options.count
  // 没登录：不发请求，页面引导去登录（照片和设置保留）
  if (accounts.value && !currentUser.value) {
    accountProblem.value = 'login_required'
    error.value = '登录后才能生成。照片和设置会保留，登录完回来直接点生成。'
    return false
  }
  // 登录了但张数不够：不发请求，提示去兑换
  if (accounts.value && currentUser.value && currentUser.value.credits < count) {
    accountProblem.value = 'no_credits'
    error.value = currentUser.value.credits ? `你只剩 ${currentUser.value.credits} 张，请减少张数，或者购买兑换码。` : '你的张数用完了。联系客服购买兑换码，兑换后就能继续生成。'
    return false
  }
  busy.value = true; error.value = ''; unseen.value = false; accountProblem.value = ''
  status.value = `正在生成${count > 1 ? ` ${count} 张` : ''}，通常需要一两分钟，请不要刷新页面。`
  const started = performance.now()
  elapsed.value = 0
  ticker = window.setInterval(() => { elapsed.value = Math.floor((performance.now() - started) / 1000) }, 1000)
  try {
    const input = { photo: photo.value, options: { ...options } }
    const next = await generateWithModel(input, model)
    if (next.balance !== undefined && currentUser.value) currentUser.value = { ...currentUser.value, credits: next.balance }
    clearResult(); result.value = next; failed.value = false; unseen.value = true
    const n = next.images.length
    const seconds = Math.max(1, Math.round((performance.now() - started) / 1000))
    status.value = `生成完成，用时 ${seconds} 秒${n > 1 ? `，共 ${n} 张` : ''}。${next.warning ? next.warning : ''}${next.balance !== undefined ? ` 你还剩 ${next.balance} 张。` : ''}`
    void addWorks(next)
    return true
  } catch (reason) {
    failed.value = true
    error.value = reason instanceof Error ? reason.message : '这次没有生成成功，请重试。'
    status.value = '生成失败；照片和设置已保留。'
    if (reason instanceof AccountError) {
      // 登录过期或额度用完：同步一下账号状态，页面会显示去登录或去兑换的入口
      accountProblem.value = reason.code
      void loadCurrentUser()
      status.value = reason.code === 'login_required' ? '登录后才能生成；照片和设置已保留。' : '张数用完了；照片和设置已保留。'
    }
    return false
  } finally {
    window.clearInterval(ticker)
    busy.value = false
  }
}

const studio = {
  mode, modeReady, modelName, available, accounts, signedIn, accountProblem, photo, photoUrl, options, busy, validating, locked, error, failed, status, result, selected, current,
  elapsed, unseen, charCount, init, choose, removePhoto, setDescription, applyOptions, generate,
}
export function useStudio() { return studio }
