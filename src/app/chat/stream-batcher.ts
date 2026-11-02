import type { ChatAction } from "../chat-reducer";

export interface PendingStreamDelta {
  messageId: string;
  text: string;
  type: "delta" | "thought-delta";
}

/** 流式 delta/thought 用 requestAnimationFrame 合并后再 dispatch，避免逐 chunk 触发全列表 reducer */
export interface StreamBatcher {
  /** 追加一个待合并的流式增量；返回 true 表示本次调度了 rAF 刷新 */
  push(action: PendingStreamDelta): boolean;
  /** 立即同步派发所有未合并的增量（终态/中止/卸载前必须调用） */
  flush(): void;
}

export function createStreamBatcher(
  emitAction: (action: ChatAction) => void,
): StreamBatcher {
  let pending = new Map<string, PendingStreamDelta>();
  let frameHandle: number | undefined;

  const flush = () => {
    if (frameHandle !== undefined) {
      cancelAnimationFrame(frameHandle);
      frameHandle = undefined;
    }
    if (pending.size === 0) return;
    const batch = [...pending.values()];
    pending = new Map();
    for (const action of batch) {
      emitAction(action);
    }
  };

  const schedule = () => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      flush();
      return false;
    }
    frameHandle = window.requestAnimationFrame(() => {
      frameHandle = undefined;
      flush();
    });
    return true;
  };

  return {
    push(action) {
      const key = `${action.type}:${action.messageId}`;
      pending.set(key, {
        ...pending.get(key),
        text: (pending.get(key)?.text ?? "") + action.text,
        messageId: action.messageId,
        type: action.type,
      });
      if (frameHandle === undefined) return schedule();
      return false;
    },
    flush,
  };
}
