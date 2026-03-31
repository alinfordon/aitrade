import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** YYYY-MM-DD in UTC */
export function utcDateKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
