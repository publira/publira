import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { prerender } from "react-dom/static";

/**
 * Renders a Server Component tree to HTML the way the server does, async
 * components included, and mounts that HTML for Testing Library to query.
 * The markup is not hydrated, so it answers what the screen shows, not how it
 * responds to input.
 *
 * Aborting `signal` stops waiting for whatever is still suspended, which then
 * shows its fallback.
 */
export const renderServerComponent = async (
  ui: ReactNode,
  { signal }: { signal?: AbortSignal } = {}
) => {
  // An error inside a boundary only reaches `onError`; this fails the render.
  const { promise: failed, reject } = Promise.withResolvers<never>();
  const { prelude } = await Promise.race([
    prerender(ui, {
      onError: (error) => {
        if (error !== signal?.reason) {
          reject(error);
        }
      },
      // Keeps every resolved boundary inline: an outlined one is only swapped
      // in by React's inline script, which markup mounted as HTML never runs.
      progressiveChunkSize: Number.POSITIVE_INFINITY,
      signal,
    }),
    failed,
  ]);
  const html = await new Response(prelude).text();

  return render(
    // oxlint-disable-next-line react/no-danger -- React's own server render of the tree under test
    <div dangerouslySetInnerHTML={{ __html: html }} />
  );
};
