import { ArrowLeft, ArrowRight, Brain, Cpu, Globe, History, MessageCircle } from "lucide-react";
import { useId, useState } from "react";
import { usePanel } from "../app/use-panel";
import type { UiCopy } from "../i18n/messages";

export interface OnboardingGuideProps {
  copy: UiCopy;
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function OnboardingGuide({ copy, open, onClose, onOpenSettings }: OnboardingGuideProps) {
  const [step, setStep] = useState(0);
  const [previousOpen, setPreviousOpen] = useState(open);
  const titleId = useId();
  const { render, closing, closeRef, handleKeyDown, panelRef } = usePanel<HTMLDialogElement>(open, onClose);

  if (open !== previousOpen) {
    setPreviousOpen(open);
    if (open) setStep(0);
  }

  if (!render) return null;

  const titles = [copy.onboardingWelcomeTitle, copy.onboardingModelTitle, copy.onboardingFeaturesTitle];
  const Icon = [MessageCircle, Cpu, History][step];
  const isLastStep = step === titles.length - 1;
  const features = [
    { icon: History, title: copy.history, description: copy.onboardingHistoryDescription },
    { icon: Brain, title: copy.userMemoryEntry, description: copy.onboardingMemoryDescription },
    { icon: Globe, title: copy.webSearchTitle, description: copy.onboardingSearchDescription },
  ];

  return (
    <div className={`overlay overlay--onboarding ${closing ? "overlay--closing" : ""}`}>
      <button
        aria-label={`${copy.onboardingSkip} ·`}
        className="overlay__backdrop"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <dialog
        aria-labelledby={titleId}
        aria-modal="true"
        className={`onboarding-guide ${closing ? "onboarding-guide--closing" : ""}`}
        onKeyDown={handleKeyDown}
        open
        ref={panelRef}
      >
        <header className="onboarding-guide__header">
          <span id={titleId}>{copy.onboardingTitle}</span>
          <button className="onboarding-guide__skip" onClick={onClose} ref={closeRef} type="button">
            {copy.onboardingSkip}
          </button>
        </header>
        <div aria-atomic="true" aria-live="polite" className="onboarding-guide__body">
          <div aria-hidden="true" className="onboarding-guide__icon"><Icon size={32} strokeWidth={1.5} /></div>
          <p className="onboarding-guide__progress">{copy.onboardingProgress(step + 1, titles.length)}</p>
          <h2>{titles[step]}</h2>
          {step === 0 ? <p className="onboarding-guide__description">{copy.onboardingWelcomeDescription}</p> : null}
          {step === 1 ? <p className="onboarding-guide__description">{copy.onboardingModelDescription}</p> : null}
          {isLastStep ? (
            <ul className="onboarding-guide__features">
              {features.map(({ icon: FeatureIcon, title, description }) => (
                <li key={title}>
                  <FeatureIcon aria-hidden="true" size={20} strokeWidth={1.5} />
                  <div><strong>{title}</strong><p>{description}</p></div>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="onboarding-guide__hint">{copy.onboardingReplayHint}</p>
        </div>
        <footer className="onboarding-guide__footer">
          {isLastStep ? (
            <button className="onboarding-guide__settings" onClick={onOpenSettings} type="button">
              <Cpu aria-hidden="true" size={17} />{copy.onboardingOpenSettings}
            </button>
          ) : null}
          <div className="onboarding-guide__actions">
            {step > 0 ? (
              <button className="onboarding-guide__back" onClick={() => setStep(step - 1)} type="button">
                <ArrowLeft aria-hidden="true" size={17} />{copy.onboardingBack}
              </button>
            ) : null}
            <button
              className="onboarding-guide__next"
              onClick={isLastStep ? onClose : () => setStep(step + 1)}
              type="button"
            >
              {isLastStep ? copy.onboardingStart : copy.onboardingNext}
              <ArrowRight aria-hidden="true" size={17} />
            </button>
          </div>
        </footer>
      </dialog>
    </div>
  );
}
