// @vitest-environment jsdom

import { setTimeout as sleep } from "node:timers/promises";

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";

import type {
  AnnouncementItem,
  CreateAnnouncementActionState,
} from "../announcement-types";
import { AnnouncementForm } from "./announcement-form";

type CreateAnnouncementAction = (
  state: CreateAnnouncementActionState,
  formData: FormData
) => Promise<CreateAnnouncementActionState>;

const { mockCountAudience } = vi.hoisted(() => ({
  mockCountAudience: vi.fn(),
}));

vi.mock("../_lib/actions", () => ({
  countAnnouncementAudienceAction: mockCountAudience,
}));

vi.mock("@publira/ui-components/combobox", async () => {
  const { Input } = await import("@publira/ui-components/input");

  return {
    // The mocked root stands in for the whole control, so its slots render
    // nothing, and typing a value picks it.
    Empty: () => null,
    Input: () => null,
    Items: () => null,
    Popup: () => null,
    Root: ({
      onValueChange,
      value,
    }: {
      onValueChange: (next: string) => void;
      value: string;
    }) => (
      <Input
        onChange={(event) => onValueChange(event.target.value)}
        value={value}
      />
    ),
  };
});

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

vi.mock("#lib/get-messages", () => ({
  getMessages: () => Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
}));

const render = (ui: ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
    ),
  });

/** The form with nothing to pick from, unless a test says otherwise. */
const renderForm = async (
  props: Partial<Parameters<typeof AnnouncementForm>[0]> = {}
) =>
  render(
    await AnnouncementForm({
      action: vi.fn(),
      plans: [],
      series: [{ publicId: "SERIES001", title: "Night Train" }],
      tenantId: "TENANT001",
      tenantLocales: { defaultLocale: "en", supportedLocales: ["en", "ja"] },
      timeZone: "UTC",
      ...props,
    })
  );

/**
 * Whether a control refuses input, whichever way it says so. A native control
 * its `<fieldset>` closes keeps `disabled` false and matches `:disabled`, and
 * the banner checkbox is a Base UI one that says so with `aria-disabled`.
 */
const isClosed = (element: HTMLElement) =>
  element.matches(":disabled") ||
  element.getAttribute("aria-disabled") === "true";

beforeEach(() => {
  mockCountAudience.mockResolvedValue({ ok: true, readerCount: 3 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const submittedControls = () => [
  screen.getByRole("textbox", { name: /Title/u }),
  screen.getByRole("textbox", { name: /Body/u }),
  screen.getByRole("textbox", { name: "Link" }),
  screen.getByRole("checkbox", { name: "Send to everyone" }),
  screen.getByRole("checkbox", { name: "Show as a site banner" }),
];

const fillIn = () => {
  fireEvent.change(screen.getByRole("textbox", { name: /Title/u }), {
    target: { value: "Maintenance tonight" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: /Body/u }), {
    target: { value: "The site is down from 22:00 to 23:00 UTC." },
  });
};

/** Pick one option of the Select whose trigger `trigger` is. */
const pickOption = async (trigger: HTMLElement, name: string) => {
  fireEvent.click(trigger);
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.keyDown(await screen.findByRole("option", { name }), {
    key: "Enter",
  });
};

/** Choose the targeted audience and add one condition from the select. */
const addCondition = async (name: string) => {
  fireEvent.click(
    screen.getByRole("radio", {
      name: "Readers who match all of these conditions",
    })
  );
  await pickOption(
    await screen.findByRole("combobox", { name: "Add a condition" }),
    name
  );
  await screen.findByRole("group", { name });
};

const submit = async (
  action: Mock<CreateAnnouncementAction>,
  label: string
): Promise<FormData> => {
  fireEvent.click(screen.getByRole("button", { name: label }));

  await waitFor(() => {
    expect(action).toHaveBeenCalledOnce();
  });

  const formData = action.mock.calls[0]?.[1];

  if (!formData) {
    throw new Error("the Action was called without the form's fields");
  }

  return formData;
};

const sendToEveryoneCheckbox = () =>
  screen.getByRole("checkbox", { name: "Send to everyone" });

const bannerCheckbox = () =>
  screen.getByRole("checkbox", { name: "Show as a site banner" });

describe("AnnouncementForm", () => {
  // The Action carries what the form held when it was submitted, so a change
  // made while it is in flight would not be the announcement that goes out.
  it("closes every field while the delivery is in flight", async () => {
    // Never resolved: the assertions are about the window the save is open in.
    const delivery = Promise.withResolvers<CreateAnnouncementActionState>();
    const pendingAction = vi.fn(() => delivery.promise);

    await renderForm({ action: pendingAction, tenantLocales: null });
    fillIn();

    for (const control of submittedControls()) {
      expect(isClosed(control)).toBe(false);
    }

    fireEvent.click(
      screen.getByRole("button", { name: "Deliver the announcement" })
    );

    await waitFor(() => {
      for (const control of submittedControls()) {
        expect(isClosed(control)).toBe(true);
      }
    });
  });

  it("posts the banner's stop time as an instant in the tenant's zone", async () => {
    const action = vi.fn<CreateAnnouncementAction>(() =>
      Promise.resolve<CreateAnnouncementActionState>(null)
    );

    const { container } = await renderForm({
      action,
      tenantLocales: null,
      timeZone: "Asia/Tokyo",
    });

    fillIn();

    expect(container.querySelector("input[name='pinned_until']")).toBeNull();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show as a site banner" })
    );

    const pinnedUntil = container.querySelector(
      "input[name='pinned_until_local']"
    );

    if (!pinnedUntil) {
      throw new Error("the banner's stop time is not on screen");
    }

    fireEvent.change(pinnedUntil, { target: { value: "2099-06-01T09:00" } });
    const formData = await submit(action, "Deliver the announcement");

    expect(formData.get("tenant_id")).toBe("TENANT001");
    expect(formData.get("pinned")).toBe("on");
    expect(formData.get("pinned_until")).toBe("2099-06-01T00:00:00Z");
  });

  it.each([
    [true, "everyone"],
    [false, null],
  ])(
    "posts the delivery the Send to everyone checkbox asks for: %s",
    async (checked, delivery) => {
      const action = vi.fn<CreateAnnouncementAction>(() =>
        Promise.resolve<CreateAnnouncementActionState>(null)
      );

      await renderForm({ action, tenantLocales: null });
      fillIn();

      const checkbox = screen.getByRole("checkbox", {
        name: "Send to everyone",
      });

      // Off unless the editor turns it on.
      expect(checkbox.getAttribute("aria-checked")).toBe("false");

      if (checked) {
        fireEvent.click(checkbox);
      }

      const formData = await submit(action, "Deliver the announcement");

      expect(formData.get("delivery")).toBe(delivery);
    }
  );

  it("shows a tab for each language the site offers and none for another", async () => {
    await renderForm();

    const tabs = within(screen.getByRole("tablist", { name: "Languages" }));
    expect(tabs.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "English",
      "日本語",
    ]);
    expect(tabs.queryByRole("tab", { name: "한국어" })).toBeNull();
    // The default language's tab is open, and only its fields are required.
    expect(
      tabs.getByRole("tab", { name: "English" }).getAttribute("aria-selected")
    ).toBe("true");
    expect(
      screen.getByRole("textbox", { name: /Title/u }).hasAttribute("required")
    ).toBe(true);

    fireEvent.click(tabs.getByRole("tab", { name: "日本語" }));

    expect(
      screen.getByRole("textbox", { name: /Title/u }).hasAttribute("required")
    ).toBe(false);
  });

  it("posts every language's title and body in one submission", async () => {
    const action = vi.fn<CreateAnnouncementAction>(() =>
      Promise.resolve<CreateAnnouncementActionState>(null)
    );

    await renderForm({
      action,
      tenantLocales: { defaultLocale: "ja", supportedLocales: ["en", "ja"] },
    });
    // The default language's tab opens first, wherever it sits in the row.
    fillIn();
    fireEvent.click(screen.getByRole("tab", { name: "English" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Title/u }), {
      target: { value: "Maintenance tonight (English)" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Body/u }), {
      target: { value: "Down from 22:00 to 23:00 UTC (English)." },
    });
    const formData = await submit(action, "Deliver the announcement");

    // The tabs post in the row's order, the default language's with an empty
    // locale.
    expect(formData.getAll("translation_locale")).toEqual(["en", ""]);
    expect(formData.getAll("title")).toEqual([
      "Maintenance tonight (English)",
      "Maintenance tonight",
    ]);
    expect(formData.getAll("body")).toEqual([
      "Down from 22:00 to 23:00 UTC (English).",
      "The site is down from 22:00 to 23:00 UTC.",
    ]);
  });

  it("opens the default language's tab when its title is missing", async () => {
    const action = vi.fn<CreateAnnouncementAction>(() =>
      Promise.resolve<CreateAnnouncementActionState>(null)
    );

    await renderForm({ action });
    fireEvent.click(screen.getByRole("tab", { name: "日本語" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Title/u }), {
      target: { value: "Japanese title" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Deliver the announcement" })
    );

    await waitFor(() => {
      expect(
        screen
          .getByRole("tab", { name: "English" })
          .getAttribute("aria-selected")
      ).toBe("true");
    });
    expect(action).not.toHaveBeenCalled();
  });
});

describe("AnnouncementForm audience", () => {
  it("is addressed to everyone until the targeted choice is made", async () => {
    await renderForm();

    expect(
      screen
        .getByRole("radio", { name: "Everyone who opens the site" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen.queryByRole("combobox", { name: "Add a condition" })
    ).toBeNull();
  });

  it("closes Send to everyone and the banner while a condition is on, and opens them once none is", async () => {
    await renderForm();

    const sendToEveryone = sendToEveryoneCheckbox;
    const banner = bannerCheckbox;

    fireEvent.click(sendToEveryone());
    fireEvent.click(banner());

    await addCondition("Has never bought anything");

    expect(isClosed(sendToEveryone())).toBe(true);
    expect(sendToEveryone().getAttribute("aria-checked")).toBe("false");
    expect(isClosed(banner())).toBe(true);
    expect(banner().getAttribute("aria-checked")).toBe("false");
    expect(
      screen.getByText(
        "A targeted announcement reaches only its readers' notifications, so it cannot be sent to everyone or shown as a site banner."
      )
    ).toBeDefined();

    fireEvent.click(
      within(
        screen.getByRole("group", { name: "Has never bought anything" })
      ).getByRole("button", { name: "Remove" })
    );

    await waitFor(() => {
      expect(isClosed(sendToEveryone())).toBe(false);
    });
    expect(isClosed(banner())).toBe(false);
  });

  it("offers a condition already on the audience no more", async () => {
    await renderForm();
    await addCondition("Has never bought anything");

    const add = screen.getByRole("combobox", { name: "Add a condition" });
    fireEvent.click(add);
    fireEvent.keyDown(add, { key: "ArrowDown" });

    expect(
      await screen.findByRole("option", { name: "Follows series" })
    ).toBeDefined();
    expect(
      screen.queryByRole("option", { name: "Has never bought anything" })
    ).toBeNull();
  });

  it("posts each condition with the inputs of its row", async () => {
    const action = vi.fn<CreateAnnouncementAction>(() =>
      Promise.resolve<CreateAnnouncementActionState>(null)
    );

    await renderForm({ action });
    fillIn();
    await addCondition("Follows series");

    // The stand-in Combobox is a text box that picks what is typed into it.
    const series = within(
      screen.getByRole("group", { name: "Follows series" })
    ).getByRole("textbox");

    fireEvent.change(series, { target: { value: "SERIES001" } });

    await addCondition("Language");
    await pickOption(
      within(screen.getByRole("group", { name: "Language" })).getByRole(
        "combobox"
      ),
      "日本語"
    );

    await addCondition("Has not read for");
    fireEvent.change(
      within(screen.getByRole("group", { name: "Has not read for" })).getByRole(
        "spinbutton",
        { name: /Days/u }
      ),
      { target: { value: "30" } }
    );

    const formData = await submit(action, "Deliver the announcement");

    expect(formData.get("audience")).toBe("targeted");
    expect(formData.getAll("audience_condition")).toEqual([
      "follows_series",
      "locale",
      "last_read_days_ago",
    ]);
    expect(formData.get("audience_follows_series_series")).toBe("SERIES001");
    expect(formData.get("audience_locale_locale")).toBe("ja");
    expect(formData.get("audience_last_read_days_ago_days")).toBe("30");
  });

  it("refuses a day count of 0 in the browser before the Action runs", async () => {
    const action = vi.fn<CreateAnnouncementAction>(() =>
      Promise.resolve<CreateAnnouncementActionState>(null)
    );

    await renderForm({ action });
    fillIn();
    await addCondition("Signed up within");

    const days = within(
      screen.getByRole("group", { name: "Signed up within" })
    ).getByRole<HTMLInputElement>("spinbutton", { name: /Days/u });

    fireEvent.change(days, { target: { value: "0" } });

    expect(days.validity.rangeUnderflow).toBe(true);
    expect(days.min).toBe("1");
    expect(days.max).toBe("3650");
  });

  it("shows how many readers the conditions reach once they are filled in", async () => {
    await renderForm();
    await addCondition("Has the app's push notifications registered");

    expect(await screen.findByText("Reaches 3 readers")).toBeDefined();
    expect(mockCountAudience).toHaveBeenCalledWith({
      conditions: [{ type: "has_mobile_push_device" }],
      tenantId: "TENANT001",
    });
  });

  it("counts nothing while a condition is still unfilled", async () => {
    await renderForm();
    await addCondition("Follows series");

    // Longer than the count waits for the conditions to settle.
    await sleep(600);

    expect(mockCountAudience).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says when the reach could not be counted", async () => {
    mockCountAudience.mockResolvedValue({ ok: false });

    await renderForm();
    await addCondition("Has never bought anything");

    expect(
      await screen.findByText(
        "Could not count the readers. The announcement can still go out."
      )
    ).toBeDefined();
  });

  it("says why no plan can be named beside the plan select", async () => {
    await renderForm({
      plansErrorMessage:
        "Only a tenant admin can see the plans, so this condition matches a subscription to any plan.",
    });
    await addCondition("Subscription");

    expect(
      screen.getByText(
        "Only a tenant admin can see the plans, so this condition matches a subscription to any plan."
      )
    ).toBeDefined();
  });
});

describe("AnnouncementForm schedule", () => {
  it("names the submission after the delivery time", async () => {
    const action = vi.fn<CreateAnnouncementAction>(() =>
      Promise.resolve<CreateAnnouncementActionState>(null)
    );

    const { container } = await renderForm({ action, timeZone: "Asia/Tokyo" });
    fillIn();

    const deliverAt = container.querySelector("input[name='deliver_at_local']");

    if (!deliverAt) {
      throw new Error("the delivery time is not on screen");
    }

    fireEvent.change(deliverAt, { target: { value: "2099-06-01T09:00" } });

    expect(
      screen.getByRole("button", { name: "Schedule the announcement" })
    ).toBeDefined();

    // Cleared, it goes out on submission again.
    fireEvent.change(deliverAt, { target: { value: "" } });

    expect(
      screen.getByRole("button", { name: "Deliver the announcement" })
    ).toBeDefined();

    fireEvent.change(deliverAt, { target: { value: "2099-06-01T09:00" } });
    const formData = await submit(action, "Schedule the announcement");

    expect(formData.get("deliver_at")).toBe("2099-06-01T00:00:00Z");
  });
});

describe("AnnouncementForm on a scheduled announcement", () => {
  const scheduled: AnnouncementItem = {
    audience: [{ seriesPublicId: "SERIES001", type: "follows_series" }],
    body: "A new chapter goes out on Monday.",
    createdAt: "2099-05-29T00:00:00Z",
    deliverAt: "2099-06-01T00:00:00Z",
    deliveredAt: "",
    deliveredCount: 0,
    delivery: "preferred",
    id: "018f0f90-0001-7000-8000-000000000101",
    linkUrl: "/series/SERIES001",
    openedCount: 0,
    pinned: false,
    pinnedUntil: "",
    title: "Coming on Monday",
    translatedLocales: ["en"],
    translations: [
      {
        body: "A new chapter goes out on Monday.",
        locale: "en",
        title: "Coming on Monday",
      },
    ],
  };

  it("opens with what the announcement holds and saves it under its id", async () => {
    const action = vi.fn<CreateAnnouncementAction>(() =>
      Promise.resolve<CreateAnnouncementActionState>(null)
    );

    await renderForm({ action, announcement: scheduled });

    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: /Title/u }).value
    ).toBe("Coming on Monday");
    expect(
      screen
        .getByRole("radio", {
          name: "Readers who match all of these conditions",
        })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(screen.getByRole("group", { name: "Follows series" })).toBeDefined();
    expect(
      isClosed(screen.getByRole("checkbox", { name: "Send to everyone" }))
    ).toBe(true);

    const formData = await submit(action, "Save");

    expect(formData.get("announcement_id")).toBe(scheduled.id);
    expect(formData.get("deliver_at")).toBe("2099-06-01T00:00:00Z");
    expect(formData.get("audience_follows_series_series")).toBe("SERIES001");
  });
});
