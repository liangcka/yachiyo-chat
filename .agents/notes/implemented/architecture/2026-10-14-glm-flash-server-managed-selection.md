# Agent Note: GLM 推荐模型与服务端 Flash 选择契约

Status: implemented

## 问题

GLM-4.7-Flash 已由服务端提供默认调用，但设置面板按厂商统一要求个人 API Key，使该模型无法作为免 Key 配置保存和启用。已有个人 Key 的 Flash 配置也会进入个人凭据分支。

## 决策

- 智谱 GLM 的推荐标记归属 `charglm-4`；默认模型仍为 `glm-4.7-flash`，保留免费标记。
- `isServerManagedModel` 统一识别 `glm` / `glm-4.7-flash`。两套设置面板隐藏其 Key 输入，允许免 Key 保存、启用和清除。
- 设置记录保留厂商、模型及已有个人 Key，便于切回其他 GLM 模型；图片能力继续依据实际选择的模型判断。
- 控制器只将个人模型配置写入请求配置引用，普通聊天、摘要和自动标题/记忆请求共用该引用。Flash 请求同时省略 `provider`、`apiKey`、`model`，复用既有服务端默认路径，即使本地存在历史 Key 也不发送。
- `LlmSettingsService.getActiveConfig` 对服务端内置模型返回 `undefined`，与发送契约一致。

## 备选方案

单独增加免 Key API 或只省略 `apiKey` 都会引入额外协议；现有 `/api/chat` 已支持三字段全部省略的服务端调用，并要求三字段同时出现或同时省略。删除历史个人 Key 会影响切回 charGLM 的配置复用，因此仅在发送时排除。

## 影响

无需数据库迁移或服务端协议调整。charGLM-4 及其他个人模型继续要求个人 Key。服务端 Flash 调用继续使用部署凭据、签名会话和现有每日额度。

## 验证

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit -- --maxWorkers=2`：覆盖免 Key 设置操作、历史 Key 保留、聊天/摘要/metadata 路由及模型切换后的图片限制。
- `npm run test:functions -- --maxWorkers=2`：验证既有服务端凭据、会话鉴权和额度路径。
- `npm run test:e2e -- --workers=2`：在移动视口与桌面验证推荐标记、免 Key 保存、刷新后恢复及实际请求字段。
- `npm run mob:build`：生成 Android 0.1.14（versionCode 14），核对内置资源版本及应用标识；`apksigner verify` 通过，证书与已发布的 0.1.13 一致。
- `npm run test:ota`、`npm run ota:package`：验证资源包加密与签名，生成与 APK 内置资源版本一致的更新附件。未连接 Android 真机，未进行设备安装验证。
