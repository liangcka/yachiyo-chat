import { Download, RefreshCw } from "lucide-react";
import { useId } from "react";
import type { UiCopy } from "../i18n/messages";
import type { NativeUpdateState } from "./use-native-update";

interface NativeUpdateControlsProps {
  copy: UiCopy;
  update: NativeUpdateState;
}

function downloadProgress(progress: number): number {
  return Math.round(Math.max(0, Math.min(100, progress)));
}

export function NativeUpdatePrompt({
  blocked,
  copy,
  update,
}: NativeUpdateControlsProps & { blocked: boolean }) {
  const blockedHintId = useId();
  if (!update.supported || update.dismissed ||
    (update.status !== "downloading" && update.status !== "ready")) return null;

  const downloading = update.status === "downloading";
  const progress = downloadProgress(update.progress);
  return (
    <div className="pwa-prompt native-update-prompt" role="status">
      <Download aria-hidden="true" size={19} />
      <div className="native-update-prompt__content">
        <span>{downloading
          ? copy.nativeUpdateDownloading(progress)
          : copy.nativeUpdateReady(update.availableVersion ?? "")}</span>
        {downloading ? (
          <progress aria-label={copy.nativeUpdateTitle} max={100} value={progress} />
        ) : blocked ? (
          <small id={blockedHintId}>{copy.nativeUpdateBlocked}</small>
        ) : null}
      </div>
      <div className="native-update-prompt__actions">
        {!downloading ? (
          <button
            aria-describedby={blocked ? blockedHintId : undefined}
            disabled={blocked}
            onClick={() => void update.apply()}
            type="button"
          >
            {copy.updateAction}
          </button>
        ) : null}
        <button className="native-update-prompt__later" onClick={update.dismiss} type="button">
          {copy.nativeUpdateLater}
        </button>
      </div>
    </div>
  );
}

export function NativeUpdateSettings({ copy, update }: NativeUpdateControlsProps) {
  if (!update.supported) return null;

  const busy = update.status === "checking" || update.status === "downloading";
  const progress = downloadProgress(update.progress);
  const status = update.status === "checking" ? copy.nativeUpdateChecking
    : update.status === "downloading" ? copy.nativeUpdateDownloading(progress)
    : update.status === "current" ? copy.nativeUpdateCurrent
    : update.status === "error" ? copy.nativeUpdateError
    : update.status === "incompatible" ? copy.nativeUpdateIncompatible
    : update.status === "ready" ? copy.nativeUpdateReady(update.availableVersion ?? "")
    : null;

  return (
    <section aria-label={copy.nativeUpdateTitle} className="native-update-settings">
      <div className="native-update-settings__row">
        <div>
          <strong>{copy.nativeUpdateTitle}</strong>
          <span>{copy.nativeCurrentVersion(update.currentVersion)}</span>
        </div>
        <button disabled={busy} onClick={() => void update.check()} type="button">
          <RefreshCw aria-hidden="true" size={15} />
          {update.status === "error" ? copy.retry : copy.nativeUpdateCheck}
        </button>
      </div>
      {status ? <p role="status">{status}</p> : null}
      {update.status === "ready" ? <p>{copy.nativeUpdateCloseSettings}</p> : null}
      {update.status === "incompatible" ? (
        <a href={update.apkReleaseUrl} rel="noreferrer" target="_blank">{copy.nativeUpdateGetApk}</a>
      ) : null}
    </section>
  );
}
