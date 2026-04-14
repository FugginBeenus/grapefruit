import { useToastStore, type ToastType } from "../stores/toastStore";

const ICON_COLOR: Record<ToastType, string> = {
  success: "text-ok",
  error: "text-err",
  info: "text-info",
  warning: "text-warn",
};

const BORDER_COLOR: Record<ToastType, string> = {
  success: "border-l-ok",
  error: "border-l-err",
  info: "border-l-info",
  warning: "border-l-warn",
};

function ToastIcon({ type }: { type: ToastType }) {
  const cls = `w-4 h-4 shrink-0 ${ICON_COLOR[type]}`;

  switch (type) {
    case "success":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      );
    case "error":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    case "info":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "warning":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      );
  }
}

export function Toast() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-[72px] right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-center gap-3 max-w-[360px] bg-bg-surface border border-b-light ${BORDER_COLOR[toast.type]} border-l-[3px] rounded-xl px-3 py-2.5 shadow-lg shadow-black/30`}
          style={{
            animation: toast.exiting
              ? "toastOut 200ms ease-in forwards"
              : "toastIn 200ms ease-out",
          }}
        >
          <ToastIcon type={toast.type} />
          <span className="flex-1 text-[13px] text-t leading-snug">{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            className="shrink-0 text-t-muted hover:text-t transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
