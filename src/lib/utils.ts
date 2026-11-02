import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Short date and time; the year appears only when it differs from the current year. */
export function timeLabel(ms: number) {
  if (!ms) return "";
  const date = new Date(ms);
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
    hour: "2-digit", minute: "2-digit",
  }).format(date);
}

/** "1 file" / "2 files": the count followed by the singular or plural noun. */
export function plural(n: number, noun: string, many = `${noun}s`) {
  return `${n} ${n === 1 ? noun : many}`;
}
