import { useRef, useState } from "react";
import type { UserMemoryRevision } from "../domain/user-memory";
import type { UiCopy } from "../i18n/messages";

export interface UserMemoryEditorProps {
  copy: UiCopy;
  memory: string;
  onSave: (memory: string) => Promise<boolean>;
  history?: readonly UserMemoryRevision[];
  onUndo?: (revisionId: string) => Promise<boolean>;
}

/** 两个记忆入口共享草稿保护与保存行为。 */
export function UserMemoryEditor({ copy, history = [], memory, onSave, onUndo }: UserMemoryEditorProps) {
  const [editor, setEditor] = useState({ draft: memory, baseline: memory, observed: memory });
  const [saving, setSaving] = useState(false);
  const [undoFailed, setUndoFailed] = useState(false);
  const savingRef = useRef(false);
  if (memory !== editor.observed) {
    setEditor(editor.draft === editor.baseline
      ? { draft: memory, baseline: memory, observed: memory }
      : { ...editor, observed: memory });
  }

  const save = async (value: string): Promise<void> => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setUndoFailed(false);
    try {
      if (await onSave(value)) {
        const normalized = value.trim();
        setEditor((current) => ({ ...current, draft: normalized, baseline: normalized }));
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const undo = async (revisionId: string): Promise<void> => {
    if (savingRef.current || onUndo === undefined) return;
    savingRef.current = true;
    setSaving(true);
    setUndoFailed(false);
    try {
      setUndoFailed(!(await onUndo(revisionId)));
    } catch {
      setUndoFailed(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const sourceLabels: Record<UserMemoryRevision["source"], string> = {
    automatic: copy.userMemorySourceAutomatic,
    manual: copy.userMemorySourceManual,
    message: copy.userMemorySourceMessage,
    undo: copy.userMemorySourceUndo,
  };

  return (
    <>
      <p className="skills-panel__hint">{copy.userMemoryDescription}</p>
      <textarea
        aria-label={copy.userMemoryTitle}
        className="memory-panel__editor"
        disabled={saving}
        onChange={(event) => setEditor({ ...editor, draft: event.target.value })}
        placeholder={copy.userMemoryPlaceholder}
        rows={8}
        value={editor.draft}
      />
      {[...editor.draft].length > 2000 && (
        <p className="skills-panel__hint">{copy.userMemoryLimitHint}</p>
      )}
      <div className="llm-panel__actions" aria-busy={saving}>
        <button disabled={saving} onClick={() => { void save(editor.draft); }} type="button">
          {copy.userMemorySave}
        </button>
        <button
          className="danger-action"
          disabled={saving || editor.draft.trim().length === 0}
          onClick={() => { void save(""); }}
          type="button"
        >
          {copy.userMemoryClear}
        </button>
      </div>
      <section aria-label={copy.userMemoryHistoryTitle} className="memory-history" aria-busy={saving}>
        <h2>{copy.userMemoryHistoryTitle}</h2>
        {undoFailed && <p className="memory-history__error" role="alert">{copy.userMemoryUndoFailed}</p>}
        {history.length === 0 ? (
          <p className="skills-panel__hint">{copy.userMemoryHistoryEmpty}</p>
        ) : (
          <ol className="memory-history__list">
            {history.map((revision, index) => (
              <li className="memory-history__item" key={revision.id}>
                <details>
                  <summary tabIndex={0}>
                    <span>{sourceLabels[revision.source]}</span>
                    <time dateTime={new Date(revision.createdAt).toISOString()}>
                      {new Date(revision.createdAt).toLocaleString()}
                    </time>
                  </summary>
                  <dl className="memory-history__changes">
                    <dt>{copy.userMemoryBefore}</dt>
                    <dd>{revision.before || copy.userMemoryEmpty}</dd>
                    <dt>{copy.userMemoryAfter}</dt>
                    <dd>{revision.after || copy.userMemoryEmpty}</dd>
                  </dl>
                </details>
                {index === 0 && onUndo !== undefined && (
                  <button className="memory-history__undo" disabled={saving} onClick={() => { void undo(revision.id); }} type="button">
                    {copy.userMemoryUndo}
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
