import { Archive, Brain, Cpu, History, MessageSquarePlus, Sparkles } from "lucide-react";
import type { UiCopy } from "../../i18n/messages";

export interface DrawerNavProps {
  copy: UiCopy;
  onClose: () => void;
  onCompress: () => void;
  onHistory: () => void;
  onLlmSettings: () => void;
  onNewChat: () => Promise<void>;
  onSkills: () => void;
  onUserMemory: () => void;
}

/** 抽屉导航入口：关闭抽屉的动作统一在此处理，回调只负责打开目标面板。 */
export function DrawerNav({
  copy,
  onClose,
  onCompress,
  onHistory,
  onLlmSettings,
  onNewChat,
  onSkills,
  onUserMemory,
}: DrawerNavProps) {
  const closeThen = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <nav className="drawer__actions">
      <button onClick={closeThen(() => void onNewChat())} type="button">
        <MessageSquarePlus aria-hidden="true" size={21} />
        <span>{copy.newChat}</span>
      </button>
      <button onClick={closeThen(onHistory)} type="button">
        <History aria-hidden="true" size={21} />
        <span>{copy.history}</span>
      </button>
      <button onClick={closeThen(onCompress)} type="button">
        <Archive aria-hidden="true" size={21} />
        <span>{copy.compressContext}</span>
      </button>
      <button onClick={closeThen(onUserMemory)} type="button">
        <Brain aria-hidden="true" size={21} />
        <span>{copy.userMemoryEntry}</span>
      </button>
      <button onClick={closeThen(onLlmSettings)} type="button">
        <Cpu aria-hidden="true" size={21} />
        <span>{copy.llmSettingsEntry}</span>
      </button>
      <button onClick={closeThen(onSkills)} type="button">
        <Sparkles aria-hidden="true" size={21} />
        <span>{copy.skillsEntry}</span>
      </button>
    </nav>
  );
}
