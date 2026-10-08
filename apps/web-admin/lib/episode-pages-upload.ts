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
 * What the upload answers with. `location` is set when the session was
 * rejected and names the login page to go to, which a `fetch` cannot be
 * redirected to without posting the files there again.
 */
export interface EpisodePagesUploadResponse {
  location?: string;
  message: string;
  ok: boolean;
}
