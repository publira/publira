"use client";

import { useEffect } from "react";

/**
 * Take a tip's return off the address bar once its notice is on screen. The
 * query is all the server's and the provider's, `tip` and the `session_id` the
 * provider adds, so the episode's own path is what is left.
 */
export const TipReturnCleaner = () => {
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  return null;
};
