# Agent Note: GitHub Releases 分发 Android 热更新

Status: implemented

## Problem

Android APK 从 `https://localhost` 读取内置资源，Cloudflare 的 GitHub 集成只更新网页与 Functions。已安装 APK 需要独立的资源包更新通道，并保留离线启动、本地聊天和相同签名覆盖安装的能力。

## Decision

应用使用 Capacitor 8.5.1 和固定版本的 `@capgo/capacitor-updater` 8.52.1 手动更新模式。APK 版本、原生构建号、兼容运行时和内置资源版本集中在 `mobile-release.json`，Gradle 与前端构建共用该文件。

手机通过原生 HTTP 读取本仓库 GitHub Releases 的 `app-update.json`。清单以原始 JSON 字符串为签名对象，使用 RSA SHA256 验证签名；验证后再检查应用、平台、运行时、原生构建号、递增资源版本和固定仓库下载地址。资源包由官方 CLI SDK 打包、加密，并由原生插件验证加密校验值。私钥保存在本地忽略目录和仓库的 `OTA_PRIVATE_KEY` Actions Secret，公钥随 APK 内置。网页端继续使用现有 PWA 更新流程。

启动后台检查和下载不阻塞聊天。下载完成后只进入待启用状态，用户点击后才调用原生 `set`；不会通过 `next` 或切入后台自动启用。有草稿、图片、正在生成或压缩的回复、初始加载以及打开的面板时禁止切换。切换前等待实际生成任务、消息持久化队列以及已启动的记忆与标题事务完成，写入失败则停止切换，并再次检查最新交互状态。入口直接确认资源包启动，不依赖认证、网络和数据库。未完成启动确认时由原生插件恢复已成功的包。该确认仅覆盖 JavaScript 启动，业务故障通过发布更高版本的恢复包处理。

保留当前包、一个成功旧包、待启用包和内置包。仅阻止已通过下载校验却启动回滚的失败版本；固定插件版本以非空校验和标识该状态，下载失败的空校验和记录允许重试。更新完成后清理其余包。应用 ID、WebView 来源和数据库名称保持稳定。原生端不注册 Service Worker，防止网页缓存拦截新资源包；网页端保留现有显式更新交互并清理检查事件与定时器。

GitHub 的 CI 成功后，发布工作流针对当前 `main` 提交构建资源包，验证构建版本标记、密钥配对、清单签名、资源解密及 SHA256 完整性，然后创建草稿 Release、上传全部附件并发布。任务串行执行，发布前确认提交仍是 `main` 最新提交，避免旧任务覆盖新版本。原生插件、权限或兼容能力变化需要升级原生构建号并发布同签名 APK。

## Alternatives considered

- Cloudflare R2 存储资源包：增加存储桶、域名和凭据维护，当前项目选择 GitHub Releases 统一发布。
- 将 APK 指向线上网页：失去当前离线包和本地回退机制。
- Capgo 托管渠道：当前只使用开源插件与本地打包 SDK，不需要托管账户；插件统计与托管接口地址关闭。
- 仅依赖普通 SHA256 清单：不能确认发布者身份；采用签名清单及原生加密校验。

## Consequences

首次必须覆盖安装带插件的新 APK，原有 0.1.12 APK 无法直接获得该原生能力。后续纯前端更新由推送 `main`、CI 成功和 GitHub Release 分发完成；Cloudflare 继续独立执行绑定部署。GitHub 无法访问时应用仍使用本地包，检查失败可在设置重试。

兼容性使用原生构建号精确匹配。清单中的较旧原生构建号不会触发降级提示；较新构建号通过已验签的 `nativeVersion` 指向对应 APK 发布页。同构建号的运行时不一致视为配置错误。数据库变更必须允许保留的回退包读取；不兼容变更随新 APK 发布。UTC 14 位资源版本按时间递增，恢复旧代码也应生成更高版本，不能修改已发布附件。

## Verification

类型检查、Lint、前端单测 535 项、Functions 单测 319 项、官方 SDK 打包加密测试 5 项均通过；浏览器端到端测试 57 项通过、1 项按触屏条件跳过。Android Release 构建成功，`apksigner` 验证签名有效，证书 SHA256 与 0.1.12 一致，安装包应用 ID 为 `app.yachiyo.chat`、版本为 0.1.13/13，内置资源与发布构建一致。生产依赖审计未发现漏洞。当前没有连接 Android 真机，原生下载、切换与加载失败回退需在手机上验证，不能由 Web 测试代替。

官方依据：[手动更新](https://capgo.app/docs/plugins/updater/self-hosted/manual-update/)、[加密资源包](https://capgo.app/docs/plugins/updater/self-hosted/encrypted-bundles/)、[GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)。
