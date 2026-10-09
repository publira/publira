import type { FormActionState } from "@publira/ui-components/action-form";
import { useRouter } from "next/navigation";

import type { EpisodePagesUploadResponse } from "#lib/episode-pages-upload";

const readUploadResponse = async (
  response: Response
): Promise<EpisodePagesUploadResponse | null> => {
  try {
    return (await response.json()) as EpisodePagesUploadResponse;
  } catch {
    return null;
  }
};

/**
 * Settles once the browser is online: at once when it already says so, or on
 * its `online` event.
 *
 * An upload started offline waits here instead of failing, as
 * `experimental.useOffline` holds a Server Action — which a `fetch` of our own
 * is outside of. Only the wait before sending is ours to take: neither adding
 * nor replacing pages is idempotent, and a `fetch` that rejects after it was
 * sent may have reached the server all the same, so a send is never repeated.
 */
const untilOnline = (): Promise<"online"> => {
  const { promise, resolve } = Promise.withResolvers<"online">();
  if (navigator.onLine) {
    resolve("online");
  } else {
    window.addEventListener("online", () => resolve("online"), {
      once: true,
    });
  }
  return promise;
};

const submittedBytes = (formData: FormData) =>
  [...formData.values()].reduce(
    (total, value) => total + (value instanceof File ? value.size : 0),
    0
  );

interface PageUploadOptions {
  /** What a send that failed without an answer from the route says. */
  failed: string;
  /**
   * What a send cut off on the way says: the pages may have changed before the
   * connection went, so it asks the operator to check them first.
   */
  interrupted: string;
  /** The most the files in the form may add up to. */
  maxBytes: number;
  /** The route the form is posted to, from `lib/episode-pages-upload.ts`. */
  path: string;
  /** What files over `maxBytes`, or a body a proxy refused, say. */
  tooLarge: string;
}

/**
 * The Action of a form that posts page images to one of the upload routes
 * rather than to a Server Action, whose body is capped well below them
 * (`lib/episode-pages-upload.ts`). It refreshes the screen once the pages are
 * in, and goes to the login page the route names when the session was
 * rejected.
 */
export const usePageUploadAction = ({
  failed,
  interrupted,
  maxBytes,
  path,
  tooLarge,
}: PageUploadOptions) => {
  const router = useRouter();

  return async (
    _prevState: FormActionState,
    formData: FormData
  ): Promise<FormActionState> => {
    // Refused here so a submission the route would refuse is not sent first.
    if (submittedBytes(formData) > maxBytes) {
      return { message: tooLarge, ok: false };
    }

    await untilOnline();
    let response: Response;
    try {
      response = await fetch(path, { body: formData, method: "POST" });
    } catch {
      // The pages may have changed before the connection went, so the list is
      // read again for the operator to check before sending them twice.
      router.refresh();
      return { message: interrupted, ok: false };
    }

    // A proxy in front with a lower limit than the route answers this itself,
    // in a body of its own.
    if (response.status === 413) {
      return { message: tooLarge, ok: false };
    }
    const result = await readUploadResponse(response);
    if (!result) {
      return { message: failed, ok: false };
    }
    if (result.location) {
      router.push(result.location);
    } else if (result.ok) {
      router.refresh();
    }

    return { message: result.message, ok: result.ok };
  };
};
