import type { ReactNode } from "react";

/**
 * Frame for whatever the body area shows in place of pages: the access gate, a
 * read failure, or an episode whose images are not published yet. The reader
 * runs full-bleed, so these keep the measure the rest of the site reads at.
 */
export const EpisodeBodyNotice = ({ children }: { children: ReactNode }) => (
  <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
    {children}
  </div>
);
