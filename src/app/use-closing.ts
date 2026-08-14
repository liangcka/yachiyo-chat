import { useEffect, useState } from "react";

export function useClosing(open: boolean, durationMs: number = 300) {
  const [isRendered, setIsRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setIsRendered(true);
      setClosing(false);
    } else if (isRendered) {
      setClosing(true);
    }
  }

  useEffect(() => {
    if (closing) {
      const timer = setTimeout(() => {
        setIsRendered(false);
        setClosing(false);
      }, durationMs);
      return () => clearTimeout(timer);
    }
  }, [closing, durationMs]);

  return { render: isRendered, closing };
}
