import { Check, ChevronDown, Eye, EyeOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useClosing } from "../app/use-closing";
import {
  DOMESTIC_PROVIDERS,
  INTERNATIONAL_PROVIDERS,
  PROVIDER_METADATA,
  getProviderMeta,
  isValidApiKey,
  type ProviderId,
} from "../domain/llm";
import type { UiCopy } from "../i18n/messages";

export interface LlmProviderEntry {
  provider: ProviderId;
  apiKey: string;
  model: string;
}

export interface LlmSettingsPanelProps {
  copy: UiCopy;
  open: boolean;
  activeProvider?: ProviderId;
  entries: readonly LlmProviderEntry[];
  onClose: () => void;
  onSave: (provider: ProviderId, apiKey: string, model: string) => Promise<void>;
  onClear: (provider: ProviderId) => Promise<void>;
  onActivate: (provider: ProviderId) => Promise<void>;
}

interface Feedback {
  tone: "info" | "error";
  message: string;
}

export function LlmSettingsPanel({
  copy,
  open,
  activeProvider,
  entries,
  onClose,
  onSave,
  onClear,
  onActivate,
}: LlmSettingsPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const providerRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(
    activeProvider ?? DOMESTIC_PROVIDERS[0],
  );
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const [providerOpen, setProviderOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);

  const { render, closing } = useClosing(open, 300);

  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      const newProvider = activeProvider ?? DOMESTIC_PROVIDERS[0];
      setSelectedProvider(newProvider);
      const entry = entries.find((item) => item.provider === newProvider);
      const meta = getProviderMeta(newProvider);
      setApiKeyInput(entry?.apiKey ?? "");
      setModelInput(entry?.model ?? meta.defaultModel);
      setFeedback(undefined);
      setShowKey(false);
      setProviderOpen(false);
      setModelOpen(false);
    }
  }

  const [prevSyncKey, setPrevSyncKey] = useState<{ provider: ProviderId; entries: readonly LlmProviderEntry[] }>(
    { provider: selectedProvider, entries },
  );
  if (selectedProvider !== prevSyncKey.provider || entries !== prevSyncKey.entries) {
    setPrevSyncKey({ provider: selectedProvider, entries });
    const entry = entries.find((item) => item.provider === selectedProvider);
    const meta = getProviderMeta(selectedProvider);
    setApiKeyInput(entry?.apiKey ?? "");
    setModelInput(entry?.model ?? meta.defaultModel);
    setFeedback(undefined);
  }

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (providerRef.current && !providerRef.current.contains(target)) {
        setProviderOpen(false);
      }
      if (modelRef.current && !modelRef.current.contains(target)) {
        setModelOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, []);

  if (!render) return null;

  const meta = PROVIDER_METADATA[selectedProvider];
  const existingEntry = entries.find((item) => item.provider === selectedProvider);
  const hasExisting = existingEntry !== undefined && existingEntry.apiKey.length > 0;
  const isKeyValid = isValidApiKey(apiKeyInput);

  const runAction = async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      await action();
      setFeedback({ tone: "info", message: successMessage });
    } catch {
      setFeedback({ tone: "error", message: copy.genericFailure });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () =>
    runAction(
      () => onSave(selectedProvider, apiKeyInput, modelInput),
      copy.llmSaved,
    );

  const handleClear = () =>
    runAction(async () => {
      await onClear(selectedProvider);
      setApiKeyInput("");
      setModelInput(meta.defaultModel);
    }, copy.llmCleared);

  const handleActivate = () => runAction(() => onActivate(selectedProvider), copy.llmSaved);

  return (
    <div className={`overlay overlay--history ${closing ? "overlay--closing" : ""}`}>
      <section aria-label={copy.llmSettings} aria-modal="true" className={`llm-panel ${closing ? "llm-panel--closing" : ""}`} role="dialog">
        <header>
          <h1>{copy.llmSettings}</h1>
          <button ref={closeRef} aria-label={copy.closeMenu} onClick={onClose} type="button">
            <X aria-hidden="true" size={22} />
          </button>
        </header>

        <p className="llm-panel__active" aria-live="polite">
          {activeProvider !== undefined
            ? `${copy.llmActive}: ${PROVIDER_METADATA[activeProvider].label}`
            : copy.llmUsingDefault}
        </p>

        <div className="llm-panel__field" ref={providerRef}>
          <label htmlFor="llm-provider">{copy.llmProvider}</label>
          <div className="custom-select">
            <button
              type="button"
              className={`custom-select__trigger ${providerOpen ? "custom-select__trigger--open" : ""}`}
              onClick={() => {
                setProviderOpen((prev) => !prev);
                setModelOpen(false);
              }}
              aria-expanded={providerOpen}
              aria-haspopup="listbox"
            >
              <span className="custom-select__value">{PROVIDER_METADATA[selectedProvider].label}</span>
              <ChevronDown
                aria-hidden="true"
                className={`custom-select__chevron ${providerOpen ? "custom-select__chevron--open" : ""}`}
                size={18}
              />
            </button>
            {providerOpen && (
              <div className="custom-select__menu" role="listbox">
                <div className="custom-select__group-label">{copy.llmDomestic}</div>
                {DOMESTIC_PROVIDERS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="option"
                    aria-selected={selectedProvider === id}
                    className={`custom-select__option ${selectedProvider === id ? "custom-select__option--selected" : ""}`}
                    onClick={() => {
                      setSelectedProvider(id);
                      setProviderOpen(false);
                    }}
                  >
                    <span>{PROVIDER_METADATA[id].label}</span>
                    {selectedProvider === id && <Check aria-hidden="true" size={16} />}
                  </button>
                ))}
                <div className="custom-select__group-label">{copy.llmInternational}</div>
                {INTERNATIONAL_PROVIDERS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="option"
                    aria-selected={selectedProvider === id}
                    className={`custom-select__option ${selectedProvider === id ? "custom-select__option--selected" : ""}`}
                    onClick={() => {
                      setSelectedProvider(id);
                      setProviderOpen(false);
                    }}
                  >
                    <span>{PROVIDER_METADATA[id].label}</span>
                    {selectedProvider === id && <Check aria-hidden="true" size={16} />}
                  </button>
                ))}
              </div>
            )}
            <select
              id="llm-provider"
              className="visually-hidden"
              onChange={(event) => setSelectedProvider(event.currentTarget.value as ProviderId)}
              value={selectedProvider}
            >
              <optgroup label={copy.llmDomestic}>
                {DOMESTIC_PROVIDERS.map((id) => (
                  <option key={id} value={id}>
                    {PROVIDER_METADATA[id].label}
                  </option>
                ))}
              </optgroup>
              <optgroup label={copy.llmInternational}>
                {INTERNATIONAL_PROVIDERS.map((id) => (
                  <option key={id} value={id}>
                    {PROVIDER_METADATA[id].label}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>

        <div className="llm-panel__field">
          <label htmlFor="llm-key">{copy.llmApiKey}</label>
          <div className="llm-panel__key">
            <input
              id="llm-key"
              autoComplete="off"
              onChange={(event) => setApiKeyInput(event.currentTarget.value)}
              placeholder={copy.llmApiKey}
              type={showKey ? "text" : "password"}
              value={apiKeyInput}
            />
            <button
              aria-label={showKey ? copy.llmHideKey : copy.llmShowKey}
              onClick={() => setShowKey((prev) => !prev)}
              type="button"
            >
              {showKey ? (
                <EyeOff aria-hidden="true" size={18} />
              ) : (
                <Eye aria-hidden="true" size={18} />
              )}
            </button>
          </div>
          <p className="llm-panel__hint">{copy.llmApiKeyHint(meta.apiKeyHint)}</p>
        </div>

        <div className="llm-panel__field" ref={modelRef}>
          <label htmlFor="llm-model">{copy.llmModel}</label>
          <div className="custom-select">
            <button
              type="button"
              className={`custom-select__trigger ${modelOpen ? "custom-select__trigger--open" : ""}`}
              onClick={() => {
                setModelOpen((prev) => !prev);
                setProviderOpen(false);
              }}
              aria-expanded={modelOpen}
              aria-haspopup="listbox"
            >
              <span className="custom-select__value">{modelInput}</span>
              <ChevronDown
                aria-hidden="true"
                className={`custom-select__chevron ${modelOpen ? "custom-select__chevron--open" : ""}`}
                size={18}
              />
            </button>
            {modelOpen && (
              <div className="custom-select__menu" role="listbox">
                {meta.models.map((model) => {
                  const supportsImg = meta.imageModels.includes(model);
                  return (
                    <button
                      key={model}
                      type="button"
                      role="option"
                      aria-selected={modelInput === model}
                      className={`custom-select__option ${modelInput === model ? "custom-select__option--selected" : ""}`}
                      onClick={() => {
                        setModelInput(model);
                        setModelOpen(false);
                      }}
                    >
                      <div className="custom-select__option-text">
                        <span>{model}</span>
                        {supportsImg && <span className="custom-select__tag">识图</span>}
                      </div>
                      {modelInput === model && <Check aria-hidden="true" size={16} />}
                    </button>
                  );
                })}
              </div>
            )}
            <select
              id="llm-model"
              className="visually-hidden"
              onChange={(event) => setModelInput(event.currentTarget.value)}
              value={modelInput}
            >
              {meta.models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>
          {!meta.imageModels.includes(modelInput) && (
            <p className="llm-panel__note">{copy.llmNoImageSupport}</p>
          )}
        </div>

        {feedback && (
          <p
            aria-live="polite"
            className={
              feedback.tone === "error"
                ? "llm-panel__feedback llm-panel__feedback--error"
                : "llm-panel__feedback"
            }
          >
            {feedback.message}
          </p>
        )}

        <div className="llm-panel__actions">
          <button disabled={busy || !isKeyValid} onClick={handleSave} type="button">
            {copy.llmSave}
          </button>
          {hasExisting && activeProvider !== selectedProvider && (
            <button disabled={busy} onClick={handleActivate} type="button">
              {copy.llmActivate}
            </button>
          )}
          {hasExisting && (
            <button className="danger-action" disabled={busy} onClick={handleClear} type="button">
              {copy.llmClear}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
