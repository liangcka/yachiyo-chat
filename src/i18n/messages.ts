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
  readonly conversationLimit: string;
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
  conversationLimit: "本地最多保留 30 段对话，请先删除一段。",
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
  conversationLimit: "会話は端末に30件まで保存できます。先に1件削除してください。",
} satisfies UiCopy);

const dictionaries: Readonly<Record<Locale, UiCopy>> = Object.freeze({
  "zh-CN": chinese,
  "ja-JP": japanese,
});

export function copyFor(locale: Locale): UiCopy {
  return dictionaries[locale];
}
