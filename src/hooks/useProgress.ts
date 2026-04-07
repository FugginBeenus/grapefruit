import { useEffect, useCallback, useState } from "react";
import { listen } from "@tauri-apps/api/event";

interface ProgressPayload {
  op: string;
  current: number;
  total: number;
  message?: string;
}

/**
 * Subscribe to sidecar progress events for a specific operation.
 * Returns { current, total, message, percent }.
 */
export function useProgress(operation: string) {
  const [progress, setProgress] = useState({
    current: 0,
    total: 0,
    message: "",
    percent: 0,
  });

  useEffect(() => {
    const unlisten = listen<ProgressPayload>("sidecar:progress", (event) => {
      const p = event.payload;
      if (p.op === operation) {
        setProgress({
          current: p.current,
          total: p.total,
          message: p.message || "",
          percent: p.total > 0 ? Math.round((p.current / p.total) * 100) : 0,
        });
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [operation]);

  const reset = useCallback(() => {
    setProgress({ current: 0, total: 0, message: "", percent: 0 });
  }, []);

  return { ...progress, reset };
}
