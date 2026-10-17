import type { RenewPageUrl } from "./viewer-fetch";

/**
 * A {@link RenewPageUrl} that answers each refused page from one read of all
 * the pages' URLs, by image id, shared by every page refused while that read
 * is in flight: the pages of a rail whose media tokens expired together ask
 * together. A read that fails, or answers no URL for a page, leaves that page
 * refused, with its reload control, and the next refusal reads again.
 *
 * It lives apart from `viewer-fetch.ts` and takes nothing from it but a type:
 * Server Components import this package's entry for `toViewerPages`, and the
 * fetch plugin loads `@publira/comic-viewer`, whose runtime cannot be
 * evaluated in the server graph.
 */
export const renewFromPageUrls = (
  readPageUrls: () => Promise<Record<string, string>>
): RenewPageUrl => {
  let pending: Promise<Record<string, string>> | undefined;

  const readOnce = async (): Promise<Record<string, string>> => {
    try {
      return await readPageUrls();
    } catch {
      return {};
    } finally {
      pending = undefined;
    }
  };

  return async (page) => {
    if (pending === undefined) {
      pending = readOnce();
    }
    const urls = await pending;

    return urls[page.id];
  };
};
