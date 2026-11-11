<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowRight,
  Back,
  Delete,
  Document,
  Edit,
  Folder,
  FolderAdd,
  FolderOpened,
  Monitor,
  MoreFilled,
  Plus,
  Refresh,
  SetUp,
  VideoPlay
} from '@element-plus/icons-vue'
import { iconUrl, service, type LauncherApp, type LauncherFolder } from './rpc'

defineOptions({ name: 'StartExePage' })

const folders = ref<LauncherFolder[]>([])
const loading = ref(true)
const error = ref('')
const activeFolderId = ref<number | null>(null)
const dragOver = ref(false)
const failedIcons = ref<Set<string>>(new Set())

function markIconFailed(path: string) {
  if (!path || failedIcons.value.has(path)) return
  failedIcons.value = new Set(failedIcons.value).add(path)
}

function folderMenuCommand(command: string, folder: LauncherFolder) {
  if (command === 'open') openFolder(folder)
  else if (command === 'launch-all') launchFolder(folder)
  else if (command === 'rename') renameFolder(folder)
  else if (command === 'delete') removeFolder(folder)
}

function appMenuCommand(command: string, app: LauncherApp) {
  if (command === 'launch') launchOne(app)
  else if (command === 'edit') openEdit(app)
  else if (command === 'reveal') revealApp(app)
  else if (command === 'delete') deleteApp(app)
}

function hasRealIcon(app: LauncherApp) {
  return Boolean(app.path) && !failedIcons.value.has(app.path)
}

const editOpen = ref(false)
const editingId = ref<number | null>(null)
const editForm = reactive({ title: '', path: '', args: '', delay: 0 })

let idSeq = 0
function nextId() {
  idSeq = (idSeq + 1) % 1000
  return Date.now() * 1000 + idSeq
}

function baseName(path: string) {
  return String(path || '').split(/[\\/]/).pop() || String(path || '')
}

function titleFromPath(path: string) {
  return baseName(path).replace(/\.[^/.]+$/, '') || baseName(path)
}

// 兼容旧数据里的 FontAwesome 图标字段（界面不再使用 base64 / FontAwesome）
function iconClassFor(path: string) {
  const ext = (baseName(path).split('.').pop() || '').toLowerCase()
  if (ext === 'exe') return 'fab fa-windows'
  if (ext === 'app') return 'fab fa-apple'
  if (ext === 'bat' || ext === 'cmd' || ext === 'sh') return 'fas fa-terminal'
  return 'fas fa-file'
}

function makeApp(path: string): LauncherApp {
  return {
    id: nextId(),
    title: titleFromPath(path),
    path,
    iconClass: iconClassFor(path),
    args: '',
    delay: 0,
  }
}

const appTotal = computed(() => folders.value.reduce((sum, folder) => sum + folder.apps.length, 0))
const activeFolder = computed(() => (
  folders.value.find(folder => folder.id === activeFolderId.value) || null
))

const EXT_ICONS: Record<string, unknown> = {
  exe: Monitor,
  app: Monitor,
  bat: SetUp,
  cmd: SetUp,
  sh: SetUp,
}

function iconOf(app: LauncherApp) {
  const ext = (baseName(app.path).split('.').pop() || '').toLowerCase()
  return EXT_ICONS[ext] || Document
}

function previewApps(folder: LauncherFolder) {
  return folder.apps.slice(0, folder.apps.length > 6 ? 5 : 6)
}

async function persist() {
  try {
    const result = await service.save(folders.value)
    if (Array.isArray(result.folders)) folders.value = result.folders
  } catch (err: any) {
    error.value = err.message
    ElMessage.error(`保存失败：${err.message}`)
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await service.bootstrap()
    folders.value = Array.isArray(result.folders) ? result.folders : []
  } catch (err: any) {
    error.value = err.message || '本地服务不可用'
  } finally {
    loading.value = false
  }
}

function openFolder(folder: LauncherFolder) {
  activeFolderId.value = folder.id
}

function closeFolder() {
  activeFolderId.value = null
}

async function createFolder() {
  const folder: LauncherFolder = {
    id: nextId(),
    title: `文件夹 ${folders.value.length + 1}`,
    expanded: true,
    apps: [],
  }
  folders.value.push(folder)
  activeFolderId.value = folder.id
  await persist()
}

async function addPaths(paths: string[]) {
  const clean = paths.map(path => String(path || '').trim()).filter(Boolean)
  if (!clean.length) return
  const folder = activeFolder.value
  if (folder) {
    folder.apps.push(...clean.map(makeApp))
  } else {
    for (const path of clean) {
      folders.value.push({
        id: nextId(),
        title: titleFromPath(path),
        expanded: true,
        apps: [makeApp(path)],
      })
    }
  }
  await persist()
  ElMessage.success(`已添加 ${clean.length} 个应用`)
}

async function addFromPicker() {
  try {
    const paths = await service.pickFiles()
    if (paths.length) await addPaths(paths)
  } catch (err: any) {
    ElMessage.error(err.message || '选择文件失败')
  }
}

async function launchApps(apps: LauncherApp[]) {
  if (!apps.length) return
  try {
    const result = await service.launch(
      apps.map(app => ({ path: app.path, args: app.args, delay: app.delay }))
    )
    if (result.failed?.length) ElMessage.warning(result.failed.join('；'))
    else ElMessage.success(`正在启动 ${apps.length} 个应用`)
  } catch (err: any) {
    ElMessage.error(`启动失败：${err.message}`)
  }
}

function launchOne(app: LauncherApp) {
  launchApps([app])
}

function launchAll() {
  if (activeFolder.value) launchApps(activeFolder.value.apps)
}

async function openRecycleBin() {
  try {
    await service.openRecycleBin()
  } catch (err: any) {
    ElMessage.error(err.message)
  }
}

async function revealApp(app: LauncherApp) {
  try {
    await service.reveal(app.path)
  } catch (err: any) {
    ElMessage.error(err.message)
  }
}

function openEdit(app: LauncherApp) {
  editingId.value = app.id
  editForm.title = app.title
  editForm.path = app.path
  editForm.args = app.args || ''
  editForm.delay = Number(app.delay) || 0
  editOpen.value = true
}

async function choosePath() {
  try {
    const paths = await service.pickFiles()
    if (paths[0]) {
      editForm.path = paths[0]
      if (!editForm.title.trim()) editForm.title = titleFromPath(paths[0])
    }
  } catch (err: any) {
    ElMessage.error(err.message)
  }
}

async function saveEdit() {
  const folder = activeFolder.value
  const app = folder?.apps.find(item => item.id === editingId.value)
  if (!app) {
    editOpen.value = false
    return
  }
  if (!editForm.path.trim()) {
    ElMessage.warning('请选择应用路径')
    return
  }
  app.title = editForm.title.trim() || titleFromPath(editForm.path)
  app.path = editForm.path.trim()
  app.args = editForm.args
  app.delay = Math.max(0, Number(editForm.delay) || 0)
  editOpen.value = false
  await persist()
  ElMessage.success('已保存')
}

async function deleteApp(app: LauncherApp) {
  const folder = activeFolder.value
  if (!folder) return
  try {
    await ElMessageBox.confirm(`从「${folder.title}」移除「${app.title}」？`, '删除应用', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  folder.apps = folder.apps.filter(item => item.id !== app.id)
  await persist()
  ElMessage.success('已删除')
}

async function deleteFolder() {
  const folder = activeFolder.value
  if (!folder) return
  try {
    await ElMessageBox.confirm(
      `删除文件夹「${folder.title}」及其中 ${folder.apps.length} 个应用？`,
      '删除文件夹',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  folders.value = folders.value.filter(item => item.id !== folder.id)
  activeFolderId.value = null
  await persist()
  ElMessage.success('已删除文件夹')
}

async function launchFolder(folder: LauncherFolder) {
  if (!folder.apps.length) return
  try {
    await service.launch(folder.apps.map(app => ({ path: app.path, args: app.args, delay: app.delay })))
    ElMessage.success(`已启动「${folder.title}」的 ${folder.apps.length} 个应用`)
  } catch (error: any) {
    ElMessage.error(`启动失败：${error?.message || error}`)
  }
}

async function renameFolder(folder: LauncherFolder) {
  try {
    const { value } = await ElMessageBox.prompt('文件夹名称', '重命名文件夹', {
      inputValue: folder.title,
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValidator: (val: string) => (val && val.trim() ? true : '名称不能为空'),
    })
    folder.title = String(value || '').trim()
    await persist()
  } catch {}
}

async function removeFolder(folder: LauncherFolder) {
  try {
    await ElMessageBox.confirm(
      `删除文件夹「${folder.title}」及其中 ${folder.apps.length} 个应用？`,
      '删除文件夹',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  folders.value = folders.value.filter(item => item.id !== folder.id)
  if (activeFolderId.value === folder.id) activeFolderId.value = null
  await persist()
  ElMessage.success('已删除文件夹')
}

// ============================================================
// 拖拽：Tauri 原生事件 + 浏览器 HTML5 兜底
// ============================================================
let unbindDragDrop: (() => void) | null = null
let domDragDepth = 0

function onDragEnter() {
  domDragDepth += 1
  dragOver.value = true
}

function onDragLeave() {
  domDragDepth = Math.max(0, domDragDepth - 1)
  if (!domDragDepth) dragOver.value = false
}

async function onDomDrop(event: DragEvent) {
  event.preventDefault()
  domDragDepth = 0
  dragOver.value = false
  const files = Array.from(event.dataTransfer?.files || []) as Array<File & { path?: string }>
  const paths = files.map(file => file.path).filter((path): path is string => Boolean(path))
  if (paths.length) await addPaths(paths)
  else if (files.length) ElMessage.warning('当前环境无法读取文件路径，请点击添加')
}

function bindTauriDragDrop() {
  const getCurrent = (window as any).__TAURI__?.webviewWindow?.getCurrentWebviewWindow
  if (typeof getCurrent !== 'function') return
  try {
    const webview = getCurrent()
    const result = webview?.onDragDropEvent?.((event: any) => {
      const payload = event?.payload || {}
      if (payload.type === 'drop') {
        dragOver.value = false
        domDragDepth = 0
        if (Array.isArray(payload.paths) && payload.paths.length) addPaths(payload.paths)
      } else if (payload.type === 'enter' || payload.type === 'over') {
        dragOver.value = true
      } else {
        dragOver.value = false
      }
    })
    if (typeof result?.then === 'function') {
      result.then((unbind: () => void) => { unbindDragDrop = unbind }).catch(() => {})
    } else if (typeof result === 'function') {
      unbindDragDrop = result
    }
  } catch {}
}

onMounted(() => {
  load()
  bindTauriDragDrop()
})

onBeforeUnmount(() => {
  try { unbindDragDrop?.() } catch {}
  unbindDragDrop = null
})
</script>

<template>
  <el-scrollbar class="wr-page start-page">
    <div
      class="wr-page-inner"
      @dragenter.prevent="onDragEnter"
      @dragover.prevent
      @dragleave="onDragLeave"
      @drop="onDomDrop"
    >
      <header class="start-header">
        <div class="header-main">
          <div class="wr-eyebrow">Launcher</div>
          <div class="title-row">
            <el-button
              v-if="activeFolder"
              text
              circle
              size="small"
              aria-label="返回"
              title="返回启动台"
              @click="closeFolder"
            >
              <el-icon :size="16"><Back /></el-icon>
            </el-button>
            <h1 class="wr-page-title">{{ activeFolder ? activeFolder.title : '启动台' }}</h1>
            <span class="wr-chip">
              {{ activeFolder ? `${activeFolder.apps.length} 个应用` : `${folders.length} 个文件夹 · ${appTotal} 个应用` }}
            </span>
          </div>
          <p class="wr-page-subtitle">
            {{ activeFolder ? '双击启动 · 右键更多 · 拖入文件加入当前文件夹' : '把常用应用收进文件夹，拖入即添加，双击即启动。' }}
          </p>
        </div>

        <div class="header-actions">
          <template v-if="activeFolder">
            <el-button type="primary" :disabled="!activeFolder.apps.length" @click="launchAll">
              <el-icon><VideoPlay /></el-icon><span>启动全部</span>
            </el-button>
            <el-button @click="addFromPicker">
              <el-icon><Plus /></el-icon><span>添加应用</span>
            </el-button>
          </template>
          <template v-else>
            <el-button @click="addFromPicker">
              <el-icon><Plus /></el-icon><span>添加应用</span>
            </el-button>
            <el-button type="primary" @click="createFolder">
              <el-icon><FolderAdd /></el-icon><span>新建文件夹</span>
            </el-button>
          </template>
        </div>
      </header>

      <el-alert
        v-if="error"
        class="start-alert"
        type="error"
        :closable="true"
        show-icon
        :title="error"
        @close="error = ''"
      />

      <div v-loading="loading" element-loading-text="正在读取启动台…" class="start-body">
        <!-- 文件夹总览 -->
        <template v-if="!activeFolder">
          <div v-if="!loading" class="folder-grid">
            <el-dropdown
              v-for="folder in folders"
              :key="folder.id"
              trigger="contextmenu"
              placement="bottom"
              @command="command => folderMenuCommand(command, folder)"
            >
              <article
                class="folder-card"
                @click="openFolder(folder)"
              >
                <div class="folder-card-head">
                  <div class="folder-heading">
                    <h3 class="folder-title">{{ folder.title }}</h3>
                    <span class="folder-count">{{ folder.apps.length }} 个应用</span>
                  </div>
                  <el-button
                    text
                    circle
                    size="small"
                    :title="`启动全部（${folder.apps.length}）`"
                    :aria-label="`启动全部（${folder.apps.length}）`"
                    :disabled="!folder.apps.length"
                    @click.stop="launchFolder(folder)"
                  >
                    <el-icon :size="15"><VideoPlay /></el-icon>
                  </el-button>
                </div>

                <div class="folder-icons">
                  <button
                    v-for="app in folder.apps.slice(0, 9)"
                    :key="app.id"
                    type="button"
                    class="folder-icon"
                    :title="`启动 ${app.title}`"
                    @click.stop="launchOne(app)"
                  >
                    <img
                      v-if="hasRealIcon(app)"
                      class="folder-icon-img"
                      :src="iconUrl(app.path)"
                      alt=""
                      @error="markIconFailed(app.path)"
                    />
                    <el-icon v-else :size="22"><component :is="iconOf(app)" /></el-icon>
                  </button>
                  <span
                    v-for="n in Math.max(0, 9 - folder.apps.length)"
                    :key="`empty-${n}`"
                    class="folder-icon is-empty"
                  />
                </div>
              </article>

              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="open">
                    <el-icon><FolderOpened /></el-icon>打开
                  </el-dropdown-item>
                  <el-dropdown-item command="launch-all">
                    <el-icon><VideoPlay /></el-icon>启动全部
                  </el-dropdown-item>
                  <el-dropdown-item command="rename">
                    <el-icon><Edit /></el-icon>重命名
                  </el-dropdown-item>
                  <el-dropdown-item command="delete" divided>
                    <el-icon><Delete /></el-icon>删除
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </template>

        <!-- 文件夹详情 -->
        <template v-else>
          <div class="folder-view">
            <div class="app-grid">
              <el-dropdown
                v-for="app in activeFolder.apps"
                :key="app.id"
                trigger="contextmenu"
                placement="bottom"
                @command="command => appMenuCommand(command, app)"
              >
                <article
                  class="app-tile"
                  :title="`双击启动 · 右键更多\n${app.path}`"
                  @dblclick="launchOne(app)"
                >
                  <span class="app-icon">
                    <img
                      v-if="hasRealIcon(app)"
                      class="app-img"
                      :src="iconUrl(app.path)"
                      alt=""
                      @error="markIconFailed(app.path)"
                    />
                    <el-icon v-else :size="22"><component :is="iconOf(app)" /></el-icon>
                  </span>
                  <div class="app-meta">
                    <span class="app-title">{{ app.title }}</span>
                  </div>
                </article>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="launch">
                      <el-icon><VideoPlay /></el-icon>启动
                    </el-dropdown-item>
                    <el-dropdown-item command="edit">
                      <el-icon><Edit /></el-icon>编辑
                    </el-dropdown-item>
                    <el-dropdown-item command="reveal">
                      <el-icon><FolderOpened /></el-icon>打开位置
                    </el-dropdown-item>
                    <el-dropdown-item command="delete" divided>
                      <el-icon><Delete /></el-icon>删除
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>

            </div>

            <p v-if="!activeFolder.apps.length" class="folder-empty-hint">
              双击应用即可启动，拖入文件会自动加入当前文件夹。
            </p>
          </div>
        </template>
      </div>

      <el-dialog
        v-model="editOpen"
        title="编辑应用"
        width="460px"
        align-center
        append-to-body
        destroy-on-close
        class="start-edit-dialog"
      >
        <el-form label-position="top" @submit.prevent>
          <el-form-item label="名称">
            <el-input v-model="editForm.title" placeholder="应用名称" />
          </el-form-item>
          <el-form-item label="路径">
            <el-input v-model="editForm.path" readonly placeholder="选择可执行文件">
              <template #append>
                <el-button @click="choosePath">选择</el-button>
              </template>
            </el-input>
          </el-form-item>
          <el-form-item label="启动参数">
            <el-input v-model="editForm.args" placeholder="可选，空格分隔" />
          </el-form-item>
          <el-form-item label="延迟（毫秒）">
            <el-input-number
              v-model="editForm.delay"
              :min="0"
              :step="500"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="editOpen = false">取消</el-button>
          <el-button type="primary" @click="saveEdit">保存</el-button>
        </template>
      </el-dialog>

      <transition name="drop-fade">
        <div v-if="dragOver" class="drop-overlay">
          <div class="drop-card">
            <el-icon :size="30"><Plus /></el-icon>
            <strong>松开添加应用</strong>
            <span>{{ activeFolder ? `添加到「${activeFolder.title}」` : '每个文件会创建一个文件夹' }}</span>
          </div>
        </div>
      </transition>
    </div>

  </el-scrollbar>
</template>

<style scoped>


.start-page {
  flex: 1;
  min-height: 0;
}

.start-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.header-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.start-alert {
  margin-bottom: 16px;
}

.start-body {
  min-height: 240px;
}

/* ============================================================
   文件夹网格
   ============================================================ */
.folder-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 240px);
  gap: 18px;
  align-items: start;
}

.folder-card {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 240px;
  height: 240px;
  padding: 14px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 18px;
  background: var(--el-bg-color);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}

.folder-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--el-color-primary) 32%, var(--el-border-color-lighter));
  box-shadow: 0 12px 24px -20px rgba(15, 23, 42, 0.35);
}

.folder-card:focus-visible,
.folder-icon:focus-visible,
.folder-play:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}




.folder-card-head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.folder-view {
  display: flex;
  flex-direction: column;
  gap: 14px;
}




.folder-title-wrap,
.folder-view-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.folder-badge {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 12px;
  color: hsl(var(--folder-hue, 215) 55% 45%);
  background: color-mix(in srgb, hsl(var(--folder-hue, 215) 75% 60%) 14%, transparent);
}

.folder-heading {
  min-width: 0;
}

.folder-title {
  margin: 0;
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-size: 14px;
  font-weight: 650;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.folder-count {
  display: block;
  margin-top: 2px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.folder-arrow {
  flex: none;
  color: var(--el-text-color-placeholder);
  transition: transform 0.18s ease, color 0.18s ease;
}

.folder-card:hover .folder-arrow {
  transform: translateX(3px);
  color: var(--el-color-primary);
}

.folder-icons {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 6px;
  flex: none;
  width: 168px;
  height: 168px;
  margin: 8px auto 0;
}

.folder-icon {
  display: grid;
  place-items: center;
  min-height: 0;
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  transition: background 0.15s ease, transform 0.15s ease;
}

.folder-icon:hover {
  background: var(--el-fill-color-light);
  transform: scale(1.06);
}

.folder-icon.is-empty {
  border-radius: 12px;
  background: var(--el-fill-color-lighter);
  cursor: default;
  pointer-events: none;
}

.folder-icon-img {
  width: 42px;
  height: 42px;
  object-fit: contain;
}

.app-img {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  object-fit: contain;
}

/* el-dropdown 包装后要撑满网格单元，否则间距/宽度会塌 */
.folder-grid > .el-dropdown {
  display: block;
  width: 240px;
}

.app-grid > .el-dropdown {
  display: block;
  min-width: 0;
}

.app-grid > .el-dropdown > .app-tile {
  width: 100%;
}

.app-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 10px;
}

.app-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 118px;
  padding: 14px 12px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 16px;
  background: var(--el-bg-color);
  cursor: default;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}

.app-tile:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--el-color-primary) 45%, var(--el-border-color-lighter));
  background: var(--el-fill-color-lighter);
}

.app-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  flex: none;
  border-radius: 14px;
  color: var(--el-color-primary);
  background: var(--el-fill-color-lighter);
  transition: transform 0.15s ease;
}

.app-tile:hover .app-icon {
  transform: scale(1.06);
}

.app-icon .app-img {
  width: 34px;
  height: 34px;
}

.app-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
  width: 100%;
}

.app-title {
  max-width: 100%;
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.app-add-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 118px;
  padding: 14px 12px 12px;
  border: 1.5px dashed var(--el-border-color);
  border-radius: 16px;
  background: transparent;
  color: var(--el-text-color-secondary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease;
}

.app-add-tile .el-icon {
  color: var(--el-color-primary);
}

.app-add-tile:hover {
  border-color: color-mix(in srgb, var(--el-color-primary) 55%, var(--el-border-color));
  background: color-mix(in srgb, var(--el-color-primary) 6%, transparent);
}

.folder-empty-hint {
  margin: 0;
  padding: 4px 0 2px;
  color: var(--el-text-color-placeholder);
  font-size: 12px;
  text-align: center;
}

/* ============================================================
   拖拽覆盖层
   ============================================================ */
.drop-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
  backdrop-filter: blur(2px);
  pointer-events: none;
}

.drop-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 26px 38px;
  border: 2px dashed color-mix(in srgb, var(--el-color-primary) 65%, transparent);
  border-radius: 20px;
  background: var(--el-bg-color);
  box-shadow: 0 24px 60px -30px color-mix(in srgb, var(--el-color-primary) 60%, transparent);
  color: var(--el-text-color-primary);
}

.drop-card .el-icon {
  color: var(--el-color-primary);
}

.drop-card strong {
  font-size: 15px;
}

.drop-card span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.drop-fade-enter-active,
.drop-fade-leave-active {
  transition: opacity 0.15s ease;
}

.drop-fade-enter-from,
.drop-fade-leave-to {
  opacity: 0;
}

:global(.start-edit-dialog.el-dialog) {
  border-radius: 16px;
}

:global(.start-edit-dialog .el-dialog__body) {
  padding-top: 8px;
}

@media (max-width: 860px) {
  .start-header,
  .folder-view-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .folder-grid {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  }
}
</style>

