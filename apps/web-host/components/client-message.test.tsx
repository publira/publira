// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { loadHostClientMessages } from "#lib/messages";

import { ClientMessage } from "./client-message";
import { HostMessagesContextProvider } from "./host-messages-context";

describe("ClientMessage", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders from the catalog the provider carries", async () => {
    const messages = loadHostClientMessages("en");

    await act(async () => {
      render(
        <Suspense fallback={null}>
          <HostMessagesContextProvider messages={messages}>
            <ClientMessage message="host.common.retry" />
          </HostMessagesContextProvider>
        </Suspense>
      );
      await messages;
    });

    expect(screen.getByText("Try again")).toBeDefined();
  });

  it("throws outside the provider", () => {
    expect(() => render(<ClientMessage message="host.common.retry" />)).toThrow(
      "HostMessagesProvider is required."
    );
  });
});

describe("loadHostClientMessages", () => {
  it("carries the host namespace alone", async () => {
    const messages = await loadHostClientMessages("en");

    expect(Object.keys(messages)).toEqual(["host"]);
  });
});
