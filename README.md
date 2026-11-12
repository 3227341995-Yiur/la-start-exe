# la-start-exe

Lucky Apps 外部插件：启动台。把常用应用收进文件夹，一键按顺序启动。

## 安装

在 Lucky Apps「设置 → 扩展 → 安装外部组件」中粘贴本仓库地址
`https://github.com/3227341995-Yiur/la-start-exe`，或安装 npm 包 / 本地目录。

插件作为标准 Cordis bundle 挂载，安装后在导航栏出现「启动台」。

## 功能

- **Node half**（`src/node.ts`）：读写启动台数据、Windows 文件选择器、按顺序启动进程、
  打开回收站 / 文件位置、按需把 exe 图标提取为 PNG。通过本地 HTTP `/rpc`（token 校验）暴露给前端。
- **Client half**（`src/StartExePage.vue`）：导航页「启动台」，文件夹卡片、文件夹详情、
  拖拽添加、应用编辑、批量启动。编辑与重命名弹窗使用宿主统一的 `AppDialog`，与系统其他弹窗样式一致。
- 数据文件：`%APPDATA%/com.lu.lucky-apps/start-exe.json`
  （可用 `WR_START_EXE_DATA` 覆盖）。服务端口 `38473`（可用 `WR_START_EXE_PORT` 覆盖）。

```bash
pnpm install
pnpm build        # lib/client.js + lib/node.js
node lib/node.js  # 单独调试 Node half（监听 127.0.0.1:38473）
```

## RPC

`POST /rpc`，请求头 `x-start-exe-token: wr-start-exe-local`，body `{ action, payload }`。

| action | payload | 返回 |
| --- | --- | --- |
| `bootstrap` | — | `{ folders }` |
| `save` | `{ folders }` | `{ folders }`（已清洗，不含图标二进制） |
| `pick-files` | — | `string[]` |
| `launch` | `{ apps: [{ path, args, delay }] }` | `{ ok }` |
| `open-recycle-bin` | — | `{ ok }` |
| `reveal` | `{ path }` | `{ ok }` |
| `migrate` | — | `{ imported }` |

exe 图标通过 `GET /icon?path=...` 按需提取并缓存为 PNG，不写入启动台 JSON。
