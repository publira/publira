// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type * as ActionForm from "@publira/ui-components/action-form";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SeriesFreeAfterSettings } from "#lib/series-free-after-shared";

import { SeriesFreeAfterForm } from "./series-free-after-form";

const translate = bindMessages(sharedCatalog("en"), "en");

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => translate(message, values),
}));

const storedSettings: SeriesFreeAfterSettings = {
  daysAfterPublication: 30,
  enabled: true,
  excludedLatestCount: 2,
};

const renderForm = (
  action: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>,
  initialSettings: SeriesFreeAfterSettings = storedSettings
) =>
  render(
    <SeriesFreeAfterForm
      action={action}
      initialSettings={initialSettings}
      seriesId="018f0e6a-2000-7000-8000-000000000001"
      seriesPublicId="SERIES001"
      tenantId="TENANT001"
    />
  );

const submit = () => {
  fireEvent.click(
    screen.getByRole("button", { name: "Save free-after settings" })
  );
};

afterEach(() => {
  cleanup();
});

describe("SeriesFreeAfterForm", () => {
  it("opens on the rule the series holds", () => {
    renderForm(() => Promise.resolve(null));

    expect(
      screen
        .getByRole("switch", { name: "Make episodes free after publication" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen.getByRole<HTMLInputElement>("spinbutton", {
        name: /Days after publication/u,
      }).value
    ).toBe("30");
    expect(
      screen.getByRole<HTMLInputElement>("spinbutton", {
        name: /Newest episodes that stay priced/u,
      }).value
    ).toBe("2");
  });

  it("says under the form where the periods it adds are listed", () => {
    renderForm(() => Promise.resolve(null));

    expect(
      screen.getByText(
        "The worker opens each episode on its day. The free reading periods it adds appear under the episode's Free reading periods, and cannot be deleted there. Turning the rule off prices those episodes again."
      )
    ).toBeTruthy();
  });

  it("posts the whole rule with the series it belongs to", async () => {
    const action = vi.fn((_prevState: ActionForm.State, _formData: FormData) =>
      Promise.resolve<ActionForm.State>(null)
    );

    renderForm(action);

    submit();

    await waitFor(() => {
      expect(action).toHaveBeenCalledOnce();
    });
    const formData = action.mock.calls[0]?.[1];
    expect(formData?.get("enabled")).toBe("on");
    expect(formData?.get("days_after_publication")).toBe("30");
    expect(formData?.get("excluded_latest_count")).toBe("2");
    expect(formData?.get("series_id")).toBe(
      "018f0e6a-2000-7000-8000-000000000001"
    );
    expect(formData?.get("series_public_id")).toBe("SERIES001");
    expect(formData?.get("tenant_id")).toBe("TENANT001");
  });

  // Turning the rule off saves it off and keeps the numbers, which the API
  // stores for the next time it is turned on.
  it("posts no switch value once the rule is turned off", async () => {
    const action = vi.fn((_prevState: ActionForm.State, _formData: FormData) =>
      Promise.resolve<ActionForm.State>(null)
    );

    renderForm(action);

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Make episodes free after publication",
      })
    );
    submit();

    await waitFor(() => {
      expect(action).toHaveBeenCalledOnce();
    });
    const formData = action.mock.calls[0]?.[1];
    expect(formData?.get("enabled")).toBeNull();
    expect(formData?.get("days_after_publication")).toBe("30");
  });

  it("names a refused value next to its field and keeps what was typed", async () => {
    renderForm(() =>
      Promise.resolve({
        fieldErrors: {
          daysAfterPublication: translate(
            "admin.series.free_after.validation.days_after_publication_invalid",
            { max: "3650" }
          ),
        },
        message: translate("errors.validation"),
        ok: false,
      })
    );

    const daysAfterPublication = screen.getByRole<HTMLInputElement>(
      "spinbutton",
      { name: /Days after publication/u }
    );

    fireEvent.change(daysAfterPublication, { target: { value: "45" } });
    submit();

    expect(
      await screen.findByText(
        "Enter the days after publication as a whole number from 1 to 3650."
      )
    ).toBeTruthy();
    expect(daysAfterPublication.value).toBe("45");
  });
});
