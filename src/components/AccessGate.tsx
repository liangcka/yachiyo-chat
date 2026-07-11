import { KeyRound, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { UiCopy } from "../i18n/messages";
import { SessionClientError, type SessionClientErrorCode } from "../services/session-client";

export interface AccessGateProps {
  copy: UiCopy;
  onAuthenticate: (accessCode: string) => Promise<void>;
}

function errorMessage(code: SessionClientErrorCode, copy: UiCopy): string {
  if (code === "ACCESS_DENIED") return copy.accessDenied;
  if (code === "AUTH_RATE_LIMITED") return copy.accessRateLimited;
  return copy.genericFailure;
}

export function AccessGate({ copy, onAuthenticate }: AccessGateProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [accessCode, setAccessCode] = useState("");
  const [errorCode, setErrorCode] = useState<SessionClientErrorCode>();
  const [submitting, setSubmitting] = useState(false);

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
            type="password"
            value={accessCode}
          />
        </div>
        <button disabled={submitting || accessCode.trim().length < 16} type="submit">
          {submitting ? copy.verifying : copy.enter}
        </button>
      </form>
      <p aria-live="assertive" className="access-gate__error">
        {errorCode === undefined ? "" : errorMessage(errorCode, copy)}
      </p>
    </section>
  );
}
