import { Camera } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { UiCopy } from "../../i18n/messages";
import {
  ImageProcessingError,
  processImage,
  type ImageProcessingErrorCode,
  type ProcessedImage,
} from "./image-processor";

export interface CaptureButtonProps {
  copy: UiCopy;
  disabled?: boolean;
  onImage: (image: ProcessedImage) => void;
  onError: (code: ImageProcessingErrorCode) => void;
  process?: (file: File) => Promise<ProcessedImage>;
  className?: string;
}

export function CaptureButton({
  className,
  copy,
  disabled = false,
  onError,
  onImage,
  process = processImage,
}: CaptureButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const [processing, setProcessing] = useState(false);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (file === undefined) return;
    setProcessing(true);
    try {
      const image = await process(file);
      if (mountedRef.current) onImage(image);
    } catch (error) {
      if (mountedRef.current) {
        onError(error instanceof ImageProcessingError ? error.code : "IMAGE_DECODE_FAILED");
      }
    } finally {
      input.value = "";
      if (mountedRef.current) setProcessing(false);
    }
  };

  const unavailable = disabled || processing;
  return (
    <>
      <button
        className={className}
        disabled={unavailable}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        <Camera aria-hidden="true" size={20} strokeWidth={2.25} />
        <span>{processing ? copy.imageProcessing : copy.capture}</span>
      </button>
      <input
        ref={inputRef}
        accept="image/*"
        aria-label={copy.capture}
        capture="environment"
        className="visually-hidden"
        disabled={unavailable}
        onChange={(event) => void handleChange(event)}
        type="file"
      />
    </>
  );
}
