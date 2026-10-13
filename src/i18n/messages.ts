import type { Locale } from "../domain/chat";

export interface UiCopy {
  readonly appName: string;
  readonly menu: string;
  readonly closeMenu: string;
  readonly capture: string;
  readonly captureCamera: string;
  readonly captureAlbum: string;
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
  readonly historySearchLabel: string;
  readonly historySearchPlaceholder: string;
  readonly historySearchClear: string;
  readonly historySearching: string;
  readonly historySearchEmpty: string;
  readonly historySearchFailed: string;
  readonly historySearchRetry: string;
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
  readonly nativeUpdateTitle: string;
  readonly nativeCurrentVersion: (version: string) => string;
  readonly nativeUpdateCheck: string;
  readonly nativeUpdateChecking: string;
  readonly nativeUpdateCurrent: string;
  readonly nativeUpdateError: string;
  readonly nativeUpdateDownloading: (progress: number) => string;
  readonly nativeUpdateReady: (version: string) => string;
  readonly nativeUpdateLater: string;
  readonly nativeUpdateBlocked: string;
  readonly nativeUpdateCloseSettings: string;
  readonly nativeUpdateIncompatible: string;
  readonly nativeUpdateGetApk: string;
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
  readonly llmModelNoImageSupport: string;
  readonly llmRecommended: string;
  readonly llmFree: string;
  readonly llmVisionTag: string;
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
  readonly userMemoryLimitHint: string;
  readonly userMemoryPlaceholder: string;
  readonly userMemorySave: string;
  readonly userMemoryClear: string;
  readonly userMemorySaved: string;
  readonly userMemoryCleared: string;
  readonly userMemorySaveFailed: string;
  readonly userMemoryHistoryTitle: string;
  readonly userMemoryHistoryEmpty: string;
  readonly userMemoryBefore: string;
  readonly userMemoryAfter: string;
  readonly userMemoryEmpty: string;
  readonly userMemoryUndo: string;
  readonly userMemoryUndoFailed: string;
  readonly userMemoryUndoSuccess: string;
  readonly userMemorySourceAutomatic: string;
  readonly userMemorySourceManual: string;
  readonly userMemorySourceMessage: string;
  readonly userMemorySourceUndo: string;
  readonly rememberMessage: string;
  readonly rememberMessagePending: string;
  readonly rememberMessageUnchanged: string;
  readonly rememberMessageTooLong: string;
  readonly recall: string;
  readonly recallSuccess: string;
  readonly copyText: string;
  readonly copied: string;
  readonly regenerate: string;
  readonly skillsEntry: string;
  readonly skillsTitle: string;
  readonly skillsDescription: string;
  readonly skillsEmpty: string;
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
  readonly multiBubbleTitle: string;
  readonly multiBubbleDescription: string;
  readonly workspaceEntry: string;
  readonly workspaceTitle: string;
  readonly workspaceDescription: string;
  readonly chatPreferences: string;
  readonly chatPreferencesDescription: string;
  readonly allSettings: string;
  readonly activeModelLabel: string;
  readonly defaultModelLabel: string;
  readonly sessionSectionTitle: string;
  readonly settingsSectionTitle: string;
  readonly onboardingTitle: string;
  readonly onboardingEntry: string;
  readonly onboardingSkip: string;
  readonly onboardingNext: string;
  readonly onboardingBack: string;
  readonly onboardingStart: string;
  readonly onboardingOpenSettings: string;
  readonly onboardingProgress: (step: number, total: number) => string;
  readonly onboardingWelcomeTitle: string;
  readonly onboardingWelcomeDescription: string;
  readonly onboardingModelTitle: string;
  readonly onboardingModelDescription: string;
  readonly onboardingFeaturesTitle: string;
  readonly onboardingHistoryDescription: string;
  readonly onboardingMemoryDescription: string;
  readonly onboardingSearchDescription: string;
  readonly onboardingReplayHint: string;
}

const chinese = Object.freeze({
  appName: "Yachiyo Chat",
  menu: "菜单",
  closeMenu: "关闭菜单",
  capture: "拍摄",
  captureCamera: "相机",
  captureAlbum: "相册",
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
  historySearchLabel: "搜索对话",
  historySearchPlaceholder: "搜索标题或消息内容",
  historySearchClear: "清除搜索",
  historySearching: "正在搜索…",
  historySearchEmpty: "没有找到相关对话",
  historySearchFailed: "搜索失败，请重试。",
  historySearchRetry: "重新搜索",
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
  nativeUpdateTitle: "应用更新",
  nativeCurrentVersion: (version) => `当前版本 ${version}`,
  nativeUpdateCheck: "检查更新",
  nativeUpdateChecking: "正在检查更新…",
  nativeUpdateCurrent: "已是最新版本",
  nativeUpdateError: "暂时无法更新，请检查网络后重试。",
  nativeUpdateDownloading: (progress) => `正在下载更新 ${progress}%`,
  nativeUpdateReady: (version) => `新版本 ${version} 已准备好`,
  nativeUpdateLater: "稍后",
  nativeUpdateBlocked: "更新前请结束正在进行的聊天，处理草稿或图片，并关闭面板。",
  nativeUpdateCloseSettings: "关闭设置后，可在聊天页确认更新。",
  nativeUpdateIncompatible: "这次更新需要安装新版 APK。聊天记录会保留，请直接覆盖安装。",
  nativeUpdateGetApk: "下载新版 APK",
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
  llmModelNoImageSupport: "当前模型不支持图片输入，可选择带「识图」标签的模型。",
  llmRecommended: "推荐",
  llmFree: "免费",
  llmVisionTag: "识图",
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
  userMemoryEntry: "记忆",
  userMemoryTitle: "记忆",
  userMemoryDescription:
    "八千代会整理你在聊天中表达的稳定偏好，并在之后的对话中记住。删除聊天也会清理对应记忆，部分旧版记忆可能仍会保留。",
  userMemoryLimitHint: "每段聊天最多自动整理 2000 字记忆；聊天会使用合并记忆的前 3000 字。",
  userMemoryPlaceholder: "还没有记住的内容。聊聊你的喜好，八千代会慢慢记住。",
  userMemorySave: "保存记忆",
  userMemoryClear: "清除记忆",
  userMemorySaved: "长期记忆已保存",
  userMemoryCleared: "长期记忆已清除",
  userMemorySaveFailed: "长期记忆保存失败，请重试",
  userMemoryHistoryTitle: "记忆变更记录",
  userMemoryHistoryEmpty: "还没有记忆变更记录",
  userMemoryBefore: "变更前",
  userMemoryAfter: "变更后",
  userMemoryEmpty: "空记忆",
  userMemoryUndo: "撤销这次变更",
  userMemoryUndoFailed: "无法撤销，记录已刷新，请重试",
  userMemoryUndoSuccess: "已撤销最近一次记忆变更",
  userMemorySourceAutomatic: "自动整理",
  userMemorySourceManual: "手动编辑",
  userMemorySourceMessage: "主动记住",
  userMemorySourceUndo: "撤销操作",
  rememberMessage: "记住这件事",
  rememberMessagePending: "正在整理这条消息中的记忆…",
  rememberMessageUnchanged: "这条消息没有新增的稳定事实，记忆保持不变",
  rememberMessageTooLong: "消息或现有记忆过长，暂时无法记住这件事",
  recall: "撤回",
  recallSuccess: "已撤回最新一条消息",
  copyText: "复制",
  copied: "已复制",
  regenerate: "重新生成",
  skillsEntry: "技能",
  skillsTitle: "技能",
  skillsDescription: "供对话调用的文本处理技能，启用后自动生效",
  skillsEmpty: "暂无可用技能",
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
  multiBubbleTitle: "分条发送消息",
  multiBubbleDescription: "像真人日常聊天一样，允许八千代根据语境自主决定单条或分多条气泡回复",
  workspaceEntry: "工作区 & Agent",
  workspaceTitle: "工作区 & Agent 终端",
  workspaceDescription: "配置本地 Agent 工具的运行目录，支持安全文件读写与终端命令执行。",
  chatPreferences: "聊天偏好",
  chatPreferencesDescription: "调整八千代的回复方式、联网时效性与日常交互习惯",
  allSettings: "设置中心",
  activeModelLabel: "当前模型",
  defaultModelLabel: "默认服务",
  sessionSectionTitle: "对话管理",
  settingsSectionTitle: "偏好与功能",
  onboardingTitle: "新手引导",
  onboardingEntry: "重看新手引导",
  onboardingSkip: "跳过",
  onboardingNext: "下一步",
  onboardingBack: "上一步",
  onboardingStart: "开始聊天",
  onboardingOpenSettings: "前往模型设置",
  onboardingProgress: (step, total) => `第 ${step} 步，共 ${total} 步`,
  onboardingWelcomeTitle: "和八千代聊聊吧",
  onboardingWelcomeDescription: "在底部输入框写下想说的话，点击发送就能开始。左上角菜单可以新建对话、查看历史或打开设置。",
  onboardingModelTitle: "模型已经准备好了",
  onboardingModelDescription: "默认服务使用 GLM-4.7-Flash，无需填写自己的 API Key。如需使用自己的服务，在「LLM 设置」中填写 API Key、选择模型，保存后设为当前。",
  onboardingFeaturesTitle: "这些入口，随时用得上",
  onboardingHistoryDescription: "在菜单中查看或搜索这台设备上保存的对话。",
  onboardingMemoryDescription: "八千代会从聊天中整理稳定偏好，在设置中可以查看已记住的内容。",
  onboardingSearchDescription: "在「聊天偏好」中开启联网搜索，让回复参考网络资料。",
  onboardingReplayHint: "以后也可以在设置里重看这份引导。",
} satisfies UiCopy);

const japanese = Object.freeze({
  appName: "Yachiyo Chat",
  menu: "メニュー",
  closeMenu: "メニューを閉じる",
  capture: "撮影",
  captureCamera: "カメラ",
  captureAlbum: "アルバム",
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
  historySearchLabel: "会話を検索",
  historySearchPlaceholder: "タイトルやメッセージを検索",
  historySearchClear: "検索をクリア",
  historySearching: "検索中…",
  historySearchEmpty: "該当する会話がありません",
  historySearchFailed: "検索できませんでした。もう一度お試しください。",
  historySearchRetry: "再検索",
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
  nativeUpdateTitle: "アプリの更新",
  nativeCurrentVersion: (version) => `現在のバージョン ${version}`,
  nativeUpdateCheck: "更新を確認",
  nativeUpdateChecking: "更新を確認中…",
  nativeUpdateCurrent: "最新のバージョンです",
  nativeUpdateError: "今は更新できません。接続を確認して再試行してください。",
  nativeUpdateDownloading: (progress) => `更新をダウンロード中 ${progress}%`,
  nativeUpdateReady: (version) => `新しいバージョン ${version} の準備ができました`,
  nativeUpdateLater: "あとで",
  nativeUpdateBlocked: "更新の前に会話の処理を終え、下書きや画像を処理して、パネルを閉じてください。",
  nativeUpdateCloseSettings: "設定を閉じると、チャット画面で更新できます。",
  nativeUpdateIncompatible: "新しい APK のインストールが必要です。会話を残すため、アプリを削除せず上書きしてください。",
  nativeUpdateGetApk: "新しい APK をダウンロード",
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
  llmModelNoImageSupport: "選択中のモデルはテキスト専用です（画像認識には「識図」タグ付きのモデルを選択してください）",
  llmRecommended: "おすすめ",
  llmFree: "無料",
  llmVisionTag: "画像",
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
  userMemoryEntry: "記憶",
  userMemoryTitle: "記憶",
  userMemoryDescription:
    "八千代は会話で伝えてくれた好みを整理し、次の会話でも覚えています。会話を削除すると、その会話の記憶も削除されます。旧版で保存した一部の記憶は残る場合があります。",
  userMemoryLimitHint: "会話ごとに最大2000文字の記憶を自動整理します。会話では統合した記憶の先頭3000文字を使います。",
  userMemoryPlaceholder:
    "覚えていることはまだありません。好きなものを話すと、八千代が少しずつ覚えます。",
  userMemorySave: "記憶を保存",
  userMemoryClear: "記憶を削除",
  userMemorySaved: "長期記憶を保存しました",
  userMemoryCleared: "長期記憶を削除しました",
  userMemorySaveFailed: "長期記憶の保存に失敗しました。もう一度お試しください",
  userMemoryHistoryTitle: "記憶の変更履歴",
  userMemoryHistoryEmpty: "記憶の変更履歴はまだありません",
  userMemoryBefore: "変更前",
  userMemoryAfter: "変更後",
  userMemoryEmpty: "記憶なし",
  userMemoryUndo: "この変更を元に戻す",
  userMemoryUndoFailed: "元に戻せませんでした。履歴を更新したので、もう一度お試しください",
  userMemoryUndoSuccess: "直前の記憶の変更を元に戻しました",
  userMemorySourceAutomatic: "自動整理",
  userMemorySourceManual: "手動編集",
  userMemorySourceMessage: "選んだメッセージ",
  userMemorySourceUndo: "元に戻す操作",
  rememberMessage: "これを覚えて",
  rememberMessagePending: "このメッセージから記憶を整理しています…",
  rememberMessageUnchanged: "新たに記憶する事実がないため、記憶は変わっていません",
  rememberMessageTooLong: "メッセージまたは記憶が長すぎるため、今は覚えられません",
  recall: "取り消す",
  recallSuccess: "最新のメッセージを取り消しました",
  copyText: "コピー",
  copied: "コピーしました",
  regenerate: "再生成",
  skillsEntry: "スキル",
  skillsTitle: "スキル",
  skillsDescription: "会話で使用するテキスト処理スキル。有効にすると自動的に適用されます",
  skillsEmpty: "利用できるスキルはまだありません",
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
  multiBubbleTitle: "メッセージ分割送信",
  multiBubbleDescription: "日常チャットのように、八千代が状況に応じて1通または複数通の吹き出しに分けて返信します",
  workspaceEntry: "ワークスペース & Agent",
  workspaceTitle: "ワークスペース & Agent ターミナル",
  workspaceDescription: "ローカルAgentツールの実行ディレクトリを設定し、安全なファイル読み書きとターミナルコマンド実行をサポートします。",
  chatPreferences: "チャット設定",
  chatPreferencesDescription: "返信スタイル、Web検索、日常的な対話の設定を調整します",
  allSettings: "設定センター",
  activeModelLabel: "現在のモデル",
  defaultModelLabel: "デフォルト",
  sessionSectionTitle: "対話管理",
  settingsSectionTitle: "機能・設定",
  onboardingTitle: "はじめてのガイド",
  onboardingEntry: "ガイドをもう一度見る",
  onboardingSkip: "スキップ",
  onboardingNext: "次へ",
  onboardingBack: "戻る",
  onboardingStart: "チャットを始める",
  onboardingOpenSettings: "モデル設定を開く",
  onboardingProgress: (step, total) => `${total} ステップ中 ${step} ステップ目`,
  onboardingWelcomeTitle: "八千代と話してみよう",
  onboardingWelcomeDescription: "画面下の入力欄に話したいことを書いて、送信すれば始められます。左上のメニューから会話の作成、履歴の確認、設定ができます。",
  onboardingModelTitle: "モデルは準備できています",
  onboardingModelDescription: "デフォルトのサービスは GLM-4.7-Flash を使用し、自分の API Key は不要です。自分のサービスを使う場合は「LLM 設定」で API Key とモデルを保存し、「現在の設定にする」を選んでください。",
  onboardingFeaturesTitle: "便利な機能も使ってみよう",
  onboardingHistoryDescription: "メニューから、この端末に保存した会話を確認・検索できます。",
  onboardingMemoryDescription: "八千代は会話から好みを整理します。覚えている内容は設定で確認できます。",
  onboardingSearchDescription: "「チャット設定」でウェブ検索を有効にすると、返信にウェブの情報を使います。",
  onboardingReplayHint: "このガイドは設定からいつでも見直せます。",
} satisfies UiCopy);

const dictionaries: Readonly<Record<Locale, UiCopy>> = Object.freeze({
  "zh-CN": chinese,
  "ja-JP": japanese,
});

export function copyFor(locale: Locale): UiCopy {
  return dictionaries[locale];
}
