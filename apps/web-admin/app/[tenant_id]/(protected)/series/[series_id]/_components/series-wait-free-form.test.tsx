// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type { FormActionState } from "@publira/ui-components/action-form";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SeriesWaitFreeSettings } from "#lib/series-wait-free-shared";

import { SeriesWaitFreeForm } from "./series-wait-free-form";

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

const storedSettings: SeriesWaitFreeSettings = {
  accessHours: 72,
  enabled: true,
  excludedLatestCount: 3,
  rechargeHours: 23,
};

const renderForm = (
  action: (
    prevState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>,
  initialSettings: SeriesWaitFreeSettings = storedSettings
) =>
  render(
    <SeriesWaitFreeForm
      action={action}
      initialSettings={initialSettings}
      seriesId="018f0e6a-2000-7000-8000-000000000001"
      seriesPublicId="SERIES001"
      tenantId="TENANT001"
    />
  );

const submit = () => {
  fireEvent.click(
    screen.getByRole("button", { name: "Save free-if-you-wait settings" })
  );
};

afterEach(() => {
  cleanup();
});

describe("SeriesWaitFreeForm", () => {
  it("opens on the rule the series holds", () => {
    renderForm(() => Promise.resolve(null));

    expect(
      screen
        .getByRole("switch", { name: "Offer free tickets on this series" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen.getByRole<HTMLInputElement>("spinbutton", {
        name: /Hours until the next ticket/u,
      }).value
    ).toBe("23");
    expect(
      screen.getByRole<HTMLInputElement>("spinbutton", {
        name: /Hours an episode stays open/u,
      }).value
    ).toBe("72");
    expect(
      screen.getByRole<HTMLInputElement>("spinbutton", {
        name: /Newest episodes a ticket cannot open/u,
      }).value
    ).toBe("3");
  });

  it("posts the whole rule with the series it belongs to", async () => {
    const action = vi.fn((_prevState: FormActionState, _formData: FormData) =>
      Promise.resolve<FormActionState>(null)
    );
    renderForm(action);

    submit();

    await waitFor(() => {
      expect(action).toHaveBeenCalledOnce();
    });
    const formData = action.mock.calls[0]?.[1];
    expect(formData?.get("enabled")).toBe("on");
    expect(formData?.get("recharge_hours")).toBe("23");
    expect(formData?.get("access_hours")).toBe("72");
    expect(formData?.get("excluded_latest_count")).toBe("3");
    expect(formData?.get("series_id")).toBe(
      "018f0e6a-2000-7000-8000-000000000001"
    );
    expect(formData?.get("series_public_id")).toBe("SERIES001");
    expect(formData?.get("tenant_id")).toBe("TENANT001");
  });

  // Turning the rule off saves it off and keeps the numbers, which the API
  // stores for the next time it is turned on.
  it("posts no switch value once the rule is turned off", async () => {
    const action = vi.fn((_prevState: FormActionState, _formData: FormData) =>
      Promise.resolve<FormActionState>(null)
    );
    renderForm(action);

    fireEvent.click(
      screen.getByRole("switch", { name: "Offer free tickets on this series" })
    );
    submit();

    await waitFor(() => {
      expect(action).toHaveBeenCalledOnce();
    });
    const formData = action.mock.calls[0]?.[1];
    expect(formData?.get("enabled")).toBeNull();
    expect(formData?.get("recharge_hours")).toBe("23");
  });

  it("names a refused value next to its field and keeps what was typed", async () => {
    renderForm(() =>
      Promise.resolve({
        fieldErrors: {
          rechargeHours: translate(
            "admin.series.wait_free.validation.recharge_hours_invalid",
            { max: "8760" }
          ),
        },
        message: translate("errors.validation"),
        ok: false,
      })
    );
    const rechargeHours = screen.getByRole<HTMLInputElement>("spinbutton", {
      name: /Hours until the next ticket/u,
    });

    fireEvent.change(rechargeHours, { target: { value: "48" } });
    submit();

    expect(
      await screen.findByText(
        "Enter the hours until the next ticket as a whole number from 1 to 8760."
      )
    ).toBeTruthy();
    expect(rechargeHours.value).toBe("48");
  });
});
