import { Eye, EyeOff, KeyRound, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { UiCopy } from "../i18n/messages";
import { cycleApiOrigin, recoverConnection } from "../services/api-origins";
import { SessionClientError, type SessionClientErrorCode } from "../services/session-client";

export interface AccessGateProps {
  copy: UiCopy;
  onAuthenticate: (accessCode: string) => Promise<void>;
}

function errorMessage(code: SessionClientErrorCode, copy: UiCopy): string {
  if (code === "ACCESS_DENIED") return copy.accessDenied;
  if (code === "AUTH_RATE_LIMITED") return copy.accessRateLimited;
  if (code === "NETWORK_ERROR") return copy.accessNetworkError;
  return copy.genericFailure;
}

export function AccessGate({ copy, onAuthenticate }: AccessGateProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [accessCode, setAccessCode] = useState("");
  const [errorCode, setErrorCode] = useState<SessionClientErrorCode>();
  const [showCode, setShowCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    if (errorCode !== undefined) inputRef.current?.focus();
  }, [errorCode]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = accessCode.trim();
    if (submitting || normalized.length < 16) return;
    setSubmitting(true);
    setErrorCode(undefined);
    try {
      await onAuthenticate(normalized);
    } catch (error) {
      setAccessCode("");
      setErrorCode(error instanceof SessionClientError ? error.code : "NETWORK_ERROR");
    } finally {
      setSubmitting(false);
    }
  };

  // 换线重试：切到下一条 API 线路，清掉 SW/缓存脏状态后刷新页面重走启动流程
  const handleSwitchLine = () => {
    if (switching) return;
    setSwitching(true);
    cycleApiOrigin();
    void recoverConnection();
  };

  return (
    <section aria-labelledby="access-gate-title" className="access-gate">
      <div className="access-gate__mark" aria-hidden="true">
        <Sparkles size={27} />
      </div>
      <h1 id="access-gate-title">{copy.appName}</h1>
      <p className="access-gate__hint">{copy.accessCodeHint}</p>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <label htmlFor="access-code">{copy.accessCodeLabel}</label>
        <div className="access-gate__field">
          <KeyRound aria-hidden="true" size={19} />
          <input
            ref={inputRef}
            id="access-code"
            autoComplete="off"
            disabled={submitting}
            maxLength={128}
            onChange={(event) => setAccessCode(event.currentTarget.value)}
            spellCheck="false"
            type={showCode ? "text" : "password"}
            value={accessCode}
          />
          <button
            aria-label={showCode ? copy.llmHideKey : copy.llmShowKey}
            className="access-gate__toggle"
            onClick={() => setShowCode((prev) => !prev)}
            tabIndex={-1}
            type="button"
          >
            {showCode ? (
              <EyeOff aria-hidden="true" size={18} />
            ) : (
              <Eye aria-hidden="true" size={18} />
            )}
          </button>
        </div>
        <button disabled={submitting || accessCode.trim().length < 16} type="submit">
          {submitting ? copy.verifying : copy.enter}
        </button>
      </form>
      <p aria-live="assertive" className="access-gate__error">
        {errorCode === undefined ? "" : errorMessage(errorCode, copy)}
      </p>
      {errorCode === "NETWORK_ERROR" ? (
        <button
          className="access-gate__switch-line"
          disabled={switching}
          onClick={handleSwitchLine}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} />
          {copy.switchLineRetry}
        </button>
      ) : null}
    </section>
  );
}
