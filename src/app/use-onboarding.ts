import { useCallback, useEffect, useState } from "react";
import type { AppRepository } from "./app-services";

export interface OnboardingState {
  open: boolean;
  /** 关闭并记住已完成；保存失败只提示，不阻止关闭。 */
  close(): void;
  reopen(): void;
}

export function useOnboarding(
  repository: Pick<AppRepository, "getOnboardingCompleted" | "setOnboardingCompleted">,
  onSaveFailed: () => void,
): OnboardingState {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (repository.getOnboardingCompleted?.() ?? Promise.resolve(false))
      .catch(() => false)
      .then((completed) => {
        if (!cancelled) setOpen(!completed);
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const close = useCallback(() => {
    setOpen(false);
    void repository.setOnboardingCompleted?.(true).catch(onSaveFailed);
  }, [onSaveFailed, repository]);

  const reopen = useCallback(() => setOpen(true), []);

  return { open, close, reopen };
}
