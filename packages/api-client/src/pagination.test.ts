import { describe, expect, it, vi } from "vitest";

import { findByPublicIdWithToken, forEachPageWithToken } from "./pagination";

describe("forEachPageWithToken", () => {
  it("token を順に辿って各ページを onPage に渡す", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ id: "a" }],
        nextToken: "page-2",
      })
      .mockResolvedValueOnce({
        items: [{ id: "b" }],
        nextToken: "",
      });
    const onPage = vi.fn();

    await forEachPageWithToken(fetchPage, onPage);

    expect(fetchPage).toHaveBeenNthCalledWith(1, "", 100);
    expect(fetchPage).toHaveBeenNthCalledWith(2, "page-2", 100);
    expect(onPage).toHaveBeenNthCalledWith(1, [{ id: "a" }]);
    expect(onPage).toHaveBeenNthCalledWith(2, [{ id: "b" }]);
  });

  it("onPage が false を返したら次ページを取らない", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      items: [{ id: "a" }],
      nextToken: "page-2",
    });
    const onPage = vi.fn().mockReturnValue(false);

    await forEachPageWithToken(fetchPage, onPage);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledTimes(1);
  });

  it("同じ token が返された場合は走査を停止する", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      items: [{ id: "a" }],
      nextToken: "page-2",
    });
    const onPage = vi.fn();

    await forEachPageWithToken(fetchPage, onPage);

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(onPage).toHaveBeenCalledTimes(2);
  });

  it("ページ上限で走査を停止する", async () => {
    let page = 0;
    const fetchPage = vi.fn().mockImplementation(() => {
      page += 1;
      return { items: [{ id: `p${page}` }], nextToken: `page-${page}` };
    });
    const onPage = vi.fn();

    await forEachPageWithToken(fetchPage, onPage, { maxPages: 3 });

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(onPage).toHaveBeenCalledTimes(3);
  });

  it("maxRows が pageSize より小さいとき limit を残り件数に抑える", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      items: Array.from({ length: 50 }, (_, index) => ({
        id: `item-${index}`,
      })),
      nextToken: "page-2",
    });
    const onPage = vi.fn();

    await forEachPageWithToken(fetchPage, onPage, {
      maxRows: 50,
      pageSize: 100,
    });

    expect(fetchPage).toHaveBeenCalledWith("", 50);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledTimes(1);
  });

  it("limit を超える応答があっても maxRows 以降の行は onPage に渡さない", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      items: [{ id: "1" }, { id: "2" }, { id: "3" }],
      nextToken: "page-2",
    });
    const onPage = vi.fn();

    await forEachPageWithToken(fetchPage, onPage, {
      maxRows: 2,
      pageSize: 100,
    });

    expect(fetchPage).toHaveBeenCalledWith("", 2);
    expect(onPage).toHaveBeenCalledWith([{ id: "1" }, { id: "2" }]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

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

  it("maxRows が pageSize より小さいとき limit を残り件数に抑える", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      items: Array.from({ length: 50 }, (_, index) => ({
        publicId: `item-${index}`,
      })),
      nextToken: "page-2",
    });

    await expect(
      findByPublicIdWithToken("target", fetchPage, {
        maxRows: 50,
        pageSize: 100,
      })
    ).resolves.toBeNull();
    expect(fetchPage).toHaveBeenCalledWith("", 50);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("limit を超える応答があっても maxRows 以降の一致は返さない", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      items: [
        { publicId: "first" },
        { publicId: "second" },
        { publicId: "target" },
      ],
      nextToken: "page-2",
    });

    await expect(
      findByPublicIdWithToken("target", fetchPage, {
        maxRows: 2,
        pageSize: 100,
      })
    ).resolves.toBeNull();
    expect(fetchPage).toHaveBeenCalledWith("", 2);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
