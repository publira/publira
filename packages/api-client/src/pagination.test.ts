import { describe, expect, it, vi } from "vitest";

import { findByPublicIdWithToken, forEachPageWithToken } from "./pagination";

describe("forEachPageWithToken", () => {
  it("follows the tokens, hands each page to onPage, and returns completed", async () => {
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

    await expect(forEachPageWithToken(fetchPage, onPage)).resolves.toBe(
      "completed"
    );

    expect(fetchPage).toHaveBeenNthCalledWith(1, "", 100);
    expect(fetchPage).toHaveBeenNthCalledWith(2, "page-2", 100);
    expect(onPage).toHaveBeenNthCalledWith(1, [{ id: "a" }]);
    expect(onPage).toHaveBeenNthCalledWith(2, [{ id: "b" }]);
  });

  it("onPage returning false stops with stopped-by-callback", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      items: [{ id: "a" }],
      nextToken: "page-2",
    });
    const onPage = vi.fn().mockReturnValue(false);

    await expect(forEachPageWithToken(fetchPage, onPage)).resolves.toBe(
      "stopped-by-callback"
    );

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledTimes(1);
  });

  it("a repeated token stops with repeated-token", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      items: [{ id: "a" }],
      nextToken: "page-2",
    });
    const onPage = vi.fn();

    await expect(forEachPageWithToken(fetchPage, onPage)).resolves.toBe(
      "repeated-token"
    );
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(onPage).toHaveBeenCalledTimes(2);
  });

  it("the page limit returns max-pages", async () => {
    let page = 0;
    const fetchPage = vi.fn().mockImplementation(() => {
      page += 1;
      return { items: [{ id: `p${page}` }], nextToken: `page-${page}` };
    });
    const onPage = vi.fn();

    await expect(
      forEachPageWithToken(fetchPage, onPage, { maxPages: 3 })
    ).resolves.toBe("max-pages");
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(onPage).toHaveBeenCalledTimes(3);
  });

  it("a maxRows below pageSize caps the limit at the remaining rows", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      items: Array.from({ length: 50 }, (_, index) => ({
        id: `item-${index}`,
      })),
      nextToken: "page-2",
    });
    const onPage = vi.fn();

    await expect(
      forEachPageWithToken(fetchPage, onPage, {
        maxRows: 50,
        pageSize: 100,
      })
    ).resolves.toBe("max-rows");

    expect(fetchPage).toHaveBeenCalledWith("", 50);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledTimes(1);
  });

  it("rows past maxRows are not handed to onPage even when the response exceeds the limit", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      items: [{ id: "1" }, { id: "2" }, { id: "3" }],
      nextToken: "page-2",
    });
    const onPage = vi.fn();

    await expect(
      forEachPageWithToken(fetchPage, onPage, {
        maxRows: 2,
        pageSize: 100,
      })
    ).resolves.toBe("max-rows");

    expect(fetchPage).toHaveBeenCalledWith("", 2);
    expect(onPage).toHaveBeenCalledWith([{ id: "1" }, { id: "2" }]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

describe("findByPublicIdWithToken", () => {
  it("follows the tokens and returns the item whose publicId matches", async () => {
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

  it("a repeated token stops the scan", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      items: [{ publicId: "other" }],
      nextToken: "page-2",
    });

    await expect(
      findByPublicIdWithToken("target", fetchPage)
    ).resolves.toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("the caller can set the page size", async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: [], nextToken: "" });

    await findByPublicIdWithToken("target", fetchPage, { pageSize: 20 });

    expect(fetchPage).toHaveBeenCalledWith("", 20);
  });

  it("the page limit stops the scan even while the tokens keep changing", async () => {
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

  it("a maxRows below pageSize caps the limit at the remaining rows", async () => {
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

  it("a match past maxRows is not returned even when the response exceeds the limit", async () => {
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
