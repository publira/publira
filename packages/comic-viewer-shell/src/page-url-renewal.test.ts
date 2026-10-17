import type { ViewerPage } from "@publira/comic-viewer";
import { describe, expect, it, vi } from "vitest";

import { renewFromPageUrls } from "./page-url-renewal";

const page = (id: string): ViewerPage => ({
  id,
  src: `/images/episodes/${id}?t=expired`,
  title: `Episode 1, ${id}`,
});

describe("renewFromPageUrls", () => {
  const firstPage = page("page-1");
  const secondPage = page("page-2");

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
