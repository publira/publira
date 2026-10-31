// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import type { KnownCrawler } from "#lib/tenant-crawler-settings-shared";

import type { TenantCrawlerSettingsActionState } from "../settings-types";
import { TenantCrawlerSettingsForm } from "./tenant-crawler-settings-form";

const { save } = vi.hoisted(() => ({
  save: {
    current: Promise.withResolvers<TenantCrawlerSettingsActionState>(),
    formData: undefined as FormData | undefined,
  },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantCrawlerSettingsAction: (_state: unknown, formData: FormData) => {
    save.formData = formData;

    return save.current.promise;
  },
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

const SUBMIT = "Save the crawler exclusions";

const ADMIN_ONLY =
  "Only a tenant administrator can change this setting. You have read-only access.";

const KNOWN_CRAWLERS: KnownCrawler[] = [
  { operator: "OpenAI", purpose: "ai_training", userAgent: "GPTBot" },
  { operator: "Common Crawl", purpose: "ai_training", userAgent: "CCBot" },
  {
    operator: "Perplexity",
    purpose: "ai_assistant",
    userAgent: "PerplexityBot",
  },
  {
    operator: "Google",
    purpose: "image_search",
    userAgent: "Googlebot-Image",
  },
];

const renderForm = (
  props: Partial<Parameters<typeof TenantCrawlerSettingsForm>[0]> = {}
) =>
  render(
    <AdminLocaleTestProvider locale="en">
      <TenantCrawlerSettingsForm
        canEdit
        initialSettings={{
          excludedPaths: ["/drafts", "/members"],
          excludedUserAgents: ["GPTBot"],
        }}
        knownCrawlers={KNOWN_CRAWLERS}
        tenantId="TENANT001"
        {...props}
      />
    </AdminLocaleTestProvider>
  );

const crawlerBox = (userAgent: string) =>
  screen.getByRole("checkbox", { name: userAgent });

const purposeGroup = (label: string) =>
  screen.getByRole("group", { name: label });

/** The list's fields, in order. */
const pathFields = () =>
  screen.getAllByRole<HTMLInputElement>("textbox", { name: /^Path \d+$/u });

const pathField = (position: number) =>
  screen.getByRole<HTMLInputElement>("textbox", { name: `Path ${position}` });

const pathValues = () => pathFields().map((field) => field.value);

const addButton = () => screen.getByRole("button", { name: "Add a path" });

const submitButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: SUBMIT });

// A control inside a disabled fieldset keeps its own `disabled` property false.
const isDisabled = (element: HTMLElement) =>
  element.matches(":disabled") ||
  element.getAttribute("aria-disabled") === "true" ||
  Object.hasOwn(element.dataset, "disabled");

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  save.current.resolve(null);
  save.current = Promise.withResolvers<TenantCrawlerSettingsActionState>();
  save.formData = undefined;
});

describe("TenantCrawlerSettingsForm", () => {
  it("opens on the saved crawlers ticked, grouped by purpose, and one field per path", () => {
    renderForm();

    expect(
      within(purposeGroup("AI training"))
        .getAllByRole("checkbox")
        .map((box) => box.getAttribute("aria-checked"))
    ).toEqual(["true", "false"]);
    expect(
      within(purposeGroup("AI assistants")).getByRole("checkbox", {
        name: "PerplexityBot",
      })
    ).toBeTruthy();
    expect(
      within(purposeGroup("Image search")).getByRole("checkbox", {
        name: "Googlebot-Image",
      })
    ).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Other crawlers" })).toBeNull();
    expect(screen.getByText("Run by Common Crawl")).toBeTruthy();
    expect(pathValues()).toEqual(["/drafts", "/members"]);
    expect(submitButton().disabled).toBe(false);
  });

  it("opens one empty field for a tenant that excludes no path", () => {
    renderForm({
      initialSettings: { excludedPaths: [], excludedUserAgents: [] },
    });

    expect(pathValues()).toEqual([""]);
  });

  it("offers a crawler of a purpose it has no words for among the others", () => {
    renderForm({
      knownCrawlers: [
        ...KNOWN_CRAWLERS,
        { operator: "Example", purpose: "other", userAgent: "ExampleBot" },
      ],
    });

    expect(
      within(purposeGroup("Other crawlers")).getByRole("checkbox", {
        name: "ExampleBot",
      })
    ).toBeTruthy();
  });

  it("shows the saved exclusions read-only to an operator who is not an administrator", () => {
    renderForm({ canEdit: false });

    expect(screen.getByText(ADMIN_ONLY)).toBeTruthy();
    expect(crawlerBox("GPTBot").getAttribute("aria-checked")).toBe("true");
    expect(isDisabled(crawlerBox("GPTBot"))).toBe(true);
    expect(pathValues()).toEqual(["/drafts", "/members"]);
    expect(isDisabled(pathField(1))).toBe(true);
    expect(isDisabled(addButton())).toBe(true);
    expect(submitButton().disabled).toBe(true);
  });

  // A save replaces both lists, so one sent without the stored lists would
  // empty them.
  it("closes every control while the stored setting could not be read", () => {
    renderForm({
      initialSettings: undefined,
      knownCrawlers: undefined,
      loadErrorMessage:
        "Could not load the crawler exclusions. Please try again later.",
    });

    expect(
      screen.getByText(
        "Could not load the crawler exclusions. Please try again later."
      )
    ).toBeTruthy();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(isDisabled(pathField(1))).toBe(true);
    expect(submitButton().disabled).toBe(true);
  });

  it("names a path the server would refuse once its field is left", () => {
    renderForm();

    const refusal =
      '"/sitemap.xml" cannot be excluded, since crawlers need robots.txt and the sitemap to read the site.';

    fireEvent.change(pathField(2), { target: { value: "/sitemap.xml" } });
    expect(screen.queryByText(refusal)).toBeNull();

    fireEvent.focusOut(pathField(2));

    expect(screen.getByText(refusal)).toBeTruthy();
    expect(pathField(2).getAttribute("aria-invalid")).toBe("true");
    expect(pathField(1).getAttribute("aria-invalid")).toBeNull();

    fireEvent.change(pathField(2), { target: { value: "/members/" } });

    expect(screen.queryByText(refusal)).toBeNull();
  });

  it("submits the ticked crawlers and one path per field, and then shows the paths as stored", async () => {
    renderForm({
      initialSettings: { excludedPaths: [], excludedUserAgents: ["GPTBot"] },
    });

    fireEvent.click(crawlerBox("GPTBot"));
    fireEvent.click(crawlerBox("CCBot"));
    fireEvent.click(crawlerBox("Googlebot-Image"));
    fireEvent.change(pathField(1), { target: { value: " /members/ " } });
    fireEvent.click(addButton());
    fireEvent.change(pathField(2), { target: { value: "/drafts" } });
    fireEvent.click(submitButton());

    await waitFor(() => {
      expect(save.formData).toBeDefined();
    });
    expect(save.formData?.getAll("excluded_user_agents")).toEqual([
      "CCBot",
      "Googlebot-Image",
    ]);
    expect(save.formData?.getAll("excluded_paths")).toEqual([
      " /members/ ",
      "/drafts",
    ]);

    save.current.resolve({
      message: "The crawler exclusions were saved.",
      ok: true,
      settings: {
        excludedPaths: ["/drafts", "/members"],
        excludedUserAgents: ["CCBot", "Googlebot-Image"],
      },
    });

    await waitFor(() => {
      expect(pathValues()).toEqual(["/drafts", "/members"]);
    });
    expect(crawlerBox("GPTBot").getAttribute("aria-checked")).toBe("false");
    expect(crawlerBox("CCBot").getAttribute("aria-checked")).toBe("true");
    expect(
      await screen.findByText("The crawler exclusions were saved.")
    ).toBeTruthy();
  });

  it("shows the refusal of a crawler beside the checklist and keeps what was chosen", async () => {
    renderForm();

    fireEvent.click(crawlerBox("CCBot"));
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(save.formData).toBeDefined();
    });

    const refusal =
      "CCBot can no longer be excluded. Reload the page and choose again.";

    save.current.resolve({
      fieldErrors: { excludedUserAgents: refusal },
      message: refusal,
      ok: false,
    });

    await waitFor(() => {
      expect(screen.getAllByText(refusal).length).toBeGreaterThan(0);
    });
    expect(crawlerBox("CCBot").getAttribute("aria-checked")).toBe("true");
    expect(pathValues()).toEqual(["/drafts", "/members"]);
  });
});
