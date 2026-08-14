import { Send, Square, X } from "lucide-react";
import { useRef, type FormEvent, type KeyboardEvent } from "react";
import type { ChatPhase } from "../app/chat-reducer";
import type { UiCopy } from "../i18n/messages";

export interface ComposerProps {
  copy: UiCopy;
  phase: ChatPhase;
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string) => void;
  onStop: () => void;
  disabled?: boolean;
  pendingImageDataUrl?: string;
  onRemoveImage?: () => void;
}

export function Composer({
  copy,
  disabled = false,
  onChange,
  onRemoveImage,
  onSend,
  onStop,
  pendingImageDataUrl,
  phase,
  value,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streaming = phase === "streaming";
  const unavailable = disabled || phase === "loading" || phase === "offline" || phase === "compressing";
  const canSend = value.trim().length > 0 || pendingImageDataUrl !== undefined;

  const submit = () => {
    if (!streaming && !unavailable && canSend) onSend(value);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (streaming) onStop();
    else submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229
    ) {
      return;
    }
    event.preventDefault();
    submit();
  };

  return (
    <form className="composer" onSubmit={handleSubmit}>
      {pendingImageDataUrl === undefined ? null : (
        <div className="composer__preview">
          <img alt="" src={pendingImageDataUrl} />
          <button
            aria-label={copy.removeImage}
            disabled={streaming}
            onClick={onRemoveImage}
            type="button"
          >
            <X aria-hidden="true" size={17} />
          </button>
        </div>
      )}
      <label className="composer__input-wrap">
        <textarea
          ref={textareaRef}
          aria-label={copy.inputHint}
          disabled={unavailable || streaming}
          maxLength={4000}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={phase === "compressing" ? copy.compressingContext : copy.inputHint}
          rows={1}
          value={value}
        />
      </label>
      <button
        aria-label={streaming ? copy.stop : copy.send}
        className={`composer__action${streaming ? " composer__action--stop" : ""}`}
        disabled={!streaming && (unavailable || !canSend)}
        type="submit"
      >
        {streaming ? (
          <>
            <Square aria-hidden="true" fill="currentColor" size={15} />
            <span>{copy.stop}</span>
          </>
        ) : (
          <>
            <Send aria-hidden="true" size={18} />
            <span>{copy.send}</span>
          </>
        )}
      </button>
    </form>
  );
}
