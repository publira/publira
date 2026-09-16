// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { loadPlatformMessages } from "#lib/messages";

import { ClientMessage } from "./client-message";
import { PlatformMessagesContextProvider } from "./platform-messages-context";

describe("ClientMessage", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders from the catalog the provider carries", async () => {
    const messages = loadPlatformMessages("en");

    await act(async () => {
      render(
        <Suspense fallback={null}>
          <PlatformMessagesContextProvider messages={messages}>
            <ClientMessage message="platform.common.retry" />
          </PlatformMessagesContextProvider>
        </Suspense>
      );
      await messages;
    });

    expect(screen.getByText("Retry")).toBeDefined();
  });

  it("throws outside the provider", () => {
    expect(() =>
      render(<ClientMessage message="platform.common.retry" />)
    ).toThrow("PlatformMessagesProvider is required.");
  });
});
