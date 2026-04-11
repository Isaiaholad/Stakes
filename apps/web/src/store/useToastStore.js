import { create } from 'zustand';

export const useToastStore = create((set) => ({
  toast: null,
  showToast: ({ title, message = '', variant = 'info', duration = 4500 }) =>
    set({
      toast: {
        id: Date.now(),
        title,
        message,
        variant,
        duration
      }
    }),
  hideToast: () => set({ toast: null })
}));
