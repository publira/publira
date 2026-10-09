/**
 * Where the episode edit screen sends the pages it adds.
 *
 * It is a Route Handler rather than a Server Action, and `proxy.ts` leaves it
 * out of its matcher, because both of those buffer a request body before any
 * code of ours can look at who sent it: a Server Action body is capped by
 * `serverActions.bodySizeLimit`, and Next.js copies every body that passes
 * through the proxy up to `proxyClientMaxBodySize`, silently truncating the
 * rest. Raising either would let anyone who can reach the console make it hold
 * that much per request; the handler instead checks the session and the
 * declared length first, and only then reads the body.
 */
export const EPISODE_PAGES_UPLOAD_PATH = "/api/v1/episode-pages";

/**
 * The largest request body the upload takes, files and multipart framing
 * together. The screen's help text and the refusal state it as 256MB.
 *
 * The console and publira server each hold a submission whole, several times
 * over — the parsed form, the RPC message, and every page a ZIP or ePub
 * unpacks to — so this is what bounds the memory one upload can take. It fits
 * an episode of a hundred pages at 2MB each with room to spare.
 */
export const EPISODE_PAGES_UPLOAD_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Where the episode edit screen sends the image that replaces one page. It
 * sits under {@link EPISODE_PAGES_UPLOAD_PATH}, which `proxy.ts` leaves out
 * with everything below it, for the same reason: one page may be twice what a
 * Server Action body is allowed to carry.
 */
export const EPISODE_PAGE_REPLACE_PATH = `${EPISODE_PAGES_UPLOAD_PATH}/replace`;

/**
 * The largest image one page may be, which publira server holds every upload
 * to (`imageproc.MaxUploadBytes`). The replacement refuses a larger one before
 * it is sent, and the screen's help text states it as 20MB.
 */
export const EPISODE_PAGE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * The image formats a page may be in: what publira server decodes, and refuses
 * any other image for.
 */
export const EPISODE_PAGE_IMAGE_ACCEPT =
  "image/jpeg,image/png,image/gif,image/webp";

/**
 * The largest request body the replacement takes: one image, and room for the
 * multipart framing and the two ids beside it.
 */
export const EPISODE_PAGE_REPLACE_MAX_BYTES =
  EPISODE_PAGE_IMAGE_MAX_BYTES + 64 * 1024;

/**
 * What the upload answers with. `location` is set when the session was
 * rejected and names the login page to go to, which a `fetch` cannot be
 * redirected to without posting the files there again.
 */
export interface EpisodePagesUploadResponse {
  location?: string;
  message: string;
  ok: boolean;
}
