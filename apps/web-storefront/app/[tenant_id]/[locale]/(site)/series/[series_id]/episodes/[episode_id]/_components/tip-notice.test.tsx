// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TipNotice } from "./tip-notice";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

const EPISODE_PATH = "/en/series/SERIES_001/episodes/EPISODE_001";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("TipNotice", () => {
  it.each([
    ["success", "Thank you for your tip"],
    ["cancelled", "The tip was cancelled"],
    ["error", "Could not start the tip"],
  ] as const)(
    "says how a tip that ended in %s went, and takes the query off the URL",
    (tip, copy) => {
      window.history.replaceState(
        null,
        "",
        `${EPISODE_PATH}?tip=${tip}&session_id=cs_test_1`
      );

      render(<TipNotice tip={tip} />);

      expect(screen.getByText(new RegExp(copy, "u"))).toBeTruthy();
      expect(window.location.pathname + window.location.search).toBe(
        EPISODE_PATH
      );
    }
  );

  it("leaves a page that was not reached from a tip alone", () => {
    window.history.replaceState(null, "", `${EPISODE_PATH}?comment=abc`);

    const { container } = render(<TipNotice tip="" />);

    expect(container.textContent).toBe("");
    expect(window.location.search).toBe("?comment=abc");
  });
});
