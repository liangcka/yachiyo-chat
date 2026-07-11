export interface ToastRegionProps {
  message?: string;
  tone?: "info" | "error";
}

export function ToastRegion({ message, tone = "info" }: ToastRegionProps) {
  return (
    <div aria-atomic="true" aria-live={tone === "error" ? "assertive" : "polite"} className="toast-region">
      {message === undefined ? null : (
        <div className={`toast toast--${tone}`} role={tone === "error" ? "alert" : "status"}>
          {message}
        </div>
      )}
    </div>
  );
}
