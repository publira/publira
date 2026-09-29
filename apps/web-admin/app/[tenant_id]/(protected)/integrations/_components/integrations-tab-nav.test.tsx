// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IntegrationsTabNav } from "./integrations-tab-nav";

vi.mock("#components/message", () => ({
  Message: ({ message }: { message: MessageKey<SharedMessages> }) =>
    bindMessages(sharedCatalog("en"))(message),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("IntegrationsTabNav", () => {
  it("lists the outside services a tenant connects to, each at its own path", () => {
    render(<IntegrationsTabNav current="email" />);

    expect(
      screen
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")])
    ).toEqual([
      ["Email", "/integrations/email"],
      ["Payments", "/integrations/payment"],
      ["Mobile push", "/integrations/mobile-push"],
      ["App links", "/integrations/app-links"],
    ]);
  });
});
