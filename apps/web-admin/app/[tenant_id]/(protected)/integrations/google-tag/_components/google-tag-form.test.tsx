// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type * as ActionForm from "@publira/ui-components/action-form";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import type { TenantAnalyticsSettings } from "#lib/tenant-analytics-settings-shared";

import { GoogleTagForm } from "./google-tag-form";

const { save } = vi.hoisted(() => ({
  save: {
    current: vi.fn(
      (_state: ActionForm.State, _formData: FormData) =>
        Promise.withResolvers<ActionForm.State>().promise
    ),
  },
}));

vi.mock("../_lib/actions", () => ({
  updateGoogleTagAction: (state: ActionForm.State, formData: FormData) =>
    save.current(state, formData),
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

const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
);

const SUBMIT = "Save the Google tag";

const renderForm = async (ui: ReactNode) => {
  await act(() => {
    render(ui, { wrapper: EnglishConsole });
  });
  await screen.findByRole("button", { name: SUBMIT });
};

const submitButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: SUBMIT });

const urlField = () =>
  screen.queryByRole<HTMLInputElement>("textbox", {
    name: /Server container URL/u,
  });

const hiddenValue = (name: string) =>
  document.querySelector<HTMLInputElement>(
    `input[type="hidden"][name="${name}"]`
  )?.value;

const savedSettings = (
  settings: Partial<TenantAnalyticsSettings> = {}
): TenantAnalyticsSettings => ({
  ga4MeasurementId: "G-ABC123",
  gatewayPath: "",
  gtmContainerId: "",
  serverContainerUrl: "",
  servingMode: "google",
  ...settings,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  save.current = vi.fn(
    (_state: ActionForm.State, _formData: FormData) =>
      Promise.withResolvers<ActionForm.State>().promise
  );
});

describe("GoogleTagForm", () => {
  it("starts from the saved IDs and mode, with no URL field for Google's servers", async () => {
    await renderForm(
      <GoogleTagForm
        initialSettings={savedSettings({ gtmContainerId: "GTM-XYZ789" })}
        tenantId="TENANT001"
      />
    );

    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "GA4 measurement ID",
      }).value
    ).toBe("G-ABC123");
    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "Tag Manager container ID",
      }).value
    ).toBe("GTM-XYZ789");
    expect(
      screen.getByRole("radio", { name: "Google" }).getAttribute("aria-checked")
    ).toBe("true");
    expect(hiddenValue("serving_mode")).toBe("google");
    expect(urlField()).toBeNull();
    expect(screen.queryByText("Gateway path")).toBeNull();
  });

  it("asks for the server container URL once that mode is chosen, and keeps it across a switch", async () => {
    await renderForm(
      <GoogleTagForm initialSettings={savedSettings()} tenantId="TENANT001" />
    );

    fireEvent.click(screen.getByRole("radio", { name: "Server container" }));

    const field = await waitFor(() => {
      const input = urlField();
      expect(input).not.toBeNull();
      return input as HTMLInputElement;
    });
    expect(hiddenValue("serving_mode")).toBe("server_container");
    fireEvent.change(field, { target: { value: "https://sgtm.example.com" } });

    fireEvent.click(screen.getByRole("radio", { name: "Google" }));
    await waitFor(() => {
      expect(urlField()).toBeNull();
    });
    fireEvent.click(screen.getByRole("radio", { name: "Server container" }));

    await waitFor(() => {
      expect(urlField()?.value).toBe("https://sgtm.example.com");
    });
  });

  it("shows the gateway path to copy and the tag it is registered against", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await renderForm(
      <GoogleTagForm
        initialSettings={savedSettings({
          gatewayPath: "_abcdefghijklmnop",
          gtmContainerId: "GTM-XYZ789",
          servingMode: "gateway",
        })}
        tenantId="TENANT001"
      />
    );

    expect(screen.getByText("/_abcdefghijklmnop")).toBeDefined();
    // The container is what the gateway forwards for whenever one is set.
    expect(screen.getByText("GTM-XYZ789")).toBeDefined();
    expect(urlField()?.value).toBe("");

    await act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy the gateway path" })
      );
    });
    expect(writeText).toHaveBeenCalledWith("/_abcdefghijklmnop");
  });

  it("regenerates the gateway path only once the operator confirms", async () => {
    // Settled, so the transition does not hold up the tests after this one.
    save.current = vi.fn((_state: ActionForm.State, _formData: FormData) =>
      Promise.resolve<ActionForm.State>({ message: "Saved.", ok: true })
    );
    await renderForm(
      <GoogleTagForm
        initialSettings={savedSettings({
          gatewayPath: "_abcdefghijklmnop",
          servingMode: "gateway",
        })}
        tenantId="TENANT001"
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Generate a new path" })
    );
    expect(save.current).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: "Generate and save" })
      );
    });

    await waitFor(() => {
      expect(save.current).toHaveBeenCalledTimes(1);
    });
    const [, formData] = save.current.mock.calls[0] ?? [];
    expect(formData?.get("regenerate_gateway_path")).toBe("on");
    expect(formData?.get("serving_mode")).toBe("gateway");
  });

  it("says a gateway path comes with the first save in that mode", async () => {
    await renderForm(
      <GoogleTagForm
        initialSettings={savedSettings({ ga4MeasurementId: "" })}
        tenantId="TENANT001"
      />
    );

    fireEvent.click(screen.getByRole("radio", { name: "Google tag gateway" }));

    expect(
      await screen.findByText("A path is generated when you save in this mode.")
    ).toBeDefined();
    expect(
      screen.getByText(
        "Save a Tag Manager container ID or a GA4 measurement ID first."
      )
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Generate a new path" })
    ).toBeNull();
  });

  it("shows a refused value next to its field and keeps what was typed", async () => {
    const refusal =
      "Enter the measurement ID as G- followed by letters and digits, such as G-ABC123DEF4.";
    save.current = vi.fn(() =>
      Promise.resolve<ActionForm.State>({
        fieldErrors: { ga4MeasurementId: refusal },
        message: "Please check the information you entered.",
        ok: false,
      })
    );
    await renderForm(
      <GoogleTagForm initialSettings={savedSettings()} tenantId="TENANT001" />
    );

    const measurementId = screen.getByRole<HTMLInputElement>("textbox", {
      name: "GA4 measurement ID",
    });
    fireEvent.change(measurementId, { target: { value: "G-" } });
    await act(() => {
      fireEvent.click(submitButton());
    });

    await waitFor(() => {
      expect(screen.getByText(refusal)).toBeDefined();
    });
    expect(measurementId.value).toBe("G-");
  });

  it("blocks saving and shows the reason when the read fails", async () => {
    await renderForm(
      <GoogleTagForm
        loadErrorMessage="Could not load the Google tag settings."
        tenantId="TENANT001"
      />
    );

    expect(submitButton().disabled).toBe(true);
    expect(
      screen.getByText("Could not load the Google tag settings.")
    ).toBeDefined();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("tells the operator what to keep out of the console and what to disclose", async () => {
    await renderForm(
      <GoogleTagForm initialSettings={savedSettings()} tenantId="TENANT001" />
    );

    expect(screen.getByText(/advertising pixels/u)).toBeDefined();
    expect(screen.getByText(/counts every page view twice/u)).toBeDefined();
    expect(screen.getByText(/privacy policy page/u)).toBeDefined();
  });
});
