import { create } from "zustand";

/** Client-side session mirror (source of truth remains HttpOnly cookie + /api/auth/me). */
export const useSessionStore = create((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clear: () => set({ user: null }),
}));
