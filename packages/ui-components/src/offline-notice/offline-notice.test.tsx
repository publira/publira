// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OfflineNotice } from "./offline-notice";

const offline = vi.hoisted(() => ({ value: false }));

vi.mock("next/offline", () => ({ useOffline: () => offline.value }));

afterEach(() => {
  cleanup();
  offline.value = false;
});

const liveRegion = (container: HTMLElement) =>
  container.querySelector('[aria-live="polite"]');

describe("OfflineNotice", () => {
  it("keeps an empty polite live region mounted while online", () => {
    const { container } = render(
      <OfflineNotice>You are offline.</OfflineNotice>
    );

    expect(liveRegion(container)?.textContent).toBe("");
    expect(screen.queryByText("You are offline.")).toBeNull();
  });

  it("fills the same live region while offline and empties it on reconnect", () => {
    offline.value = true;
    const { container, rerender } = render(
      <OfflineNotice>You are offline.</OfflineNotice>
    );

    const region = liveRegion(container);
    expect(region?.textContent).toBe("You are offline.");

    offline.value = false;
    rerender(<OfflineNotice>You are offline.</OfflineNotice>);

    expect(liveRegion(container)).toBe(region);
    expect(region?.textContent).toBe("");
  });

  it("is neither an alert nor a status that competes with a form's own", () => {
    offline.value = true;
    render(<OfflineNotice>You are offline.</OfflineNotice>);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not take focus", () => {
    offline.value = true;
    const { container } = render(
      <OfflineNotice>You are offline.</OfflineNotice>
    );

    expect(document.activeElement).toBe(document.body);
    expect(container.querySelector("[tabindex]")).toBeNull();
  });
});
