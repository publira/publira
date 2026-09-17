const STORAGE_KEY = "publira.wide-viewer";

const listeners = new Set<() => void>();

/** The last choice made on this page, for when storage refuses to hold it. */
let choiceOnThisPage: boolean | null = null;

/**
 * The wide viewer choice this tab has made, or `null` when it has made
 * none — which is when the value the server read stands.
 *
 * Storage that throws (a private window, blocked site data) falls back to the
 * choice made on this page, so the control still works until the page closes.
 */
export const readWideViewerChoice = (): boolean | null => {
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    return value === null ? null : value === "true";
  } catch {
    return choiceOnThisPage;
  }
};

/** Record the choice in this tab and tell every subscriber at once. */
export const storeWideViewerChoice = (enabled: boolean): void => {
  choiceOnThisPage = enabled;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // `choiceOnThisPage` still carries it.
  }
  for (const listener of listeners) {
    listener();
  }
};

export const subscribeToWideViewerChoice = (
  listener: () => void
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
