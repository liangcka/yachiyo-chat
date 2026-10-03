export interface BubblePiece {
  /** 稳定唯一的标识，供 React 渲染 key 使用 */
  id: string;
  /** 单条气泡的文本内容 */
  text: string;
  /** 流式状态下，如果为 true 则表示此气泡当前正在输入（展示跳动小圆点） */
  isTyping?: boolean;
}

/**
 * 将 assistant 消息的文本切分成多个独立气泡条目：
 *
 * 拆分策略：
 * 1. 若未开启多气泡拆分（enabled = false），保持单气泡行为；
 * 2. 优先按显式分隔线（独占一行的 --- 或 ===）切分；
 * 3. 若无显式分隔线，则按换行符（连续空行或单换行）切分；
 * 4. 过滤中间的无意义空白项；
 * 5. 流式传输（isStreaming）期间：若文本以换行/分隔线结尾，说明前一条刚打完，追加一个正在输入的 Typing 气泡；
 * 6. 非流式状态：过滤所有空白项，若无有效内容则返回空数组。
 */
export function splitAssistantMessage(
  text: string,
  isStreaming: boolean,
  enabled = true,
): BubblePiece[] {
  const normalized = text.replace(/\r\n/gu, "\n");

  if (!enabled) {
    const isTyping = isStreaming && normalized.length === 0;
    return [{ id: "bubble-0", isTyping, text: normalized }];
  }

  // 1. 如果还在等待首个字符输出
  if (normalized.length === 0) {
    return isStreaming ? [{ id: "bubble-0", isTyping: true, text: "" }] : [];
  }

  // 2. 判断是否存在独立成行的 --- 或 === 分隔符
  const hasDivider = /(?:^|\n)\s*(?:---|===)\s*(?:\n|$)/u.test(normalized);
  const rawParts = hasDivider
    ? normalized.split(/(?:^|\n)\s*(?:---|===)\s*(?:\n|$)/u)
    : normalized.split(/\n+/u);

  // 流式中检查是否以换行或分隔符结尾
  const endsWithSeparator = isStreaming && /(?:\n\s*(?:---|===)?\s*)$/u.test(normalized);

  const pieces: BubblePiece[] = [];
  for (let i = 0; i < rawParts.length; i++) {
    const raw = rawParts[i] ?? "";
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      pieces.push({
        id: `bubble-${pieces.length}`,
        isTyping: false,
        text: trimmed,
      });
    }
  }

  // 流式传输中，如果以分隔符结尾，或者整个 pieces 仍为空且流还在进行，添加一个 typing 气泡
  if (isStreaming && (endsWithSeparator || pieces.length === 0)) {
    pieces.push({
      id: `bubble-${pieces.length}`,
      isTyping: true,
      text: "",
    });
  }

  return pieces.length > 0 ? pieces : [{ id: "bubble-0", isTyping: false, text: normalized }];
}
