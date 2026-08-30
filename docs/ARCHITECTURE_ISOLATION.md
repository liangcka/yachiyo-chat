# Yachiyo Chat 架构分轨与端侧隔离指南

本项目采用 **双轨隔离架构（Dual-Track Isolated Architecture）**，使 **📱 手机移动端 / Web 端** 与 **💻 电脑桌面独立端** 在保持角色人设与星空 UI 一致的前提下，各自享有完全独立、互不干扰的运行时、部署流与安全沙箱。

---

## 1. 架构总览图

```
                          ┌──────────────────────────┐
                          │   UI 交互层 (src/)       │
                          │   星空UI / i18n / 会话存储│
                          └────────────┬─────────────┘
                                       │ 平台探针 (app-platform.ts)
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
      📱 手机端 / 网页端 (Cloud-Native)       💻 电脑桌面端 (Standalone Local)
      ──────────────────────────────       ────────────────────────────────
      • 部署于 Cloudflare Pages            • 本地 Tauri v2 + Rust 核心
      • 边缘云函数 (functions/)             • 内嵌 Axum 本地网关 (127.0.0.1:28888)
      • 访问码鉴权与边缘限流               • 6 家 LLM 厂商本机直连 (脱离 CF)
      • Capacitor Android APK 壳           • 本地 AES-256 加密密钥存储
      • PWA 离线 Service Worker            • 工作区白名单沙箱 + Agent 终端干活工具
                    ▲                                     ▲
                    └──────────────┬──────────────────────┘
                                   │ WSS 长连接隧道 (持有 Token 鉴权)
                                   ▼
                    🌐 远程中继 Worker (relay-worker/)
                    ───────────────────────────────────
                    • Cloudflare Durable Objects 转发
                    • 手机外出时远程访问家里电脑 Agent
```

---

## 2. 目录职责与代码物理隔离

| 目录 / 文件 | 归属端 | 作用与隔离原则 |
| :--- | :--- | :--- |
| `src-tauri/` | 💻 **电脑端** | **桌面独立内核**：Rust 实现的 Axum 本地 HTTP 网关、Agent 工具沙箱 (`fs`, `shell`, `git`, `web`)、AES-256 加密存储、系统托盘管理。手机端构建时完全不涉及此目录。 |
| `src/components/desktop/` | 💻 **电脑端** | **桌面专属 UI**：工作区面板（`WorkspacePanel`）、文件树浏览器、终端日志输出。在手机端隐藏或仅在打开对应面板时展示。 |
| `src/components/tools/` | 💻 **电脑端** | **Agent 工具状态卡片**（`ToolCard`）：展示智能体执行步骤与输出日志折叠。 |
| `functions/` | 📱 **手机/Web 端** | **Cloudflare 边缘云函数**：负责 Pages 网页版与 APK 壳的云端 `/api/chat`、`/api/session`、KV 速率限制。电脑桌面端完全不经过此目录。 |
| `android/` | 📱 **手机端** | **Capacitor 原生 Android 工程**：用于编译输出 Android APK 安装包。 |
| `relay-worker/` | 🌐 **中继服务** | **Durable Objects 中继 Worker**：独立工程与独立配置，仅用于建立手机与电脑间的安全加密隧道。 |
| `src/` (通用部分) | 🌐 **共享层** | **响应式星空前端**：React 19、Dexie IndexedDB、虚拟列表、双语 i18n 字典，自动根据屏幕与平台适配。 |

---

## 3. 分轨指令与工作流

### 📱 手机端 / Web 端指令
```powershell
# 1. 网页前端本地调试 (Vite)
npm run dev

# 2. 模拟 Cloudflare Pages 边缘环境 (带 KV 限流)
npm run dev:pages

# 3. 运行云函数单元测试 (零回归保证)
npm run test:functions

# 4. 同步并打包 Android APK 安装包
npm run mob:sync
npm run mob:build
```

### 💻 电脑桌面独立端指令
```powershell
# 1. 启动桌面端开发模式 (Vite 热重载 + 原生窗口)
npm run desktop:dev  # (或 npm run tauri:dev)

# 2. 运行桌面端 Rust 网关与 Agent 工具单元测试
npm run test:desktop

# 3. 打包生成 Windows 原生安装包 (.msi / .exe)
npm run desktop:build # (或 npm run tauri:build)
```

### 🌐 远程中继 Worker 指令
```powershell
# 1. 中继 Worker 本地调试
npm run relay:dev

# 2. 部署中继 Worker 到 Cloudflare
npm run relay:deploy
```

---

## 4. 安全与数据隔离保证

1. **API Key 隔离**：
   - 手机网页端：使用 Cloudflare 环境变量或保存在本地 IndexedDB（仅限当前浏览器）。
   - 电脑桌面端：使用机器盐生成的 AES-256-GCM 本地加密文件（`%APPDATA%/cn.amtale.yachiyo.desktop/keys.enc`），不上传任何云端。
2. **工作区沙箱隔离**：
   - 桌面 Agent 工具的所有读写与命令均限制在用户指定的 `WorkspaceRoot` 物理目录内，严格防止 `../` 路径穿越与破坏性高危系统指令。
3. **零云端依赖**：
   - 电脑端运行无需 Cloudflare 账号或边缘服务存活，只要电脑联网即可直连 AI 模型完成全部工作。
