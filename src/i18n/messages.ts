import type { Locale } from "../domain/chat";

export interface UiCopy {
  readonly appName: string;
  readonly menu: string;
  readonly closeMenu: string;
  readonly capture: string;
  readonly inputHint: string;
  readonly send: string;
  readonly stop: string;
  readonly settings: string;
  readonly emotionSoon: string;
  readonly speakerSoon: string;
  readonly microphoneSoon: string;
  readonly voiceSoon: string;
  readonly accessCodeLabel: string;
  readonly accessCodeHint: string;
  readonly enter: string;
  readonly verifying: string;
  readonly accessDenied: string;
  readonly accessRateLimited: string;
  readonly accessNetworkError: string;
  readonly switchLineRetry: string;
  readonly history: string;
  readonly noHistory: string;
  readonly newChat: string;
  readonly rename: string;
  readonly delete: string;
  readonly deleteConfirm: string;
  readonly signOut: string;
  readonly clearData: string;
  readonly clearDataConfirm: string;
  readonly cancel: string;
  readonly confirm: string;
  readonly localeLabel: string;
  readonly chinese: string;
  readonly japanese: string;
  readonly offline: string;
  readonly retry: string;
  readonly quotaReached: string;
  readonly genericFailure: string;
  readonly sessionExpired: string;
  readonly updateReady: string;
  readonly updateAction: string;
  readonly offlineReady: string;
  readonly firstGreeting: string;
  readonly removeImage: string;
  readonly imageProcessing: string;
  readonly imageInvalid: string;
  readonly imageTooLarge: string;
  readonly storageFull: string;
  readonly exitHint: string;
  readonly conversationLimit: string;
  readonly truncated: string;
  readonly llmSettings: string;
  readonly llmSettingsEntry: string;
  readonly llmActive: string;
  readonly llmUsingDefault: string;
  readonly llmProvider: string;
  readonly llmDomestic: string;
  readonly llmInternational: string;
  readonly llmApiKey: string;
  readonly llmModel: string;
  readonly llmApiKeyHint: (hint: string) => string;
  readonly llmNoImageSupport: string;
  readonly llmShowKey: string;
  readonly llmHideKey: string;
  readonly llmSave: string;
  readonly llmClear: string;
  readonly llmActivate: string;
  readonly llmKeyInvalid: string;
  readonly llmSaved: string;
  readonly llmCleared: string;
  readonly compressContext: string;
  readonly compressSuccess: string;
  readonly noNeedToCompress: string;
  readonly compressFailed: string;
  readonly compressingContext: string;
  readonly memoryLabel: string;
  readonly loadEarlierLabel: string;
  readonly userMemoryEntry: string;
  readonly userMemoryTitle: string;
  readonly userMemoryDescription: string;
  readonly userMemoryPlaceholder: string;
  readonly userMemorySave: string;
  readonly userMemoryClear: string;
  readonly userMemorySaved: string;
  readonly userMemoryCleared: string;
  readonly userMemorySaveFailed: string;
  readonly recall: string;
  readonly recallSuccess: string;
  readonly copyText: string;
  readonly copied: string;
  readonly regenerate: string;
  readonly skillsEntry: string;
  readonly skillsTitle: string;
  readonly skillsDescription: string;
  readonly skillEnable: string;
  readonly skillDisable: string;
  readonly skillToggleLabel: string;
  readonly skillViewContent: string;
  readonly skillHideContent: string;
  readonly webSearchTitle: string;
  readonly webSearchDescription: string;
  readonly webSearchShowSources: string;
  readonly webSearchShowSourcesDescription: string;
  readonly webSearchSmart: string;
  readonly webSearchSmartDescription: string;
  readonly sourcesLabel: string;
  readonly workspaceEntry: string;
  readonly workspaceTitle: string;
  readonly workspaceDescription: string;
}

const chinese = Object.freeze({
  appName: "Yachiyo Chat",
  menu: "菜单",
  closeMenu: "关闭菜单",
  capture: "拍摄",
  inputHint: "什么都可以告诉我",
  send: "发送",
  stop: "停止",
  settings: "设置",
  emotionSoon: "情绪功能即将开放",
  speakerSoon: "扬声器功能即将开放",
  microphoneSoon: "麦克风功能即将开放",
  voiceSoon: "语音功能即将开放",
  accessCodeLabel: "访问码",
  accessCodeHint: "输入共享访问码",
  enter: "进入",
  verifying: "正在验证…",
  accessDenied: "访问码不正确，请重试。",
  accessRateLimited: "尝试次数过多，请稍后再试。",
  accessNetworkError: "连不上服务器，请检查网络后重试。",
  switchLineRetry: "切换线路重试",
  history: "历史记录",
  noHistory: "还没有历史对话",
  newChat: "新建对话",
  rename: "重命名",
  delete: "删除",
  deleteConfirm: "确定删除这段对话吗？",
  signOut: "退出访问",
  clearData: "清除本地数据",
  clearDataConfirm: "这会删除当前设备上的全部聊天记录，确定继续吗？",
  cancel: "取消",
  confirm: "确定",
  localeLabel: "语言",
  chinese: "简体中文",
  japanese: "日本語",
  offline: "当前离线，可查看本地记录",
  retry: "重试",
  quotaReached: "今天的对话次数已用完，请明天再来。",
  genericFailure: "暂时连接不上，再试一次吧。",
  sessionExpired: "访问已过期，请重新输入访问码。",
  updateReady: "新版本已经准备好了。",
  updateAction: "立即更新",
  offlineReady: "应用已可离线打开。",
  firstGreeting: "彩叶~今天也辛苦啦！（笑着朝你挥了挥手）",
  removeImage: "移除图片",
  imageProcessing: "正在处理图片…",
  imageInvalid: "请选择 JPEG、PNG 或 WebP 图片。",
  imageTooLarge: "图片太大，请换一张试试。",
  storageFull: "本地空间不足，请先清理历史记录。",
  exitHint: "再按一次返回键退出",
  conversationLimit: "本地最多保留 30 段对话，请先删除一段。",
  truncated: "回复太长，已截断显示。",
  llmSettings: "LLM 设置",
  llmSettingsEntry: "LLM 设置",
  llmActive: "当前使用",
  llmUsingDefault: "未配置，使用默认服务",
  llmProvider: "厂商",
  llmDomestic: "国内",
  llmInternational: "国际",
  llmApiKey: "API Key",
  llmModel: "模型",
  llmApiKeyHint: (hint) => hint,
  llmNoImageSupport: "该厂商暂不支持图片输入",
  llmShowKey: "显示",
  llmHideKey: "隐藏",
  llmSave: "保存",
  llmClear: "清除配置",
  llmActivate: "设为当前",
  llmKeyInvalid: "API Key 格式不正确，请检查后重试。",
  llmSaved: "配置已保存",
  llmCleared: "配置已清除",
  compressContext: "压缩上下文",
  compressSuccess: "上下文已成功压缩并保存至记忆",
  noNeedToCompress: "当前对话较短，暂无需压缩",
  compressFailed: "压缩上下文失败，请稍后重试",
  compressingContext: "正在压缩上下文…",
  memoryLabel: "对话记忆",
  loadEarlierLabel: "加载更早的消息",
  userMemoryEntry: "长期记忆",
  userMemoryTitle: "长期记忆管理",
  userMemoryDescription:
    "八千代跨对话记住的关于你的信息（压缩上下文时自动提炼，也可手动编辑）；新对话中同样生效。",
  userMemoryPlaceholder: "暂无长期记忆。与八千代对话并压缩上下文后会自动生成，也可在此手动填写。",
  userMemorySave: "保存记忆",
  userMemoryClear: "清除记忆",
  userMemorySaved: "长期记忆已保存",
  userMemoryCleared: "长期记忆已清除",
  userMemorySaveFailed: "长期记忆保存失败，请重试",
  recall: "撤回",
  recallSuccess: "已撤回最新一条消息",
  copyText: "复制",
  copied: "已复制",
  regenerate: "重新生成",
  skillsEntry: "技能",
  skillsTitle: "技能",
  skillsDescription: "供对话调用的文本处理技能，启用后自动生效",
  skillEnable: "启用",
  skillDisable: "停用",
  skillToggleLabel: "切换技能启用状态",
  skillViewContent: "查看技能说明",
  skillHideContent: "收起技能说明",
  webSearchTitle: "联网搜索",
  webSearchDescription: "发送前先用必应搜索网络资料，回复将基于最新信息",
  webSearchShowSources: "显示引用来源",
  webSearchShowSourcesDescription: "在联网回复下方显示参考来源链接",
  webSearchSmart: "智能搜索",
  webSearchSmartDescription: "同时检索国际市场近30天结果，提升时效信息的准确性",
  sourcesLabel: "参考来源",
  workspaceEntry: "工作区 & Agent",
  workspaceTitle: "工作区 & Agent 终端",
  workspaceDescription: "配置本地 Agent 工具的运行目录，支持安全文件读写与终端命令执行。",
} satisfies UiCopy);

const japanese = Object.freeze({
  appName: "Yachiyo Chat",
  menu: "メニュー",
  closeMenu: "メニューを閉じる",
  capture: "撮影",
  inputHint: "何でも話してね",
  send: "送信",
  stop: "停止",
  settings: "設定",
  emotionSoon: "感情機能は近日公開です",
  speakerSoon: "スピーカー機能は近日公開です",
  microphoneSoon: "マイク機能は近日公開です",
  voiceSoon: "音声機能は近日公開です",
  accessCodeLabel: "アクセスコード",
  accessCodeHint: "共有アクセスコードを入力",
  enter: "入る",
  verifying: "確認中…",
  accessDenied: "アクセスコードが違います。もう一度お試しください。",
  accessRateLimited: "試行回数が多すぎます。しばらくしてからお試しください。",
  accessNetworkError: "サーバーに接続できません。ネットワークを確認して再試行してください。",
  switchLineRetry: "回線を切り替えて再試行",
  history: "履歴",
  noHistory: "まだ会話履歴はありません",
  newChat: "新しい会話",
  rename: "名前を変更",
  delete: "削除",
  deleteConfirm: "この会話を削除しますか？",
  signOut: "アクセスを終了",
  clearData: "端末データを消去",
  clearDataConfirm: "この端末の会話履歴をすべて削除します。続けますか？",
  cancel: "キャンセル",
  confirm: "確認",
  localeLabel: "言語",
  chinese: "简体中文",
  japanese: "日本語",
  offline: "オフラインです。端末の履歴は閲覧できます",
  retry: "もう一度",
  quotaReached: "本日の会話回数を使い切りました。また明日ね。",
  genericFailure: "今はつながらないみたい。もう一度試してね。",
  sessionExpired: "アクセス期限が切れました。コードを再入力してください。",
  updateReady: "新しいバージョンを利用できます。",
  updateAction: "今すぐ更新",
  offlineReady: "オフラインでも開けるようになりました。",
  firstGreeting: "彩葉~今日もお疲れさま！（笑顔で手を振る）",
  removeImage: "画像を外す",
  imageProcessing: "画像を処理中…",
  imageInvalid: "JPEG、PNG、WebP の画像を選んでください。",
  imageTooLarge: "画像が大きすぎます。別の画像を試してください。",
  storageFull: "端末の空き容量が足りません。履歴を整理してください。",
  exitHint: "もう一度戻ると終了します",
  conversationLimit: "会話は端末に30件まで保存できます。先に1件削除してください。",
  truncated: "返答が長すぎたため、途中まで表示しています。",
  llmSettings: "LLM 設定",
  llmSettingsEntry: "LLM 設定",
  llmActive: "現在使用中",
  llmUsingDefault: "未設定、デフォルトを使用",
  llmProvider: "プロバイダ",
  llmDomestic: "国内",
  llmInternational: "国際",
  llmApiKey: "API Key",
  llmModel: "モデル",
  llmApiKeyHint: (hint) => hint,
  llmNoImageSupport: "このプロバイダは画像入力に対応していません",
  llmShowKey: "表示",
  llmHideKey: "非表示",
  llmSave: "保存",
  llmClear: "設定を削除",
  llmActivate: "現在の設定にする",
  llmKeyInvalid: "API Key の形式が正しくありません。確認してください。",
  llmSaved: "設定を保存しました",
  llmCleared: "設定を削除しました",
  compressContext: "コンテキストを圧縮",
  compressSuccess: "コンテキストを圧縮して記憶に保存しました",
  noNeedToCompress: "会話が短いため、まだ圧縮の必要はありません",
  compressFailed: "コンテキストの圧縮に失敗しました。後でもう一度お試しください",
  compressingContext: "コンテキストを圧縮中…",
  memoryLabel: "会話の記憶",
  loadEarlierLabel: "前のメッセージを読み込む",
  userMemoryEntry: "長期記憶",
  userMemoryTitle: "長期記憶の管理",
  userMemoryDescription:
    "八千代が会話をまたいで覚えているあなたの情報（コンテキスト圧縮時に自動で抽出、手動編集も可能）。新しい会話でも有効です。",
  userMemoryPlaceholder:
    "長期記憶はまだありません。八千代との会話を圧縮すると自動で生成されます。ここに手動で入力することもできます。",
  userMemorySave: "記憶を保存",
  userMemoryClear: "記憶を削除",
  userMemorySaved: "長期記憶を保存しました",
  userMemoryCleared: "長期記憶を削除しました",
  userMemorySaveFailed: "長期記憶の保存に失敗しました。もう一度お試しください",
  recall: "取り消す",
  recallSuccess: "最新のメッセージを取り消しました",
  copyText: "コピー",
  copied: "コピーしました",
  regenerate: "再生成",
  skillsEntry: "スキル",
  skillsTitle: "スキル",
  skillsDescription: "会話で使用するテキスト処理スキル。有効にすると自動的に適用されます",
  skillEnable: "有効にする",
  skillDisable: "無効にする",
  skillToggleLabel: "スキルの有効/無効を切り替える",
  skillViewContent: "スキルの説明を見る",
  skillHideContent: "スキルの説明を閉じる",
  webSearchTitle: "ウェブ検索",
  webSearchDescription: "送信前にBingでウェブ検索し、最新情報をもとに返信します",
  webSearchShowSources: "引用ソースを表示",
  webSearchShowSourcesDescription: "ウェブ検索の返信の下に参考ソースへのリンクを表示します",
  webSearchSmart: "スマート検索",
  webSearchSmartDescription: "国際市場の直近30日間の結果も同時に検索し、最新情報の正確性を高めます",
  sourcesLabel: "参考ソース",
  workspaceEntry: "ワークスペース & Agent",
  workspaceTitle: "ワークスペース & Agent ターミナル",
  workspaceDescription: "ローカルAgentツールの実行ディレクトリを設定し、安全なファイル読み書きとターミナルコマンド実行をサポートします。",
} satisfies UiCopy);

const dictionaries: Readonly<Record<Locale, UiCopy>> = Object.freeze({
  "zh-CN": chinese,
  "ja-JP": japanese,
});

export function copyFor(locale: Locale): UiCopy {
  return dictionaries[locale];
}
