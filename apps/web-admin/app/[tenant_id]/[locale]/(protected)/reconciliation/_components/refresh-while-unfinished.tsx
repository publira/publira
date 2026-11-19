"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * How often the screen asks again while a run is unfinished. The worker takes
 * a run up within seconds, and reading a long period takes longer, so a few
 * seconds shows the change soon without asking the API every moment.
 */
const REFRESH_INTERVAL_MS = 5000;

/**
 * Re-renders the route on an interval for as long as it is mounted, which the
 * page does only while a run on the list is still pending or running. The
 * worker finishes a run with nothing this console can hear, and the reads
 * behind the screen are uncached, so a refresh is what shows it finished.
 */
export const RefreshWhileUnfinished = () => {
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
