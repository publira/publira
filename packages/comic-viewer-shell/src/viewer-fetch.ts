import { definePlugin } from "@publira/comic-viewer";
import type { ViewerPage } from "@publira/comic-viewer";
import { decodeBase64Url } from "@publira/utils";

import { atRenditionWidth, renditionWidthOf } from "./page-renditions";

/**
 * What the viewer will accept for a page, mirroring what a browser sends for an
 * `img` element. The viewer fetches pages with `fetch()`, which defaults to
 * accepting anything, and image-server's Manael only resizes a page while it is
 * converting it. Without this header the `w` on a placeholder URL therefore
 * does nothing, and the blurred stand-in downloads the full-size original a
 * second time.
 */
const IMAGE_ACCEPT = "image/avif,image/webp,image/*,*/*;q=0.8";

const IMAGE_ENCRYPTION_ALGORITHM = "xor-hmac-sha256-v1";
const IMAGE_ENCRYPTION_HEADER = "X-Publira-Image-Encryption";
const IMAGE_CONTENT_TYPE_HEADER = "X-Publira-Image-Content-Type";
const IMAGE_KEY_ID_HEADER = "X-Publira-Image-Key-Id";
const IMAGE_ENCRYPTION_DOMAIN = "publira:image:xor-hmac-sha256:v1\0";
const MEDIA_TOKEN_QUERY_PARAM = "t";
const STREAM_BLOCK_BYTES = 32;
const STREAM_BATCH_SIZE = 128;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const concatBytes = (
  ...parts: Uint8Array<ArrayBuffer>[]
): Uint8Array<ArrayBuffer> => {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }

  return output;
};

/** Claims that carry the `sub` a media token names its viewer by. */
const hasSubject = (claims: unknown): claims is { sub: string } =>
  typeof claims === "object" &&
  claims !== null &&
  "sub" in claims &&
  typeof claims.sub === "string";

const subjectFromMediaToken = (token: string): string | null => {
  const [, payload] = token.split(".");

  if (!payload) {
    return null;
  }

  const bytes = decodeBase64Url(payload);

  if (!bytes) {
    return null;
  }

  try {
    const claims: unknown = JSON.parse(textDecoder.decode(bytes));

    if (hasSubject(claims) && claims.sub.length > 0) {
      return claims.sub;
    }
  } catch {
    // The signature was already verified by image-server. The client only
    // needs the matching opaque JWT bytes and its subject for key derivation.
  }

  return null;
};

const mediaTokenFromUrl = (url: string): string | null => {
  try {
    return new URL(
      url,
      globalThis.location?.href ?? "http://localhost"
    ).searchParams.get(MEDIA_TOKEN_QUERY_PARAM);
  } catch {
    return null;
  }
};

const importHmacKey = (key: Uint8Array<ArrayBuffer>): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    key,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );

const signHmacSha256 = async (
  key: CryptoKey,
  data: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> => {
  const signature = await crypto.subtle.sign("HMAC", key, data);

  return new Uint8Array(signature);
};

const xorByte = (left: number, right: number): number => {
  let output = 0;

  for (let place = 1; place <= 128; place *= 2) {
    const leftBit = Math.floor(left / place) % 2;
    const rightBit = Math.floor(right / place) % 2;
    output += (leftBit + rightBit) % 2 === 0 ? 0 : place;
  }

  return output;
};

const decryptStreamBlocks = async (
  input: Uint8Array<ArrayBuffer>,
  key: CryptoKey,
  plaintext: Uint8Array<ArrayBuffer>,
  offset = 0
): Promise<void> => {
  if (offset >= input.byteLength) {
    return;
  }

  const blockCount = Math.min(
    STREAM_BATCH_SIZE,
    Math.ceil((input.byteLength - offset) / STREAM_BLOCK_BYTES)
  );

  const streams = await Promise.all(
    Array.from({ length: blockCount }, (_, index) => {
      const counterBytes = new Uint8Array(8);
      new DataView(counterBytes.buffer).setBigUint64(
        0,
        BigInt(offset / STREAM_BLOCK_BYTES + index)
      );

      return signHmacSha256(key, counterBytes);
    })
  );

  for (const [index, stream] of streams.entries()) {
    const streamOffset = offset + index * STREAM_BLOCK_BYTES;

    for (
      let streamIndex = 0;
      streamIndex < stream.byteLength &&
      streamOffset + streamIndex < input.byteLength;
      streamIndex += 1
    ) {
      plaintext[streamOffset + streamIndex] = xorByte(
        input[streamOffset + streamIndex],
        stream[streamIndex]
      );
    }
  }

  return decryptStreamBlocks(
    input,
    key,
    plaintext,
    offset + blockCount * STREAM_BLOCK_BYTES
  );
};

/**
 * Reverses image-server's `xor-hmac-sha256-v1` stream. This is delivery-layer
 * obfuscation, not DRM: the reader necessarily has the media token and can
 * reproduce the pixels this function hands to the canvas viewer.
 *
 * `token` and `subject` are whatever the page's own URL carried, and nothing
 * here tells the two kinds apart. An entitled body's token names the reader it
 * was issued to; a free body's names nobody — it is a deterministic function
 * of the episode and the current rotation window, so every reader of that
 * episode is handed the same one and derives the same key. Both arrive in `t`
 * and are keyed identically, which is why a reader with no session at all is
 * served by the code an entitled reader already uses.
 */
export const decryptImageBuffer = async (
  ciphertext: ArrayBuffer,
  keyID: string,
  subject: string,
  token: string
): Promise<ArrayBuffer> => {
  const tokenKey = await importHmacKey(textEncoder.encode(token));

  const key = await signHmacSha256(
    tokenKey,
    concatBytes(
      textEncoder.encode(IMAGE_ENCRYPTION_DOMAIN),
      textEncoder.encode(subject),
      textEncoder.encode("\0"),
      textEncoder.encode(keyID)
    )
  );

  const input = new Uint8Array(ciphertext);
  const plaintext = new Uint8Array(input.byteLength);
  await decryptStreamBlocks(input, await importHmacKey(key), plaintext);

  return plaintext.buffer;
};

const decryptImageResponse = async (
  response: Response,
  url: string
): Promise<{ buffer: ArrayBuffer; contentType?: string }> => {
  const algorithm = response.headers.get(IMAGE_ENCRYPTION_HEADER);

  if (algorithm === null) {
    return { buffer: await response.arrayBuffer() };
  }

  if (algorithm !== IMAGE_ENCRYPTION_ALGORITHM) {
    throw new Error(`unsupported image encryption algorithm: ${algorithm}`);
  }

  const contentType = response.headers.get(IMAGE_CONTENT_TYPE_HEADER);
  const keyID = response.headers.get(IMAGE_KEY_ID_HEADER);
  const token = mediaTokenFromUrl(url);
  const subject = token ? subjectFromMediaToken(token) : null;

  if (!contentType?.startsWith("image/") || !keyID || !token || !subject) {
    // Throwing here reaches the viewer as this page's own load failure, which
    // draws the reload control over it and leaves the rest of the body alone.
    // Drawing the ciphertext instead would put a broken page on the canvas
    // with nothing to retry from.
    throw new Error("encrypted image response is missing decryption metadata");
  }

  return {
    buffer: await decryptImageBuffer(
      await response.arrayBuffer(),
      keyID,
      subject,
      token
    ),
    contentType,
  };
};

/**
 * Answers a fresh URL for `page`, whose own was refused, or `undefined` when
 * there is none to offer.
 */
export type RenewPageUrl = (page: ViewerPage) => Promise<string | undefined>;

/**
 * The statuses image-server refuses a URL with once the media token it
 * carries has expired, or no longer admits the viewer.
 */
const RENEWABLE_STATUSES = new Set([401, 403]);

const requestPage = (url: string, signal: AbortSignal): Promise<Response> =>
  fetch(url, {
    headers: { Accept: IMAGE_ACCEPT },
    signal,
  });

/**
 * `renewed`, a page's fresh URL, asked for at the width `candidate` asks for.
 * The viewer hands the plugin one `srcset` candidate at a time and moves to a
 * wider one as the page's slot grows, while a renewal answers the page's
 * stored image, so the width has to come from the candidate on every fetch.
 */
const renewedAtWidthOf = (candidate: string, renewed: string): string => {
  const width = renditionWidthOf(candidate);

  return width === undefined ? renewed : atRenditionWidth(renewed, width);
};

/**
 * The URL `renewPageUrl` answers, or `undefined` where it fails: a renewal
 * that cannot be had leaves the page refused, with its reload control, rather
 * than failing it with the renewal's own error.
 */
const renewOrNothing = async (
  renewPageUrl: RenewPageUrl,
  page: ViewerPage
): Promise<string | undefined> => {
  try {
    return await renewPageUrl(page);
  } catch {
    return undefined;
  }
};

/**
 * The plugin every page is fetched through: it sends the `Accept` header
 * image-server resizes by, and decrypts a page delivered encrypted.
 *
 * A media token in a page's URL expires a while after the page list was read,
 * so a page the viewer reaches only later can be refused. Given
 * `renewPageUrl`, a refused page is asked for once more at the URL it answers,
 * and the plugin fetches that page from there from then on, so the reload
 * control a failed page offers retries the fresh URL rather than the one
 * already refused. What it keeps is the page's renewed URL, which every
 * candidate of the page's `srcset` is then fetched from at its own width. The
 * page's own `src` is left alone: the viewer keys a page's load by it, and a
 * load whose key changed under it would be dropped.
 */
export const createImageFetchPlugin = (renewPageUrl?: RenewPageUrl) => {
  const renewedUrls = new Map<string, string>();

  return definePlugin({
    customFetch: async ({ page, signal, url }) => {
      const kept = renewedUrls.get(page.id);
      let source = kept === undefined ? url : renewedAtWidthOf(url, kept);
      let response = await requestPage(source, signal);

      if (renewPageUrl && RENEWABLE_STATUSES.has(response.status)) {
        const renewed = await renewOrNothing(renewPageUrl, page);

        const sized =
          renewed === undefined ? source : renewedAtWidthOf(url, renewed);

        if (renewed !== undefined && sized !== source) {
          renewedUrls.set(page.id, renewed);
          source = sized;
          response = await requestPage(source, signal);
        }
      }

      if (!response.ok) {
        throw new Error(`page request failed with ${response.status}`);
      }

      const image = await decryptImageResponse(response, source);

      // Manael may have converted a JPEG/PNG source to WebP or AVIF. The viewer
      // decodes its buffer using this page metadata, so make its MIME type agree
      // with the post-decryption response rather than the original upload.
      if (image.contentType) {
        page.mimeType = image.contentType;
      }

      return image.buffer;
    },
    name: "decrypt-and-accept-negotiated-images",
  });
};

/** {@link createImageFetchPlugin} for pages whose URLs nothing renews. */
export const acceptNegotiatedImages = createImageFetchPlugin();
