// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShareMenu } from "./share-menu";

vi.mock("./client-message", () => {
  const messages: Record<string, string> = {
    "host.share.action": "Share",
    "host.share.copied": "Link copied",
    "host.share.copy_failed": "Could not copy the link",
    "host.share.copy_link": "Copy link",
    "host.share.line": "Share on LINE",
    "host.share.x": "Share on X",
  };

  return {
    useClientMessages:
      () =>
      (key: string, values?: Record<string, string>): string =>
        key === "host.share.aria"
          ? `Share “${values?.title}”`
          : (messages[key] ?? key),
  };
});

const TITLE = "Published Series";
const TEXT = "Published Series by Published Author";
const URL_UNDER_TEST = "https://example.test/en/series/SR01";

const setNavigator = (key: "clipboard" | "share", value: unknown) => {
  Object.defineProperty(navigator, key, {
    configurable: true,
    value,
    writable: true,
  });
};

/** jsdom implements neither, so "absent" is what the real browsers lacking them look like. */
const clearNavigator = (key: "clipboard" | "share") => {
  setNavigator(key, undefined);
};

const trigger = () => screen.getByRole("button", { name: `Share “${TITLE}”` });

beforeEach(() => {
  clearNavigator("share");
  clearNavigator("clipboard");
});

afterEach(() => {
  cleanup();
  clearNavigator("share");
  clearNavigator("clipboard");
});

describe("ShareMenu", () => {
  it("hands X and LINE the message rather than the page's own name", () => {
    render(<ShareMenu text={TEXT} title={TITLE} url={URL_UNDER_TEST} />);

    fireEvent.click(trigger());

    const x = screen.getByRole("link", { name: "Share on X" });
    expect(x.getAttribute("href")).toBe(
      "https://x.com/intent/post?text=Published+Series+by+Published+Author&url=https%3A%2F%2Fexample.test%2Fen%2Fseries%2FSR01"
    );
    expect(x.getAttribute("rel")).toBe("noopener noreferrer");

    const line = screen.getByRole("link", { name: "Share on LINE" });
    expect(line.getAttribute("href")).toBe(
      "https://social-plugins.line.me/lineit/share?text=Published+Series+by+Published+Author&url=https%3A%2F%2Fexample.test%2Fen%2Fseries%2FSR01"
    );

    expect(screen.getByRole("button", { name: "Copy link" })).toBeDefined();
  });

  it("hands the system share sheet the title and the canonical URL instead of opening the popover", () => {
    const share = vi.fn(() => Promise.resolve());
    setNavigator("share", share);

    render(<ShareMenu text={TEXT} title={TITLE} url={URL_UNDER_TEST} />);
    fireEvent.click(trigger());

    expect(share).toHaveBeenCalledWith({
      text: TEXT,
      title: TITLE,
      url: URL_UNDER_TEST,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays closed when the reader dismisses the share sheet", async () => {
    setNavigator("share", () =>
      Promise.reject(new DOMException("dismissed", "AbortError"))
    );

    render(<ShareMenu text={TEXT} title={TITLE} url={URL_UNDER_TEST} />);
    fireEvent.click(trigger());
    await Promise.resolve();

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("falls back to the popover when the share sheet cannot open at all", async () => {
    setNavigator("share", () =>
      Promise.reject(new DOMException("blocked", "NotAllowedError"))
    );

    render(<ShareMenu text={TEXT} title={TITLE} url={URL_UNDER_TEST} />);
    fireEvent.click(trigger());
    await vi.waitFor(() => {
      expect(screen.getByRole("link", { name: "Share on X" })).toBeDefined();
    });
  });

  it("copies the canonical URL and says that it did", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setNavigator("clipboard", { writeText });

    render(<ShareMenu text={TEXT} title={TITLE} url={URL_UNDER_TEST} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    expect(writeText).toHaveBeenCalledWith(URL_UNDER_TEST);
    await vi.waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Link copied");
    });
  });

  it("says so when the clipboard refuses the link", async () => {
    setNavigator("clipboard", {
      writeText: () => Promise.reject(new Error("denied")),
    });

    render(<ShareMenu text={TEXT} title={TITLE} url={URL_UNDER_TEST} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    await vi.waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "Could not copy the link"
      );
    });
  });
});
