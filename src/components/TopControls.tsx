import { Equal } from "lucide-react";
import type { UiCopy } from "../i18n/messages";
import {
  CaptureButton,
  type CaptureButtonProps,
} from "../features/capture/CaptureButton";

export interface TopControlsProps {
  copy: UiCopy;
  onMenu: () => void;
  onImage: CaptureButtonProps["onImage"];
  onCaptureError: CaptureButtonProps["onError"];
  captureDisabled?: boolean;
  processImage?: CaptureButtonProps["process"];
}

export function TopControls({
  captureDisabled = false,
  copy,
  onCaptureError,
  onImage,
  onMenu,
  processImage,
}: TopControlsProps) {
  return (
    <>
      <div aria-hidden="true" className="top-header-scrim" />
      <header className="top-controls">
        <button
          aria-label={copy.menu}
          className="top-controls__menu"
          onClick={onMenu}
          type="button"
        >
          <Equal aria-hidden="true" size={31} strokeWidth={1.8} />
        </button>
        <CaptureButton
          className="capture-pill"
          copy={copy}
          disabled={captureDisabled}
          onError={onCaptureError}
          onImage={onImage}
          process={processImage}
        />
      </header>
    </>
  );
}
