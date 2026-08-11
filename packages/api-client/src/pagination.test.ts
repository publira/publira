import { describe, expect, it, vi } from "vitest";

import { findByPublicIdWithToken } from "./pagination";

describe("findByPublicIdWithToken", () => {
  it("token を順に辿って publicId が一致する項目を返す", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ publicId: "first" }],
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        items: [{ publicId: "target" }],
        nextToken: "",
      });

    await expect(findByPublicIdWithToken("target", fetchPage)).resolves.toEqual(
      { publicId: "target" }
    );
    expect(fetchPage).toHaveBeenNthCalledWith(1, "", 100);
    expect(fetchPage).toHaveBeenNthCalledWith(2, "page-2", 100);
  });

  it("同じ token が返された場合は走査を停止する", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      items: [{ publicId: "other" }],
      nextToken: "page-2",
    });

    await expect(
      findByPublicIdWithToken("target", fetchPage)
    ).resolves.toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("ページサイズを呼び出し側で指定できる", async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: [], nextToken: "" });

    await findByPublicIdWithToken("target", fetchPage, { pageSize: 20 });

    expect(fetchPage).toHaveBeenCalledWith("", 20);
  });

  it("異なる token が続いてもページ上限で走査を停止する", async () => {
    let page = 0;
    const fetchPage = vi.fn().mockImplementation(() => {
      page += 1;
      return { items: [], nextToken: `page-${page}` };
    });

    await expect(
      findByPublicIdWithToken("target", fetchPage, { maxPages: 3 })
    ).resolves.toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});
