/**
 * la-start-exe Node half.
 *
 * 启动台数据读写 + 本地进程启动，通过本地 HTTP /rpc（token 校验）暴露给前端。
 * 数据默认沿用旧启动台的 %APPDATA%/com.lu.lucky-apps/start-exe.json。
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import { promisify } from 'node:util'

export const name = 'la-start-exe'

const execFileAsync = promisify(execFile)
const PORT = Number(process.env.WR_START_EXE_PORT || 38473)
const TOKEN = 'wr-start-exe-local'
const MAX_BODY = 2 * 1024 * 1024

interface AppEntry {
  id: number
  title: string
  path: string
  iconClass: string
  args: string
  delay: number
}

interface FolderEntry {
  id: number
  title: string
  expanded: boolean
  apps: AppEntry[]
}

function appDataDir() {
  return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
}

export function dataPath() {
  return process.env.WR_START_EXE_DATA || join(appDataDir(), 'com.lu.lucky-apps', 'start-exe.json')
}

function legacyPath() {
  return join(appDataDir(), 'com.lu.lucky-apps', 'start-exe.json')
}

function normalizeId(value: unknown, fallback: number) {
  const id = Number(value)
  return Number.isFinite(id) ? id : fallback
}

// 只保留已知字段：iconBase64 是旧版 4MB「请求体过大」的根源，绝不再落盘/回传。
function sanitizeFolders(input: unknown): FolderEntry[] {
  if (!Array.isArray(input)) return []
  let seq = 0
  return input
    .filter(folder => folder && typeof folder === 'object')
    .map((folder: any, index: number) => ({
      id: normalizeId(folder.id, Date.now() + index),
      title: String(folder.title || `文件夹 ${index + 1}`).trim() || `文件夹 ${index + 1}`,
      expanded: folder.expanded !== false,
      apps: Array.isArray(folder.apps)
        ? folder.apps
            .filter((app: any) => app && typeof app === 'object' && String(app.path || '').trim())
            .map((app: any) => ({
              id: normalizeId(app.id, Date.now() + (seq += 1)),
              title: String(app.title || basename(String(app.path)).replace(/\.[^.]+$/, '')).trim()
                || basename(String(app.path)),
              path: String(app.path).trim(),
              iconClass: String(app.iconClass || ''),
              args: String(app.args ?? ''),
              delay: Math.max(0, Number(app.delay) || 0),
            }))
        : [],
    }))
}

async function atomicWrite(file: string, text: string) {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temp, text, 'utf8')
  try {
    await rename(temp, file)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}

function readFolders(): FolderEntry[] {
  const file = dataPath()
  if (!existsSync(file)) return []
  try {
    return sanitizeFolders(JSON.parse(readFileSync(file, 'utf8')))
  } catch (error) {
    console.error('[la-start-exe] 数据文件解析失败:', (error as Error).message)
    return []
  }
}

async function persistFolders(input: unknown) {
  const folders = sanitizeFolders(input)
  await atomicWrite(dataPath(), `${JSON.stringify(folders, null, 2)}\n`)
  return folders
}

async function importLegacy() {
  const target = dataPath()
  if (existsSync(target)) return { imported: 0 }
  const legacy = legacyPath()
  if (legacy === target || !existsSync(legacy)) return { imported: 0 }
  const folders = await persistFolders(JSON.parse(readFileSync(legacy, 'utf8')))
  return { imported: folders.length }
}

async function bootstrap() {
  if (!existsSync(dataPath())) {
    await importLegacy().catch(error => console.error('[la-start-exe] 旧数据导入失败:', error.message))
  }
  return { folders: readFolders() }
}

function psQuote(value: string) {
  return String(value).replace(/'/g, "''")
}

async function pickFiles(): Promise<string[]> {
  if (process.platform !== 'win32') throw new Error('文件选择器仅支持 Windows')
  const title = psQuote('选择要添加的应用')
  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '${title}'
$dialog.Filter = '应用程序 (*.exe;*.app;*.bat;*.sh)|*.exe;*.app;*.bat;*.sh|所有文件 (*.*)|*.*'
$dialog.Multiselect = $true
$dialog.CheckFileExists = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  foreach ($file in $dialog.FileNames) { [Console]::Out.WriteLine($file) }
}
`
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-Command', script],
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }
  )
  return String(stdout).split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}

function spawnDetached(file: string, args: string[]) {
  const child = spawn(file, args, {
    cwd: existsSync(dirname(file)) ? dirname(file) : undefined,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.once('error', error => console.error(`[la-start-exe] 启动失败 ${file}:`, error.message))
  child.unref()
}

// 按每个应用自己的 delay 累加成启动时间点；先返回，不阻塞 HTTP 请求。
function launchApps(apps: unknown) {
  const list = Array.isArray(apps) ? apps : []
  let offset = 0
  for (const item of list as any[]) {
    const file = String(item?.path || '').trim()
    if (!file) continue
    offset += Math.max(0, Number(item?.delay) || 0)
    const args = String(item?.args || '').trim().split(/\s+/).filter(Boolean)
    if (offset <= 0) spawnDetached(file, args)
    else setTimeout(() => spawnDetached(file, args), offset)
  }
  return { ok: true }
}

function openRecycleBin() {
  const child = spawn('explorer.exe', ['shell:RecycleBinFolder'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.once('error', error => console.error('[la-start-exe] 打开回收站失败:', error.message))
  child.unref()
  return { ok: true }
}

function reveal(payload: any) {
  const file = String(payload?.path || '').trim()
  if (!file) throw new Error('缺少文件路径')
  const child = spawn('explorer.exe', [`/select,${file}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.once('error', error => console.error('[la-start-exe] 打开位置失败:', error.message))
  child.unref()
  return { ok: true }
}

export async function handleAction(action: string, payload: any = {}) {
  switch (action) {
    case 'bootstrap':
      return bootstrap()
    case 'save':
      return { folders: await persistFolders(payload.folders) }
    case 'pick-files':
      return pickFiles()
    case 'launch':
      return launchApps(payload.apps)
    case 'open-recycle-bin':
      return openRecycleBin()
    case 'reveal':
      return reveal(payload)
    case 'migrate':
      return importLegacy()
    default:
      throw new Error(`未知操作: ${action}`)
  }
}

// ============================================================
// 应用图标：按需从 exe 提取为 PNG（只传图片流，不进 JSON 请求体）
// ============================================================
const ICON_CACHE_DIR = join(tmpdir(), 'lucky-app-icons')

async function iconForFile(file: string): Promise<string | null> {
  if (!file || !existsSync(file)) return null
  const hash = createHash('sha1').update(`v2:${file.toLowerCase()}`).digest('hex')
  const target = join(ICON_CACHE_DIR, `${hash}.png`)
  if (existsSync(target)) return target
  await mkdir(ICON_CACHE_DIR, { recursive: true })
  const psScript = join(ICON_CACHE_DIR, 'extract-jumbo.ps1')
  if (!existsSync(psScript)) {
    await writeFile(psScript, `param([string]$Path, [string]$Out)
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class JumboIcon {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct SHFILEINFO {
    public IntPtr hIcon;
    public int iIcon;
    public uint dwAttributes;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern IntPtr SHGetFileInfo(string pszPath, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbFileInfo, uint uFlags);
  [ComImport, Guid("46EB5926-582E-4017-9FDF-E8998DAA0950"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IImageList {
    void Add(IntPtr hbmImage, IntPtr hbmMask, out int pi);
    void ReplaceIcon(int i, IntPtr hicon, out int pi);
    void SetOverlayImage(int iImage, int iOverlay);
    void Replace(int i, IntPtr hbmImage, IntPtr hbmMask);
    void AddMasked(IntPtr hbmImage, int crMask, out int pi);
    void Draw(IntPtr pimldp);
    void Remove(int i);
    void GetIcon(int i, int flags, out IntPtr picon);
  }
  [DllImport("shell32.dll")]
  static extern int SHGetImageList(int iImageList, ref Guid riid, out IImageList ppv);
  public static void Save(string path, string outPath) {
    var info = new SHFILEINFO();
    SHGetFileInfo(path, 0, ref info, (uint)Marshal.SizeOf(info), 0x000000100);
    var iid = new Guid("46EB5926-582E-4017-9FDF-E8998DAA0950");
    IImageList list;
    SHGetImageList(4, ref iid, out list);
    IntPtr hIcon;
    list.GetIcon(info.iIcon, 0x00000001, out hIcon);
    using (var icon = System.Drawing.Icon.FromHandle(hIcon))
    using (var bmp = icon.ToBitmap()) {
      bmp.Save(outPath, System.Drawing.Imaging.ImageFormat.Png);
    }
  }
}
'@
[JumboIcon]::Save($Path, $Out)
`, 'utf8')
  }
  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', psScript, file, target,
    ], { windowsHide: true, timeout: 20000 })
  } catch {
    return null
  }
  return existsSync(target) ? target : null
}

async function serveIcon(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const icon = await iconForFile(url.searchParams.get('path') || '')
  if (!icon) {
    res.writeHead(404)
    return res.end()
  }
  const data = await readFile(icon)
  res.writeHead(200, {
    'content-type': 'image/png',
    'cache-control': 'public, max-age=86400',
  })
  res.end(data)
}

// ============================================================
// 本地 HTTP 服务
// ============================================================
function send(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  res.end(JSON.stringify(value))
}

function allowedOrigin(origin) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function createRpcServer() {
  return createServer(async (req, res) => {
    const origin = req.headers.origin || ''
    if (allowedOrigin(origin)) {
      res.setHeader('access-control-allow-origin', origin)
      res.setHeader('vary', 'origin')
    }
    res.setHeader('access-control-allow-headers', 'content-type,x-start-exe-token')
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      return res.end()
    }
    // 图标接口供 <img> 直接加载，无法带自定义头，单独放行（只读本机文件图标）
    if (req.method === 'GET' && req.url?.startsWith('/icon?')) {
      return serveIcon(req, res)
    }
    if (req.headers['x-start-exe-token'] !== TOKEN) {
      return send(res, 403, { error: 'forbidden' })
    }
    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, { ok: true })
    }
    if (req.method === 'POST' && req.url === '/rpc') {
      try {
        const body = await readBody(req)
        const result = await handleAction(String(body.action || ''), body.payload || {})
        return send(res, 200, { result })
      } catch (error) {
        return send(res, 400, { error: (error as Error).message })
      }
    }
    return send(res, 404, { error: 'not found' })
  })
}

const service = createRpcServer()
let servicePromise = null
let activeMounts = 0
let closeTimer = null

function listen(server, port, attempts = 4): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = error => {
      server.removeListener('listening', onListening)
      if (error.code === 'EADDRINUSE' && attempts > 1) {
        setTimeout(() => listen(server, port, attempts - 1).then(resolve, reject), 250)
        return
      }
      reject(error)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

async function ensureService() {
  if (!servicePromise) {
    servicePromise = listen(service, PORT).catch(error => {
      servicePromise = null
      throw error
    })
  }
  await servicePromise
  return service
}

export async function apply(ctx?: any) {
  activeMounts += 1
  clearTimeout(closeTimer)
  closeTimer = null
  try {
    await ensureService()
    console.log('[la-start-exe] local service ready')
  } catch (error) {
    console.error('[la-start-exe] 本地服务启动失败:', (error as Error).message)
  }
  ctx?.on?.('dispose', () => {
    activeMounts = Math.max(0, activeMounts - 1)
    if (activeMounts > 0) return
    closeTimer = setTimeout(() => {
      if (activeMounts > 0 || !service.listening) return
      service.closeAllConnections?.()
      service.close()
      servicePromise = null
    }, 800)
  })
}

process.once('exit', () => {
  if (service.listening) {
    service.closeAllConnections?.()
    service.close()
  }
})

// 方便单独运行 `node lib/node.js` 调试（宿主加载时 process.argv[1] 不是本文件）。
const currentFile = resolve(fileURLToPath(import.meta.url)).toLowerCase()
const entryFile = process.argv[1] ? resolve(process.argv[1]).toLowerCase() : ''
if (entryFile && entryFile === currentFile) {
  apply().catch(error => {
    console.error('[la-start-exe] 本地服务启动失败:', error.message)
    process.exitCode = 1
  })
}

export default { name, apply }
