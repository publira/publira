import type { ViewerPage } from "@publira/comic-viewer";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acceptNegotiatedImages,
  createImageFetchPlugin,
  decryptImageBuffer,
  renewFromPageUrls,
} from "./viewer-fetch";
import type { RenewPageUrl } from "./viewer-fetch";

const hex = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(value.match(/../gu) ?? [], (byte) =>
    Number.parseInt(byte, 16)
  );

/**
 * An entitled body: the media token names the reader who bought or borrowed
 * the episode, and the key is derived from that token's bytes and its subject.
 */
const entitled = {
  ciphertext: hex(
    "04fe75de99f7fdb86d5f1546b403e7d043db19912be8dc043483d0f953924c2c9f6531"
  ),
  keyID: "episode-rendition-key",
  plaintext: hex(
    "5075626c69726120656e6372797074656420696d616765207465737420766563746f72"
  ),
  subject: "reader-public-id",
  token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyZWFkZXItcHVibGljLWlkIn0.signature",
};

/**
 * A real free-episode media token, as `IssueFreeEpisodeMediaToken` signs it.
 * Written out segment by segment because the middle one is what makes this a
 * free body's token rather than an entitled reader's: it claims
 * `"sub":"anonymous-free-episode"`, `"aud":["media"]`, an `eid` and a `tid`,
 * and an `iat` on a UTC day boundary with an `exp` two days after it.
 */
const freeMediaToken = [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJ0aWQiOiIwMThmNWI3Yy0xYTJiLTRjM2QtOGU5Zi0wYTFiMmMzZDRlNWYiLCJjdiI6MCwiZWlkIjoiMDE4ZjViN2MtOTk5OS00YzNkLThlOWYtMGExYjJjM2Q0ZTVmIiwiaXNzIjoicHVibGlyYSIsInN1YiI6ImFub255bW91cy1mcmVlLWVwaXNvZGUiLCJhdWQiOlsibWVkaWEiXSwiZXhwIjoxNzg4NTY2NDAwLCJpYXQiOjE3ODgzOTM2MDB9",
  "Y5F8WQCveCJaLIStXrNis0XO0LlvMKc1WqfmzD4O-0A",
].join(".");

/**
 * A free body: the same algorithm, keyed by the rotating per-episode media
 * token the API puts on every reader's copy of the URL. Its subject is the
 * synthetic `anonymous-free-episode`, which names nobody — the reader it is
 * served to may hold no credential at all.
 *
 * Both vectors were produced by image-server's own `imageCipher`, so a change
 * to either side's derivation fails here rather than in a browser.
 */
const free = {
  ciphertext: hex(
    "7dd838cf1807443d71d17b9603c82a7208c5cad8c0e21996a97b3e69c3e685850a17d7e10128a250b1390cdb6c7297"
  ),
  keyID: "free-episode-rendition-key",
  plaintext: hex(
    "5075626c697261206672656520657069736f646520656e637279707465642070616765207465737420766563746f72"
  ),
  subject: "anonymous-free-episode",
  token: freeMediaToken,
};

const page = (search = `?t=${entitled.token}`): ViewerPage => ({
  id: "page-1",
  mimeType: "image/jpeg",
  src: `/images/episodes/page-1${search}`,
  title: "Episode 1, page 1",
});

const encryptedResponse = (
  ciphertext: Uint8Array<ArrayBuffer>,
  keyID: string,
  contentType = "image/avif"
): Response =>
  new Response(ciphertext, {
    headers: {
      "X-Publira-Image-Content-Type": contentType,
      "X-Publira-Image-Encryption": "xor-hmac-sha256-v1",
      "X-Publira-Image-Key-Id": keyID,
    },
  });

const fetchPage = (
  viewerPage: ViewerPage
): Promise<ArrayBuffer | undefined> | undefined =>
  acceptNegotiatedImages.customFetch?.({
    page: viewerPage,
    signal: new AbortController().signal,
    url: viewerPage.src,
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decryptImageBuffer", () => {
  it("Decrypt the same xor-hmac-sha256-v1 vector as image-server", async () => {
    await expect(
      decryptImageBuffer(
        entitled.ciphertext.buffer,
        entitled.keyID,
        entitled.subject,
        entitled.token
      )
    ).resolves.toEqual(entitled.plaintext.buffer);
  });

  it("Decrypt a free body keyed by its rotating per-episode media token", async () => {
    await expect(
      decryptImageBuffer(
        free.ciphertext.buffer,
        free.keyID,
        free.subject,
        free.token
      )
    ).resolves.toEqual(free.plaintext.buffer);
  });
});

describe("acceptNegotiatedImages", () => {
  it("Decrypt the encrypted response and preserve its MIME type on the page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        encryptedResponse(entitled.ciphertext, entitled.keyID)
      );
    vi.stubGlobal("fetch", fetchMock);
    const viewerPage = page();

    const buffer = await fetchPage(viewerPage);

    expect(buffer).toEqual(entitled.plaintext.buffer);
    expect(viewerPage.mimeType).toBe("image/avif");
    expect(fetchMock).toHaveBeenCalledWith(
      viewerPage.src,
      expect.objectContaining({
        headers: { Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
      })
    );
  });

  it("Decrypt an encrypted free body from the token its own URL carries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(encryptedResponse(free.ciphertext, free.keyID))
    );
    const viewerPage = page(`?t=${free.token}`);

    await expect(fetchPage(viewerPage)).resolves.toEqual(free.plaintext.buffer);
    expect(viewerPage.mimeType).toBe("image/avif");
  });

  it("Pass unencrypted response of public image as is", async () => {
    const imageBuffer = Uint8Array.from([1, 2, 3]).buffer;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(imageBuffer))
    );
    const viewerPage = page();

    const buffer = await fetchPage(viewerPage);

    expect(buffer).toEqual(imageBuffer);
    expect(viewerPage.mimeType).toBe("image/jpeg");
  });

  it("Pass an unencrypted free body as is, as the server flag off leaves it", async () => {
    const imageBuffer = Uint8Array.from([4, 5, 6]).buffer;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(imageBuffer))
    );
    const viewerPage = page(`?t=${free.token}`);

    await expect(fetchPage(viewerPage)).resolves.toEqual(imageBuffer);
    expect(viewerPage.mimeType).toBe("image/jpeg");
  });

  it("Unsupported encryption methods will fail without decrypting the page.", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(entitled.ciphertext, {
          headers: { "X-Publira-Image-Encryption": "unknown-v1" },
        })
      )
    );

    await expect(fetchPage(page())).rejects.toThrow(
      "unsupported image encryption algorithm"
    );
  });

  it.each([
    { name: "no media token at all", search: "" },
    { name: "a media token that is not a JWT", search: "?t=not-a-jwt" },
    {
      name: "a media token whose payload names no subject",
      search: "?t=eyJhbGciOiJIUzI1NiJ9.eyJlaWQiOiJlcGlzb2RlIn0.signature",
    },
  ])("Fail the page alone when the URL carries $name", async ({ search }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(encryptedResponse(free.ciphertext, free.keyID))
    );

    await expect(fetchPage(page(search))).rejects.toThrow(
      "encrypted image response is missing decryption metadata"
    );
  });

  it("Fail the page alone when the response names no rendition key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(free.ciphertext, {
          headers: {
            "X-Publira-Image-Content-Type": "image/avif",
            "X-Publira-Image-Encryption": "xor-hmac-sha256-v1",
          },
        })
      )
    );

    await expect(fetchPage(page(`?t=${free.token}`))).rejects.toThrow(
      "encrypted image response is missing decryption metadata"
    );
  });
});

const fetchWith = (
  plugin: ReturnType<typeof createImageFetchPlugin>,
  viewerPage: ViewerPage
): Promise<ArrayBuffer | undefined> | undefined =>
  plugin.customFetch?.({
    page: viewerPage,
    signal: new AbortController().signal,
    url: viewerPage.src,
  });

describe("createImageFetchPlugin", () => {
  it("asks again at a renewed URL once the page's own is refused, and goes there from then on", async () => {
    const imageBuffer = Uint8Array.from([7, 8, 9]).buffer;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(imageBuffer))
      .mockResolvedValueOnce(new Response(imageBuffer));
    vi.stubGlobal("fetch", fetchMock);
    const viewerPage = page("?t=expired");
    const renewPageUrl = vi.fn<RenewPageUrl>(() =>
      Promise.resolve("/images/episodes/page-1?t=fresh")
    );
    const plugin = createImageFetchPlugin(renewPageUrl);

    await expect(fetchWith(plugin, viewerPage)).resolves.toEqual(imageBuffer);
    expect(renewPageUrl).toHaveBeenCalledWith(viewerPage);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/images/episodes/page-1?t=fresh",
      expect.anything()
    );
    // The viewer keys the page's load by its own URL.
    expect(viewerPage.src).toBe("/images/episodes/page-1?t=expired");

    // A reload of the page goes straight to the URL that worked.
    await fetchWith(plugin, viewerPage);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/images/episodes/page-1?t=fresh",
      expect.anything()
    );
    expect(renewPageUrl).toHaveBeenCalledTimes(1);
  });

  it("fails the page when no fresher URL is to be had", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const viewerPage = page("?t=expired");
    const plugin = createImageFetchPlugin(() =>
      Promise.resolve(viewerPage.src)
    );

    await expect(fetchWith(plugin, viewerPage)).rejects.toThrow(
      "page request failed with 403"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails the page as refused when the renewal itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 403 }))
    );
    const plugin = createImageFetchPlugin(() =>
      Promise.reject(new Error("the session ended"))
    );

    await expect(fetchWith(plugin, page("?t=expired"))).rejects.toThrow(
      "page request failed with 403"
    );
  });

  it("leaves a failure that is not a refusal to the reload control", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    );
    const renewPageUrl = vi.fn<RenewPageUrl>();

    await expect(
      fetchWith(createImageFetchPlugin(renewPageUrl), page())
    ).rejects.toThrow("page request failed with 503");
    expect(renewPageUrl).not.toHaveBeenCalled();
  });
});

describe("renewFromPageUrls", () => {
  const firstPage = page("?t=expired");
  const secondPage = { ...page("?t=expired"), id: "page-2" };

  it("answers the pages refused together from one read of their URLs", async () => {
    const readPageUrls = vi.fn(() =>
      Promise.resolve({
        "page-1": "/images/episodes/page-1?t=fresh",
        "page-2": "/images/episodes/page-2?t=fresh",
      })
    );
    const renewPageUrl = renewFromPageUrls(readPageUrls);

    await expect(
      Promise.all([renewPageUrl(firstPage), renewPageUrl(secondPage)])
    ).resolves.toEqual([
      "/images/episodes/page-1?t=fresh",
      "/images/episodes/page-2?t=fresh",
    ]);
    expect(readPageUrls).toHaveBeenCalledTimes(1);
  });

  it("reads again for a page refused after the last read settled", async () => {
    const readPageUrls = vi.fn(() =>
      Promise.resolve({ "page-1": "/images/episodes/page-1?t=fresh" })
    );
    const renewPageUrl = renewFromPageUrls(readPageUrls);

    await renewPageUrl(firstPage);
    await renewPageUrl(firstPage);

    expect(readPageUrls).toHaveBeenCalledTimes(2);
  });

  it("answers no URL for a page the read leaves out", async () => {
    const renewPageUrl = renewFromPageUrls(() => Promise.resolve({}));

    await expect(renewPageUrl(firstPage)).resolves.toBeUndefined();
  });

  it("answers no URL when the read fails", async () => {
    const renewPageUrl = renewFromPageUrls(() =>
      Promise.reject(new Error("the session ended"))
    );

    await expect(renewPageUrl(firstPage)).resolves.toBeUndefined();
  });
});
