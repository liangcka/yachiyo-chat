// Generated from the root sticker-catalog.json. Do not edit.
export interface StickerEntry {
  /** [sticker:id] 标记中使用的唯一标识 */
  id: string;
  /** public/stickers/ 下的资产文件名 */
  file: string;
  /** 图像描述，用于 aria-label */
  alt: string;
  /** 适用场景，注入 system prompt 供模型自主判断 */
  scenes: string;
}

export const STICKER_CATALOG: readonly StickerEntry[] = [
  { id: "joycry", file: "joycry.webp", alt: "开怀大笑笑出泪", scenes: "笑到流泪、喜极而泣、特别开心时" },
  { id: "moved", file: "moved.gif", alt: "闭眼微笑挂着一滴泪", scenes: "感动、欣慰、笑着流泪的温柔时刻" },
  { id: "smile", file: "smile.jpg", alt: "点点を抱えて優しく微笑む", scenes: "穏やか・優しい微笑み・しっとりした甘え（映画風）" },
  { id: "cry", file: "cry.png", alt: "粉发哭腔委屈", scenes: "委屈、难过、快哭出来想被哄时" },
  { id: "relief", file: "relief.gif", alt: "偶像装扮含泪微笑", scenes: "破涕为笑、安心、苦尽甘来的释然时" },
  { id: "shy", file: "shy.gif", alt: "金发害羞浅笑", scenes: "照れ・ドキドキ・上目遣いで甘える時" },
  { id: "ok", file: "ok.webp", alt: "举着对勾牌答应", scenes: "了解・承諾・「任せて」と請け合う時" },
  { id: "dote", file: "dote.gif", alt: "夜里闭眼温柔笑", scenes: "深夜温柔陪伴、宠溺、安静道晚安时" },
  { id: "worry", file: "worry.gif", alt: "彩叶急得快哭", scenes: "提到彩叶着急、担心、心疼她的处境时" },
  { id: "chibi", file: "chibi.gif", alt: "Q版抱着点点", scenes: "撒娇、卖萌、举点点出来打招呼时" },
  { id: "cuddle", file: "cuddle.gif", alt: "和彩叶贴贴双人", scenes: "想贴贴、抱抱、表达「在一起」时" },
  { id: "munch", file: "munch.gif", alt: "叼饼干发呆", scenes: "发呆、吃零食、慢半拍的呆萌时刻" },
  { id: "rage", file: "rage.jpg", alt: "气到发抖", scenes: "气鼓鼓、炸毛、假装生气或真有小脾气时" },
  { id: "beam", file: "beam.gif", alt: "眯眼大笑抱红布", scenes: "大笑、得意、藏不住的开心时" },
];
