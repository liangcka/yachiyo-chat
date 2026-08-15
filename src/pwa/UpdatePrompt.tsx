import { RefreshCw, WifiOff, X } from "lucide-react";
import { usePwaUpdate } from "./use-pwa-update";
import type { UiCopy } from "../i18n/messages";


export interface UpdatePromptProps {
  copy: UiCopy;
  needRefresh?: boolean;
  offlineReady?: boolean;
  onConfirmOfflineReady?: () => void;
  onDismissUpdate?: () => void;
  onUpdate?: () => void;
}

export function UpdatePrompt({
  copy,
  needRefresh: propNeedRefresh,
  offlineReady: propOfflineReady,
  onConfirmOfflineReady,
  onDismissUpdate,
  onUpdate,
}: UpdatePromptProps) {
  const internal = usePwaUpdate();

  const needRefresh = propNeedRefresh ?? internal.needRefresh;
  const offlineReady = propOfflineReady ?? internal.offlineReady;
  const handleConfirmOfflineReady = onConfirmOfflineReady ?? (() => internal.setOfflineReady(false));
  const handleDismissUpdate = onDismissUpdate ?? (() => internal.setNeedRefresh(false));
  const handleUpdate = onUpdate ?? (() => void internal.updateServiceWorker(true));

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
        <button onClick={handleUpdate} type="button">
          {copy.updateAction}
        </button>
      ) : (
        <button aria-label={copy.confirm} onClick={handleConfirmOfflineReady} type="button">
          <X aria-hidden="true" size={17} />
        </button>
      )}
      {needRefresh ? (
        <button
          aria-label={copy.cancel}
          className="pwa-prompt__dismiss"
          onClick={handleDismissUpdate}
          type="button"
        >
          <X aria-hidden="true" size={17} />
        </button>
      ) : null}
    </div>
  );
}
