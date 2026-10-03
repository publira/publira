// @vitest-environment jsdom

import { bindMessages, getLocales } from "@publira/i18n";
import type { Locale, MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog, sharedMessage } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommentCreatorMark } from "./comment-creator-mark";

const { renderLocale } = vi.hoisted(() => ({
  renderLocale: { current: "en" as Locale },
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog(renderLocale.current))(message, values),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(() => {
  cleanup();
  renderLocale.current = "en";
});

describe("CommentCreatorMark", () => {
  it("renders nothing for a comment no credited creator wrote", () => {
    const { container } = render(<CommentCreatorMark creator={null} />);

    expect(container.textContent).toBe("");
  });

  it("links the credited name to the creator's page in the console", () => {
    render(
      <CommentCreatorMark
        creator={{ name: "Sample Author", publicId: "CREATOR001" }}
      />
    );

    expect(screen.getByText("Author")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Sample Author" }).getAttribute("href")
    ).toBe("/creators/CREATOR001");
  });

  it("falls back to the public id when the credit carries no name", () => {
    render(
      <CommentCreatorMark creator={{ name: "", publicId: "CREATOR001" }} />
    );

    expect(screen.getByRole("link", { name: "CREATOR001" })).toBeTruthy();
  });

  it.each(getLocales())(
    "uses the storefront's word for the badge in %s",
    (locale) => {
      renderLocale.current = locale;
      render(
        <CommentCreatorMark
          creator={{ name: "Sample Author", publicId: "CREATOR001" }}
        />
      );

      expect(
        screen.getByText(
          sharedMessage("host.episode.comments.creator_badge", locale)
        )
      ).toBeTruthy();
    }
  );
});
