"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * How often a build in progress is asked about again. The worker looks for a
 * build to run every 30 seconds, and a small catalog is indexed in a few, so
 * a third of that pass shows the switch soon after it happens.
 */
const REFRESH_INTERVAL_MS = 10_000;

/**
 * Re-renders the page while the worker builds the index a save named. The
 * build completes in the worker, not in anything this console submits, so no
 * Action is there to revalidate the screen when the search moves over.
 */
export const SearchBuildRefresh = () => {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
    }, REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [router]);

  return null;
};
