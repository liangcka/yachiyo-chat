export interface BubblePiece {
  /** 稳定唯一的标识，供 React 渲染 key 使用 */
  id: string;
  /** 单条气泡的文本内容 */
  text: string;
  /** 流式状态下，如果为 true 则表示此气泡当前正在输入（展示跳动小圆点） */
  isTyping?: boolean;
}

function isDividerLine(line: string): boolean {
  return /^\s*(?:---|===)\s*$/u.test(line);
}

function isListItemLine(line: string): boolean {
  return /^\s*(?:\d+[.)]|[-*•])\s+/u.test(line);
}

function isListIntroLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.endsWith(":") || trimmed.endsWith("：");
}

function isCodeFence(line: string): boolean {
  return /^\s*```/u.test(line);
}

/**
 * 将 assistant 消息的文本切分成多个独立气泡条目：
 *
 * 拆分策略：
 * 1. 若未开启多气泡拆分（enabled = false），保持单气泡行为；
 * 2. 保护 Markdown 代码块（``` 包裹的内容绝对不跨气泡切碎）；
 * 3. 保护列表项（连续的 1. 2. 或 - * 列表与前置引导句保持在同一气泡）；
 * 4. 优先按显式分隔线（独占一行的 --- 或 ===）切分；
 * 5. 若无显式分隔线，则按非列表、非代码块的独立句子/换行切分；
 * 6. 流式传输（isStreaming）期间：若文本以合法分隔符/换行结尾且不在代码块中，追加 Typing 气泡；
 * 7. 非流式状态：过滤所有空白项，若无有效内容则返回空数组。
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

  const lines = normalized.split("\n");
  const hasDivider = lines.some((line) => isDividerLine(line));

  const piecesText: string[] = [];
  let currentLines: string[] = [];
  let inCodeBlock = false;
  let inList = false;

  const flushCurrent = () => {
    if (currentLines.length > 0) {
      const joined = currentLines.join("\n").trim();
      if (joined.length > 0) {
        piecesText.push(joined);
      }
      currentLines = [];
      inList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    // 检查代码块标记
    if (isCodeFence(line)) {
      inCodeBlock = !inCodeBlock;
      currentLines.push(line);
      continue;
    }

    if (inCodeBlock) {
      currentLines.push(line);
      continue;
    }

    // 独立显式分隔符
    if (isDividerLine(line)) {
      flushCurrent();
      continue;
    }

    if (hasDivider) {
      // 存在显式分隔符时，普通换行保留在当前气泡中
      currentLines.push(line);
      continue;
    }

    // 无显式分隔符时的智能拆分逻辑
    if (trimmed.length === 0) {
      flushCurrent();
      continue;
    }

    const isCurrentListItem = isListItemLine(line);
    const isCurrentListIntro = isListIntroLine(line);

    if (isCurrentListItem) {
      inList = true;
      currentLines.push(line);
      continue;
    }

    if (inList) {
      // 如果上一行是列表项，当前行是缩进文本（列表说明），继续归入列表
      if (/^\s+/u.test(line)) {
        currentLines.push(line);
        continue;
      }
      // 列表结束，当前行开始新的气泡
      flushCurrent();
      inList = false;
    } else if (isCurrentListIntro) {
      // 如果当前是列表引导句（如“推荐以下几部：”），先输出之前积累的内容（若有）
      if (currentLines.length > 0) {
        flushCurrent();
      }
      currentLines.push(line);
      continue;
    }

    // 普通行：如果当前气泡已有内容，拆分新气泡
    if (currentLines.length > 0) {
      flushCurrent();
    }
    currentLines.push(line);
  }

  flushCurrent();

  // 流式中检查是否以换行或分隔符结尾，且当前不在代码块内
  const endsWithSeparator =
    isStreaming &&
    !inCodeBlock &&
    /(?:\n\s*(?:---|===)?\s*)$/u.test(normalized);

  const pieces: BubblePiece[] = [];
  for (let i = 0; i < piecesText.length; i++) {
    const piece = piecesText[i];
    if (piece !== undefined && piece.length > 0) {
      pieces.push({
        id: `bubble-${pieces.length}`,
        isTyping: false,
        text: piece,
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
