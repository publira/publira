// @vitest-environment jsdom

import { ViewerProvider } from "@publira/comic-viewer";
import type { ViewerPage } from "@publira/comic-viewer";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PageFitControl, ReadingDirectionControl } from "./viewer-controls";

const pages: ViewerPage[] = [
  { id: "IMG_001", src: "/images/episodes/IMG_001", title: "第1話 1ページ" },
];

const renderInViewer = (children: ReactNode) =>
  render(<ViewerProvider pages={pages}>{children}</ViewerProvider>);

/** The option the viewer currently reports back through the control. */
const pressedLabel = () =>
  screen
    .getByRole("group")
    .querySelector('[aria-pressed="true"]')
    ?.getAttribute("aria-label");

afterEach(() => {
  cleanup();
});

describe("PageFitControl", () => {
  it("既定では高さ合わせが選ばれている", () => {
    renderInViewer(<PageFitControl />);

    expect(pressedLabel()).toBe("画面の高さに合わせる");
  });

  it("選んだ表示サイズがビューアに伝わる", () => {
    renderInViewer(<PageFitControl />);

    fireEvent.click(screen.getByRole("button", { name: "原寸で表示する" }));

    expect(pressedLabel()).toBe("原寸で表示する");
  });
});

describe("ReadingDirectionControl", () => {
  it("既定では右開きが選ばれている", () => {
    renderInViewer(<ReadingDirectionControl />);

    expect(pressedLabel()).toBe("右開きで読む");
  });

  it("選んだ綴じ方向がビューアに伝わる", () => {
    renderInViewer(<ReadingDirectionControl />);

    fireEvent.click(screen.getByRole("button", { name: "左開きで読む" }));

    expect(pressedLabel()).toBe("左開きで読む");
  });
});
