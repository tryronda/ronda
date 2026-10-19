/** Single source for the shortcut list shown in the app's help dialog and in the docs. */
export const shortcuts: [string, string][] = [
  ["⌘1 / ⌘2 / ⌘3 / ⌘4", "Sessions, Insights, Intelligence, Settings"],
  ["⌘K", "Search the library"],
  ["⌘F", "Find in the active transcript"],
  ["Enter / Shift+Enter", "Next / previous match in transcript find"],
  ["[ / ]", "Jump to the previous / next prompt while the transcript is focused"],
  ["⌘B", "Toggle the library sidebar"],
  ["Alt ← / Alt →", "Back and forward through views"],
  ["↑ / ↓", "Move through the session list"],
  ["⌘-click / Ctrl-click, Space", "Add or remove the clicked or focused session from the selection"],
  ["Shift-click, Shift+↑ / Shift+↓", "Select a range of loaded sessions"],
  ["?", "Show this list of keyboard shortcuts"],
  ["Esc", "Clear a session selection, close transcript find, or clear and leave library search"],
];
