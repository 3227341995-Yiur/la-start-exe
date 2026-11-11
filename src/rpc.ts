/**
 * 与插件自己的 Node half 通信（本地 HTTP，token 校验）。
 */
export interface LauncherApp {
  id: number
  title: string
  path: string
  iconClass?: string
  args: string
  delay: number
}

export interface LauncherFolder {
  id: number
  title: string
  expanded?: boolean
  apps: LauncherApp[]
}

const PORT = Number(import.meta.env?.VITE_WR_START_EXE_PORT || 38473)
const TOKEN = 'wr-start-exe-local'

async function call<T = any>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${PORT}/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-start-exe-token': TOKEN,
    },
    body: JSON.stringify({ action, payload }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.error) throw new Error(data.error || `请求失败: ${response.status}`)
  return data.result as T
}

export const ICON_BASE = `http://127.0.0.1:${PORT}`

export function iconUrl(path: string) {
  return `${ICON_BASE}/icon?path=${encodeURIComponent(path)}&v=3`
}

export const service = {
  bootstrap: () => call<{ folders: LauncherFolder[] }>('bootstrap'),
  save: (folders: LauncherFolder[]) => call<{ folders: LauncherFolder[] }>('save', { folders }),
  pickFiles: () => call<string[]>('pick-files'),
  launch: (apps: Array<Pick<LauncherApp, 'path' | 'args' | 'delay'>>) => (
    call<{ ok: boolean; failed?: string[] }>('launch', { apps })
  ),
  openRecycleBin: () => call<{ ok: boolean }>('open-recycle-bin'),
  reveal: (path: string) => call<{ ok: boolean }>('reveal', { path }),
  migrate: () => call<{ imported: number }>('migrate'),
}

export default service
