"use client";

import { useCallback, useSyncExternalStore } from "react";

/** `localStorage` or `sessionStorage`. */
export type WebStorageArea = "local" | "session";

const entryId = (area: WebStorageArea, key: string): string => `${area}:${key}`;

const listeners = new Map<string, Set<() => void>>();

/** Values written while the browser refused storage, so this page still sees them. */
const refusedWrites = new Map<string, string>();

const storageFor = (area: WebStorageArea): Storage =>
  area === "local" ? window.localStorage : window.sessionStorage;

const notify = (id: string): void => {
  for (const listener of listeners.get(id) ?? []) {
    listener();
  }
};

/**
 * The raw value stored under `key`, or `null` when there is none.
 *
 * Storage that throws (a private window, blocked site data) answers with what
 * this page wrote while it was refused, so a control keeps working until the
 * page closes.
 */
export const readWebStorage = (
  area: WebStorageArea,
  key: string
): string | null => {
  try {
    return storageFor(area).getItem(key);
  } catch {
    return refusedWrites.get(entryId(area, key)) ?? null;
  }
};

/** Store `value` under `key` and tell this tab's subscribers at once. */
export const writeWebStorage = (
  area: WebStorageArea,
  key: string,
  value: string
): void => {
  const id = entryId(area, key);
  try {
    storageFor(area).setItem(key, value);
    refusedWrites.delete(id);
  } catch {
    refusedWrites.set(id, value);
  }
  notify(id);
};

/**
 * Subscribe to `key`. A write from this tab is reported by
 * {@link writeWebStorage}; one from another tab arrives as a `storage` event.
 */
export const subscribeToWebStorage = (
  area: WebStorageArea,
  key: string,
  listener: () => void
): (() => void) => {
  const id = entryId(area, key);
  const entry = listeners.get(id) ?? new Set<() => void>();
  entry.add(listener);
  listeners.set(id, entry);

  const onStorage = (event: StorageEvent) => {
    if (event.key === key && event.storageArea === storageFor(area)) {
      listener();
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener("storage", onStorage);
    entry.delete(listener);
    if (entry.size === 0) {
      listeners.delete(id);
    }
  };
};

const nothingOnServer = () => null;

/**
 * The raw value stored under `key`, kept in step with every write. The server
 * render and hydration see `null`, so what the browser holds is applied right
 * after hydration rather than in the HTML.
 */
export const useWebStorage = (
  area: WebStorageArea,
  key: string
): string | null => {
  const subscribe = useCallback(
    (listener: () => void) => subscribeToWebStorage(area, key, listener),
    [area, key]
  );
  const read = useCallback(() => readWebStorage(area, key), [area, key]);

  return useSyncExternalStore(subscribe, read, nothingOnServer);
};
