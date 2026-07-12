import { RefreshCw, WifiOff, X } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import type { UiCopy } from "../i18n/messages";

export interface UpdatePromptProps {
  copy: UiCopy;
}

export function UpdatePrompt({ copy }: UpdatePromptProps) {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh && !offlineReady) return null;

  return (
    <div className="pwa-prompt" role="status">
      {needRefresh ? (
        <RefreshCw aria-hidden="true" size={19} />
      ) : (
        <WifiOff aria-hidden="true" size={19} />
      )}
      <span>{needRefresh ? copy.updateReady : copy.offlineReady}</span>
      {needRefresh ? (
        <button onClick={() => void updateServiceWorker(true)} type="button">
          {copy.updateAction}
        </button>
      ) : (
        <button aria-label={copy.confirm} onClick={() => setOfflineReady(false)} type="button">
          <X aria-hidden="true" size={17} />
        </button>
      )}
      {needRefresh ? (
        <button
          aria-label={copy.cancel}
          className="pwa-prompt__dismiss"
          onClick={() => setNeedRefresh(false)}
          type="button"
        >
          <X aria-hidden="true" size={17} />
        </button>
      ) : null}
    </div>
  );
}
