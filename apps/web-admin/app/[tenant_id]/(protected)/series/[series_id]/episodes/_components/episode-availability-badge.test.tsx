// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EpisodeAvailabilityBadge } from "./episode-availability-badge";

vi.mock("#components/client-message", () => ({
  ClientMessage: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

afterEach(() => {
  cleanup();
});

describe("EpisodeAvailabilityBadge", () => {
  // An episode that states nothing is where its series is, so a series kept to
  // one surface marks every such episode too.
  it("marks an episode that follows a series kept to one surface", () => {
    const { container } = render(
      <EpisodeAvailabilityBadge override="" seriesAvailability="web" />
    );

    expect(container.textContent).toBe("Web only");
  });

  it("marks an episode that narrows a series on both surfaces", () => {
    const { container } = render(
      <EpisodeAvailabilityBadge override="app" seriesAvailability="all" />
    );

    expect(container.textContent).toBe("App only");
  });

  it("marks an episode its series leaves shown nowhere", () => {
    const { container } = render(
      <EpisodeAvailabilityBadge override="app" seriesAvailability="web" />
    );

    expect(container.textContent).toBe("Not shown anywhere");
  });

  it("leaves an episode on both surfaces unmarked", () => {
    const { container } = render(
      <EpisodeAvailabilityBadge override="" seriesAvailability="all" />
    );

    expect(container.textContent).toBe("");
  });
});
