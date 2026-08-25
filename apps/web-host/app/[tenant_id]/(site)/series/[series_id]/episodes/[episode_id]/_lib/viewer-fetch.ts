import { definePlugin } from "@publira/comic-viewer";

/**
 * What the viewer will accept for a page, mirroring what a browser sends for an
 * `img` element. The viewer fetches pages with `fetch()`, which defaults to
 * accepting anything, and image-server's Manael only resizes a page while it is
 * converting it. Without this header the `w` on a placeholder URL therefore
 * does nothing, and the blurred stand-in downloads the full-size original a
 * second time.
 */
const IMAGE_ACCEPT = "image/avif,image/webp,image/*,*/*;q=0.8";

export const acceptNegotiatedImages = definePlugin({
  customFetch: async ({ signal, url }) => {
    const response = await fetch(url, {
      headers: { Accept: IMAGE_ACCEPT },
      signal,
    });
    if (!response.ok) {
      throw new Error(`page request failed with ${response.status}`);
    }

    return await response.arrayBuffer();
  },
  name: "accept-negotiated-images",
});
