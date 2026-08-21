# Checklist

- [x] 技能面板提供"联网搜索"与"显示引用来源"两个开关，默认分别为关/开，状态本地持久化，清除本地数据时重置
- [x] 开启联网后普通聊天请求携带 `"webSearch": true`；摘要压缩请求不携带
- [x] 服务端在调用聊天厂商前完成 Bing RSS 搜索（≤5 条、title≤120/snippet≤300/url≤512、仅 http/https、8s 超时），失败或纯图片消息时静默降级为普通对话
- [x] 搜索结果以 `<web_search_results>` 编号块注入全部 6 家厂商及服务端 fallback 的系统提示词（双语指令、句末 [n] 引用标注）
- [x] 联网回复长度上限放宽到 1000 Unicode 字符（runtime 提示与流式截断一致；summary 与普通模式行为不变）
- [x] `event: sources` SSE 事件先于 delta 下发，载荷经服务端裁剪（≤5 条、title≤120、url≤512、仅 http/https）
- [x] 回复气泡下方按"显示引用来源"开关渲染安全外链列表（target=_blank、rel="noopener noreferrer"），刷新后历史仍显示；关闭开关时不渲染但数据保留
- [x] mock 模式下联网请求返回模拟 sources，供 e2e 与本地 UI 验证
- [x] `webSearch` 非布尔值被 400 拒绝；客户端无法传入服务端专用字段（searchResults 不在白名单）
- [x] 测试 Key 仅存在于 .dev.vars（gitignored）或浏览器 LLM 设置，未写入任何 Git 跟踪文件（含 spec/文档/代码/日志）
- [x] README 更新：功能说明、隐私边界（联网时消息文本发送至 Bing）、Bing RSS 非官方接口风险与可替换方案
- [x] `npm run test:unit` / `test:functions` / `typecheck` / `lint` / `build` / `test:e2e` 全部通过（注：test:functions 与 test:e2e 在纯 ASCII 镜像 `C:\src\yachiyo-chat` 运行以规避 README 记载的 Windows 中文路径 workerd 问题；e2e 为 21 通过/6 失败/1 跳过，6 个失败均为 3 个存量布局用例×2 项目——底部横幅/多行输入框遮挡最新回复的既有产品缺陷，经诊断与本功能无关，修复方向：让消息列表底部 padding 动态跟随底部堆叠区高度）
- [x] 真实 API 浏览器验证：测试 Key + step-3.7-flash 联网提问时效性问题，回复含新鲜信息且参考来源可点击（最终验证："今天上海的天气怎么样？"返回八千代口吻天气回复并带 [1][2] 引用标记，参考来源 5/5 为 weather.com.cn / tianqi.com / sh.cma.gov.cn / nmc.cn 等上海天气站点）
