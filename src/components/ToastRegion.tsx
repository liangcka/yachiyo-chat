export interface ToastRegionProps {
  announcementId?: number;
  message?: string;
  tone?: "info" | "error";
}

export function ToastRegion({ announcementId, message, tone = "info" }: ToastRegionProps) {
  const toast =
    message === undefined ? null : (
      <div className={`toast toast--${tone}`} key={announcementId}>
        {message}
      </div>
    );

  return (
    <div className="toast-region">
      <div aria-atomic="true" className="toast-region__live" role="status">
        {tone === "info" ? toast : null}
      </div>
      <div aria-atomic="true" className="toast-region__live" role="alert">
        {tone === "error" ? toast : null}
      </div>
    </div>
  );
}
