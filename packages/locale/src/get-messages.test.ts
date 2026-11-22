import { bindMessages } from "@publira/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockNotFound, mockRootLocale } = vi.hoisted(() => ({
  mockNotFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  mockRootLocale: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mockNotFound }));

vi.mock("next/root-params", () => ({ locale: mockRootLocale }));

const catalog = {
  title: "Hello",
} as const;

describe("createGetMessages and createMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRootLocale.mockResolvedValue("en");
  });

  it("binds the catalog of the root locale", async () => {
    const { createGetMessages } = await import("./get-messages");
    const { getLocale } = await import("./root-locale");

    const getMessages = createGetMessages(
      (locale) =>
        Promise.resolve({
          ...catalog,
          title: locale === "en" ? "Hello" : "こんにちは",
        }),
      getLocale
    );

    const t = await getMessages();

    expect(t("title")).toBe("Hello");
  });

  it("renders one catalog string", async () => {
    const { createMessage } = await import("./message");

    const Message = createMessage<"title">(() =>
      Promise.resolve(bindMessages(catalog, "en"))
    );

    await expect(Message({ message: "title" })).resolves.toBe("Hello");
  });
});
