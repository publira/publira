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
export const untilOnline = (): Promise<"online"> => {
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
