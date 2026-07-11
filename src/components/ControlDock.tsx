import { Mic, Settings, Smile, Volume2, type LucideIcon } from "lucide-react";
import type { UiCopy } from "../i18n/messages";

export interface ControlDockProps {
  copy: UiCopy;
  onSettings: () => void;
  onUnavailable: (message: string) => void;
}

interface ReservedControlProps {
  icon: LucideIcon;
  label: string;
  onUnavailable: (label: string) => void;
}

function ReservedControl({ icon: Icon, label, onUnavailable }: ReservedControlProps) {
  return (
    <button
      aria-disabled="true"
      aria-label={label}
      className="control-dock__button control-dock__button--reserved"
      onClick={() => onUnavailable(label)}
      type="button"
    >
      <Icon aria-hidden="true" size={28} strokeWidth={2.15} />
    </button>
  );
}

export function ControlDock({ copy, onSettings, onUnavailable }: ControlDockProps) {
  return (
    <div className="control-dock" role="toolbar" aria-label={copy.settings}>
      <button
        aria-label={copy.settings}
        className="control-dock__button"
        onClick={onSettings}
        type="button"
      >
        <Settings aria-hidden="true" size={29} strokeWidth={2.2} />
      </button>
      <ReservedControl icon={Smile} label={copy.emotionSoon} onUnavailable={onUnavailable} />
      <ReservedControl icon={Volume2} label={copy.speakerSoon} onUnavailable={onUnavailable} />
      <ReservedControl icon={Mic} label={copy.microphoneSoon} onUnavailable={onUnavailable} />
    </div>
  );
}
