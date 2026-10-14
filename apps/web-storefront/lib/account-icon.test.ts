import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_ICON_MAX_BYTES,
  checkAccountIconFile,
  checkAccountIconImage,
} from "./account-icon";

const fileOf = (type: string, size: number) =>
  new File([new Uint8Array(size)], "icon", { type });

/** A decoder standing in for the browser's, answering with the given size. */
const stubDecodedSize = (width: number, height: number) => {
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() => Promise.resolve({ close, height, width }))
  );
  return close;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkAccountIconFile", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])(
    "takes a %s within the size limit",
    (type) => {
      expect(checkAccountIconFile(fileOf(type, 1024))).toBeNull();
    }
  );

  it.each(["image/heic", "image/svg+xml", "application/pdf", ""])(
    "turns away a %s",
    (type) => {
      expect(checkAccountIconFile(fileOf(type, 1024))).toBe("unsupported");
    }
  );

  it("takes a file of exactly the limit and turns away one byte more", () => {
    expect(
      checkAccountIconFile({ size: ACCOUNT_ICON_MAX_BYTES, type: "image/png" })
    ).toBeNull();
    expect(
      checkAccountIconFile({
        size: ACCOUNT_ICON_MAX_BYTES + 1,
        type: "image/png",
      })
    ).toBe("too-large");
  });

  it("turns away an empty file", () => {
    expect(checkAccountIconFile(fileOf("image/png", 0))).toBe("unsupported");
  });
});

describe("checkAccountIconImage", () => {
  it("takes an image whose shorter side is 128px", async () => {
    const close = stubDecodedSize(300, 128);

    await expect(
      checkAccountIconImage(fileOf("image/png", 1024))
    ).resolves.toBeNull();
    expect(close).toHaveBeenCalledOnce();
  });

  it("turns away an image whose shorter side is under 128px", async () => {
    stubDecodedSize(1200, 127);

    await expect(
      checkAccountIconImage(fileOf("image/png", 1024))
    ).resolves.toBe("too-small");
  });

  it("turns away a file the browser cannot decode", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => Promise.reject(new Error("decode")))
    );

    await expect(
      checkAccountIconImage(fileOf("image/jpeg", 1024))
    ).resolves.toBe("unsupported");
  });

  it("does not decode a file its metadata already rules out", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);

    await expect(
      checkAccountIconImage(fileOf("image/gif", 1024))
    ).resolves.toBe("unsupported");
    expect(decode).not.toHaveBeenCalled();
  });
});
