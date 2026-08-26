# Contributing to Yachiyo Chat

感谢对 Yachiyo Chat 项目的关注与贡献！

## 参与规范

### 1. 开发环境要求
- **Node.js**: >= 22.12.0
- **npm**: >= 10.0.0
- **PowerShell / Bash**

### 2. 本地开发与调试

```bash
# 安装依赖
npm install

# 启动本地 Mock 模式（包含本地 Pages Functions 与 KV 模拟）
npm run dev:mock
```

- 本地 Mock 模式默认访问码为：`yachiyo-local-access`。

### 3. 代码与质量检查

在提交 Pull Request 之前，请确保以下全部检查通过：

```bash
# 1. TypeScript 类型检查
npm run typecheck

# 2. ESLint 检查
npm run lint

# 3. 前端与组件单测
npm run test:unit

# 4. Cloudflare Pages Functions 单测
npm run test:functions

# 5. 生产打包验证
npm run build
```

### 4. Git 提交规范

遵循常规提交格式（Conventional Commits）：
- `feat:` 新功能
- `fix:` 缺陷修复
- `refactor:` 代码重构
- `perf:` 性能优化
- `docs:` 文档更新
- `test:` 测试补充
- `chore:` 构建或辅助工具变动

### 5. 安全注意
- **切勿**将任何包含真实 API Key、Token 或私钥的文件（如 `.dev.vars`、`keystore.properties`、`*.jks`、`*.keystore`）提交至仓库。
- 敏感配置请使用 `.dev.vars.example` 或 `android/keystore.properties.example` 作为模板。
