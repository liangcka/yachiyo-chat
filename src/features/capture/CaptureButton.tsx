import { Camera, Image as ImageIcon } from "lucide-react";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const albumInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const [processing, setProcessing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const unavailable = disabled || processing;
  const isMenuOpen = menuOpen && !unavailable;

  useEffect(() => {
    if (!isMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (file === undefined) return;
    setProcessing(true);
    setMenuOpen(false);
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

  const handleToggleMenu = () => {
    if (unavailable) return;
    setMenuOpen((open) => !open);
  };

  const handleSelectCamera = () => {
    setMenuOpen(false);
    cameraInputRef.current?.click();
  };

  const handleSelectAlbum = () => {
    setMenuOpen(false);
    albumInputRef.current?.click();
  };

  return (
    <div className="capture-control" ref={containerRef}>
      <button
        aria-busy={processing}
        aria-expanded={isMenuOpen}
        aria-haspopup="menu"
        className={className}
        disabled={unavailable}
        onClick={handleToggleMenu}
        type="button"
      >
        <Camera aria-hidden="true" size={20} strokeWidth={2.25} />
        <span>{processing ? copy.imageProcessing : copy.capture}</span>
      </button>
      {isMenuOpen ? (
        <div
          aria-label={copy.capture}
          className="capture-menu"
          role="menu"
        >
          <button
            className="capture-menu__item"
            onClick={handleSelectCamera}
            role="menuitem"
            type="button"
          >
            <Camera aria-hidden="true" size={16} strokeWidth={2.2} />
            <span>{copy.captureCamera}</span>
          </button>
          <button
            className="capture-menu__item"
            onClick={handleSelectAlbum}
            role="menuitem"
            type="button"
          >
            <ImageIcon aria-hidden="true" size={16} strokeWidth={2.2} />
            <span>{copy.captureAlbum}</span>
          </button>
        </div>
      ) : null}
      <input
        ref={cameraInputRef}
        accept="image/*"
        aria-hidden="true"
        capture="environment"
        className="visually-hidden"
        data-testid="capture-camera-input"
        disabled={unavailable}
        onChange={(event) => void handleChange(event)}
        tabIndex={-1}
        type="file"
      />
      <input
        ref={albumInputRef}
        accept="image/*"
        aria-hidden="true"
        className="visually-hidden"
        data-testid="capture-album-input"
        disabled={unavailable}
        onChange={(event) => void handleChange(event)}
        tabIndex={-1}
        type="file"
      />
    </div>
  );
}
