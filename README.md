# la-start-exe

Lucky Apps 内置插件（重建版）：启动台。把常用应用收进文件夹，一键按顺序启动。

- **Node half**（`src/node.ts`）：读写启动台数据、Windows 文件选择器、启动进程、
  打开回收站 / 文件位置。通过本地 HTTP `/rpc`（token 校验）暴露给前端。
- **Client half**（`src/StartExePage.vue`）：导航页「启动台」，文件夹卡片、文件夹详情、
  拖拽添加、应用编辑、批量启动。
- 数据文件沿用旧启动台：`%APPDATA%/com.lu.lucky-apps/la-start-exe.json`
  （可用 `WR_START_EXE_DATA` 覆盖）。服务端口 `38473`（可用 `WR_START_EXE_PORT` 覆盖）。

```bash
pnpm install
pnpm build        # lib/client.js + lib/node.js
node lib/node.js  # 单独调试 Node half（监听 127.0.0.1:38473）
```

## RPC

`POST /rpc`，请求头 `x-la-start-exe-token: wr-la-start-exe-local`，body `{ action, payload }`。

| action | payload | 返回 |
| --- | --- | --- |
| `bootstrap` | — | `{ folders }` |
| `save` | `{ folders }` | `{ folders }`（已清洗，剔除 iconBase64） |
| `pick-files` | — | `string[]` |
| `launch` | `{ apps: [{ path, args, delay }] }` | `{ ok }` |
| `open-recycle-bin` | — | `{ ok }` |
| `reveal` | `{ path }` | `{ ok }` |
| `migrate` | — | `{ imported }` |

> 旧版把 exe 图标转成 base64 存进 JSON，导致 4MB 级请求体。本插件不读取、不保存、
> 不回传 `iconBase64`，界面按扩展名显示 Element Plus 图标。
