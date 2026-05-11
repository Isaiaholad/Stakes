import { create } from 'zustand';

export const useToastStore = create((set) => ({
  toast: null,
  showToast: ({ title, message = '', variant = 'info', duration = 4500, actionHref = '', actionLabel = '' }) =>
    set({
      toast: {
        id: Date.now(),
        title,
        message,
        variant,
        duration,
        actionHref,
        actionLabel
      }
    }),
  hideToast: () => set({ toast: null })
}));
