import { create } from "zustand";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  exiting?: boolean;
}

interface ToastState {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (type, message, duration?) => {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const toast: Toast = { id, type, message };
    set((s) => ({ toasts: [...s.toasts, toast] }));

    const timeout = duration ?? (type === "error" || type === "warning" ? 5000 : 3000);

    setTimeout(() => {
      // Mark exiting for animation
      set((s) => ({
        toasts: s.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
      }));
      // Remove after exit animation
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, 200);
    }, timeout);
  },

  removeToast: (id) => {
    set((s) => ({
      toasts: s.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
    }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 200);
  },
}));
