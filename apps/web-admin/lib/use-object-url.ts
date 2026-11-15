"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * An object URL for the file last shown, empty while none is. Showing another
 * file revokes the URL before it, and so do `clear` and unmounting: an object
 * URL keeps its file alive until it is revoked.
 */
export const useObjectUrl = () => {
  const [url, setUrl] = useState("");
  const shown = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (shown.current) {
        URL.revokeObjectURL(shown.current);
      }
    },
    []
  );

  const show = useCallback((file: Blob) => {
    const next = URL.createObjectURL(file);

    if (shown.current) {
      URL.revokeObjectURL(shown.current);
    }

    shown.current = next;
    setUrl(next);
  }, []);

  const clear = useCallback(() => {
    if (shown.current) {
      URL.revokeObjectURL(shown.current);
      shown.current = null;
    }

    setUrl("");
  }, []);

  return { clear, show, url };
};
