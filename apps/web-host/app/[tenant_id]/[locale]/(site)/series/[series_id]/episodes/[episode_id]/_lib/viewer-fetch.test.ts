import type { ViewerPage } from "@publira/comic-viewer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { acceptNegotiatedImages, decryptImageBuffer } from "./viewer-fetch";

const token =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyZWFkZXItcHVibGljLWlkIn0.signature";
const subject = "reader-public-id";
const keyID = "episode-rendition-key";
const plaintext = Uint8Array.from(
  Buffer.from(
    "5075626c69726120656e6372797074656420696d616765207465737420766563746f72",
    "hex"
  )
);
const ciphertext = Uint8Array.from(
  Buffer.from(
    "04fe75de99f7fdb86d5f1546b403e7d043db19912be8dc043483d0f953924c2c9f6531",
    "hex"
  )
);

const page = (): ViewerPage => ({
  id: "page-1",
  mimeType: "image/jpeg",
  src: `/images/episodes/page-1?t=${token}`,
  title: "第1話 1ページ",
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decryptImageBuffer", () => {
  it("Decode the same xor-hmac-sha256-v1 vector as image-server", async () => {
    await expect(
      decryptImageBuffer(ciphertext.buffer, keyID, subject, token)
    ).resolves.toEqual(plaintext.buffer);
  });
});

describe("acceptNegotiatedImages", () => {
  it("Decrypt the encrypted response and reflect Manael's MIME type on the page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(ciphertext, {
        headers: {
          "X-Publira-Image-Content-Type": "image/avif",
          "X-Publira-Image-Encryption": "xor-hmac-sha256-v1",
          "X-Publira-Image-Key-Id": keyID,
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const viewerPage = page();

    const buffer = await acceptNegotiatedImages.customFetch?.({
      page: viewerPage,
      signal: new AbortController().signal,
      url: viewerPage.src,
    });

    expect(buffer).toEqual(plaintext.buffer);
    expect(viewerPage.mimeType).toBe("image/avif");
    expect(fetchMock).toHaveBeenCalledWith(
      viewerPage.src,
      expect.objectContaining({
        headers: { Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
      })
    );
  });

  it("Pass unencrypted response of public image as is", async () => {
    const imageBuffer = Uint8Array.from([1, 2, 3]).buffer;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(imageBuffer))
    );
    const viewerPage = page();

    const buffer = await acceptNegotiatedImages.customFetch?.({
      page: viewerPage,
      signal: new AbortController().signal,
      url: viewerPage.src,
    });

    expect(buffer).toEqual(imageBuffer);
    expect(viewerPage.mimeType).toBe("image/jpeg");
  });

  it("Unsupported encryption methods will fail without decrypting the page.", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(ciphertext, {
          headers: { "X-Publira-Image-Encryption": "unknown-v1" },
        })
      )
    );
    const viewerPage = page();

    await expect(
      acceptNegotiatedImages.customFetch?.({
        page: viewerPage,
        signal: new AbortController().signal,
        url: viewerPage.src,
      })
    ).rejects.toThrow("unsupported image encryption algorithm");
  });
});
