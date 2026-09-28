// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PublishedPage } from "#lib/pages";

import { PublishedPageContent } from "./published-page-view";

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: string }) => message,
}));

const publishedPage: PublishedPage = {
  contentMarkdown: [
    "Read the guide at https://example.com/guide before you start.",
    "",
    "The old title is ~~withdrawn~~.",
    "",
    "| Title | Year |",
    "| --- | ---: |",
    "| Example | 2020 |",
    "",
    "- [x] Done",
    "- [ ] Left",
  ].join("\n"),
  id: "page_1",
  publishedAt: "2026-01-15T00:00:00Z",
  slug: "/guide",
  title: "House guide",
  versionId: "version_1",
  versionNumber: 1,
};

afterEach(cleanup);

describe("PublishedPageContent", () => {
  it("renders a table, a strikethrough, a task list, and a bare URL", () => {
    render(<PublishedPageContent page={publishedPage} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "House guide" })
    ).toBeDefined();

    const guide = screen.getByRole("link", {
      name: "https://example.com/guide",
    });
    expect(guide.getAttribute("href")).toBe("https://example.com/guide");
    expect(guide.getAttribute("rel")).toBe("noreferrer");
    expect(guide.getAttribute("target")).toBe("_blank");

    const withdrawn = screen.getByText("withdrawn");
    expect(withdrawn.tagName).toBe("DEL");
    expect(withdrawn.className).toContain("line-through");
    expect(screen.queryByText("~~withdrawn~~")).toBeNull();

    expect(screen.getByRole("columnheader", { name: "Title" })).toBeDefined();
    const year = screen.getByRole("columnheader", { name: "Year" });
    expect(year.className).toContain("text-right");
    expect(screen.getByRole("cell", { name: "Example" })).toBeDefined();
    expect(screen.getByRole("cell", { name: "2020" }).className).toContain(
      "text-right"
    );
    expect(screen.getByRole("table").parentElement?.className).toContain(
      "overflow-x-auto"
    );
    expect(screen.queryByText("| Title | Year |")).toBeNull();

    const done = screen.getByRole("checkbox", { name: "Done" });
    const left = screen.getByRole("checkbox", { name: "Left" });
    expect(done).toHaveProperty("disabled", true);
    expect(done).toHaveProperty("checked", true);
    expect(left).toHaveProperty("disabled", true);
    expect(left).toHaveProperty("checked", false);
    expect(done.closest("ul")?.className).toContain("list-none");
  });
});
