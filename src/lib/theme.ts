import { invoke } from "@/lib/tauri";

/** Sycamore's time-of-day themes, lightest to darkest. */
export const themes = ["dawn", "morning", "dusk", "night"] as const;
export type ThemeName = typeof themes[number];
export type ThemePreference = ThemeName | "system";

export const isDarkTheme = (theme: ThemeName) => theme === "dusk" || theme === "night";

export function resolveTheme(value: string | null | undefined): ThemeName {
  if (value === "light") return "morning";
  if (value === "dark") return "night";
  if (themes.includes(value as ThemeName)) return value as ThemeName;
  // Light until the user picks otherwise; only an explicit "system" follows the OS.
  if (value !== "system") return "morning";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "morning";
}

export function applyTheme(value: string | null | undefined) {
  document.documentElement.dataset.theme = resolveTheme(value);
}

export async function saveTheme(value: ThemePreference) {
  applyTheme(value);
  window.dispatchEvent(new CustomEvent("ronda:theme", { detail: value }));
  await invoke("set_pref", { key: "theme", value });
}
