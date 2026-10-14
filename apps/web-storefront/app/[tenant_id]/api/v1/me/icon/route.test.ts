import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDeleteMyIcon, mockUploadMyIcon } = vi.hoisted(() => ({
  mockDeleteMyIcon: vi.fn(),
  mockUploadMyIcon: vi.fn(),
}));

vi.mock("#lib/auth", () => ({
  deleteMyIcon: mockDeleteMyIcon,
  uploadMyIcon: mockUploadMyIcon,
}));

const { DELETE, POST } = await import("./route");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

const SAME_ORIGIN_HEADERS = {
  host: "shop.example.test",
  origin: "https://shop.example.test",
};

const ICON_URL = "https://shop.example.test/api/v1/me/icon?locale=en";

const iconForm = (
  file: Blob | string = new File([new Uint8Array([1, 2, 3])], "icon.png", {
    type: "image/png",
  })
) => {
  const body = new FormData();
  body.set("icon", file);
  return body;
};

const upload = ({
  body = iconForm(),
  headers = SAME_ORIGIN_HEADERS,
  url = ICON_URL,
}: {
  body?: FormData;
  headers?: Record<string, string>;
  url?: string;
} = {}) => new Request(url, { body, headers, method: "POST" });

const removal = ({
  headers = SAME_ORIGIN_HEADERS,
  url = ICON_URL,
}: { headers?: Record<string, string>; url?: string } = {}) =>
  new Request(url, { headers, method: "DELETE" });

const params = (tenantId = TENANT_ID) => ({
  params: Promise.resolve({ tenant_id: tenantId }),
});

const messageOf = async (response: Response) =>
  ((await response.json()) as { message: string }).message;

describe("POST /api/v1/me/icon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadMyIcon.mockResolvedValue({ me: null, ok: true });
  });

  it("sends the picked image for the tenant the path names", async () => {
    const response = await POST(upload(), params());

    expect(response.status).toBe(200);
    await expect(messageOf(response)).resolves.toBe(
      "Your icon has been updated."
    );
    expect(mockUploadMyIcon).toHaveBeenCalledWith(TENANT_ID, {
      contentType: "image/png",
      data: new Uint8Array([1, 2, 3]),
    });
  });

  it("words the outcome in the locale the screen asked for", async () => {
    const response = await POST(
      upload({ url: ICON_URL.replace("locale=en", "locale=ja") }),
      params()
    );

    await expect(messageOf(response)).resolves.toBe("アイコンを更新しました。");
  });

  it("sends nothing for a request from another origin", async () => {
    const response = await POST(
      upload({
        headers: {
          host: "shop.example.test",
          origin: "https://evil.example",
        },
      }),
      params()
    );

    expect(response.status).toBe(403);
    expect(mockUploadMyIcon).not.toHaveBeenCalled();
  });

  it("sends nothing for a tenant id the proxy would never rewrite", async () => {
    const response = await POST(upload(), params("not-a-tenant"));

    expect(response.status).toBe(400);
    expect(mockUploadMyIcon).not.toHaveBeenCalled();
  });

  it("sends nothing without a locale it can word the outcome in", async () => {
    const response = await POST(
      upload({ url: "https://shop.example.test/api/v1/me/icon" }),
      params()
    );

    expect(response.status).toBe(400);
    expect(mockUploadMyIcon).not.toHaveBeenCalled();
  });

  it("sends nothing when the icon field is not a file", async () => {
    const response = await POST(
      upload({ body: iconForm("not a file") }),
      params()
    );

    expect(response.status).toBe(400);
    expect(mockUploadMyIcon).not.toHaveBeenCalled();
  });

  it("refuses a format the API cannot read before sending it on", async () => {
    const response = await POST(
      upload({
        body: iconForm(
          new File([new Uint8Array([1])], "icon.svg", {
            type: "image/svg+xml",
          })
        ),
      }),
      params()
    );

    expect(response.status).toBe(400);
    await expect(messageOf(response)).resolves.toBe(
      "This file cannot be used. Select a JPEG, PNG, or WebP image."
    );
    expect(mockUploadMyIcon).not.toHaveBeenCalled();
  });

  it.each([
    [
      "image",
      400,
      "This image cannot be used as an icon. Select a JPEG, PNG, or WebP image no larger than 10MB and at least 128x128px.",
    ],
    [
      "storage-not-configured",
      503,
      "Icons cannot be uploaded on this site right now. Contact the site if this continues.",
    ],
    [
      "rate-limited",
      429,
      "Too many requests in a short time. Please wait a moment and try again.",
    ],
    [
      "unauthenticated",
      401,
      "Your session is no longer valid. Please sign in again.",
    ],
    [
      "unavailable",
      503,
      "Could not connect to the server. Please try again later.",
    ],
    [
      "precondition",
      400,
      "Could not update your icon. Please try again later.",
    ],
  ] as const)(
    "shows the API's %s refusal",
    async (refusal, status, message) => {
      mockUploadMyIcon.mockResolvedValueOnce({ ok: false, refusal });

      const response = await POST(upload(), params());

      expect(response.status).toBe(status);
      await expect(messageOf(response)).resolves.toBe(message);
    }
  );
});

describe("DELETE /api/v1/me/icon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteMyIcon.mockResolvedValue({ me: null, ok: true });
  });

  it("removes the icon of the tenant the path names", async () => {
    const response = await DELETE(removal(), params());

    expect(response.status).toBe(200);
    await expect(messageOf(response)).resolves.toBe(
      "Your icon has been removed."
    );
    expect(mockDeleteMyIcon).toHaveBeenCalledWith(TENANT_ID);
  });

  it("removes nothing for a request from another origin", async () => {
    const response = await DELETE(
      removal({
        headers: {
          host: "shop.example.test",
          origin: "https://evil.example",
        },
      }),
      params()
    );

    expect(response.status).toBe(403);
    expect(mockDeleteMyIcon).not.toHaveBeenCalled();
  });

  it("words a refusal with no shared copy as a failed removal", async () => {
    mockDeleteMyIcon.mockResolvedValueOnce({
      ok: false,
      refusal: "precondition",
    });

    const response = await DELETE(removal(), params());

    expect(response.status).toBe(400);
    await expect(messageOf(response)).resolves.toBe(
      "Could not remove your icon. Please try again later."
    );
  });
});
