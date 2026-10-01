// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type { FormActionState } from "@publira/ui-components/action-form";
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
import type { TenantSignInSettings } from "#lib/tenant-sign-in-settings";

import { TenantSignInSettingsForm } from "./tenant-sign-in-settings-form";

const { action } = vi.hoisted(() => ({
  action: {
    current: (): Promise<FormActionState> => Promise.resolve(null),
  },
}));

vi.mock("../_lib/actions", () => ({
  updateTenantSignInSettingsAction: () => action.current(),
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"))(message, values),
}));

const WEB_CLIENT_ID = "123456789012-abc123.apps.googleusercontent.com";

const unsetSettings: TenantSignInSettings = {
  apple: {
    bundleIdentifier: "",
    enabled: false,
    keyId: "",
    privateKeyConfigured: false,
    privateKeyHint: "",
    ready: false,
    servicesId: "",
    teamId: "",
  },
  google: {
    enabled: false,
    iosClientId: "",
    ready: false,
    webClientId: "",
  },
};

const savedSettings: TenantSignInSettings = {
  apple: {
    bundleIdentifier: "com.example.reader",
    enabled: true,
    keyId: "2X9R4HXF34",
    privateKeyConfigured: true,
    privateKeyHint: "••••••••wIBAQQg",
    ready: true,
    servicesId: "com.example.web",
    teamId: "ABCDE12345",
  },
  google: {
    enabled: false,
    iosClientId: "",
    ready: false,
    webClientId: WEB_CLIENT_ID,
  },
};

const EnglishConsole = ({ children }: { children: ReactNode }) => (
  <AdminLocaleTestProvider locale="en">{children}</AdminLocaleTestProvider>
);

const renderForm = async (ui: ReactNode) => {
  await act(() => {
    render(ui, { wrapper: EnglishConsole });
  });
};

const submitButton = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Save the sign-in providers",
  });

const posted = (name: string) => {
  const { form } = submitButton();
  if (!form) {
    throw new Error("the save button belongs to no form");
  }
  return new FormData(form).get(name);
};

const textbox = (name: RegExp | string) =>
  screen.getByRole<HTMLInputElement>("textbox", { name });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  action.current = () => Promise.resolve(null);
});

describe("TenantSignInSettingsForm", () => {
  it("asks for the Apple key as a file or pasted text where none is stored", async () => {
    await renderForm(
      <TenantSignInSettingsForm
        canEdit
        initialSettings={unsetSettings}
        tenantId="TENANT001"
      />
    );

    expect(
      document.querySelector(
        'input[type="file"][name="apple_private_key_file"]'
      )
    ).not.toBeNull();
    expect(textbox("Or paste the contents").getAttribute("name")).toBe(
      "apple_private_key"
    );
    expect(posted("apple_private_key_mode")).toBe("replace");
    // The iOS bundle ID is edited under App links, and none is named there.
    expect(screen.queryByRole("textbox", { name: "iOS bundle ID" })).toBeNull();
    expect(screen.getAllByText("Not set").length).toBeGreaterThan(0);
  });

  it("shows what is saved, the key only as its mask, and each provider's state", async () => {
    await renderForm(
      <TenantSignInSettingsForm
        canEdit
        initialSettings={savedSettings}
        tenantId="TENANT001"
      />
    );

    expect(textbox("Private key (.p8)").value).toBe("••••••••wIBAQQg");
    expect(textbox("Services ID").value).toBe("com.example.web");
    expect(textbox(/Team ID/u).value).toBe("ABCDE12345");
    expect(textbox(/Key ID/u).value).toBe("2X9R4HXF34");
    expect(textbox("Web client ID").value).toBe(WEB_CLIENT_ID);
    expect(textbox("iOS bundle ID").value).toBe("com.example.reader");
    expect(textbox("iOS bundle ID").readOnly).toBe(true);
    expect(posted("apple_private_key_mode")).toBe("keep");
    expect(posted("apple_private_key_configured")).toBe("1");
    expect(screen.getByText("Offered")).toBeDefined();
    expect(screen.getByText("Off")).toBeDefined();
  });

  it("posts a removal until the operator keeps the key again", async () => {
    await renderForm(
      <TenantSignInSettingsForm
        canEdit
        initialSettings={savedSettings}
        tenantId="TENANT001"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(posted("apple_private_key_mode")).toBe("clear");
    expect(
      screen.getByText("The stored key is removed when you save.")
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Keep the key" }));
    expect(posted("apple_private_key_mode")).toBe("keep");
  });

  it("posts each provider's switch as the operator leaves it", async () => {
    await renderForm(
      <TenantSignInSettingsForm
        canEdit
        initialSettings={savedSettings}
        tenantId="TENANT001"
      />
    );

    expect(posted("apple_enabled")).toBe("on");
    expect(posted("google_enabled")).toBeNull();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Offer Sign in with Apple" })
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Offer Sign in with Google" })
    );

    expect(posted("apple_enabled")).toBeNull();
    expect(posted("google_enabled")).toBe("on");
    // Switched off, a provider still posts its fields, so the save keeps them.
    expect(posted("apple_team_id")).toBe("ABCDE12345");
  });

  it("keeps the value typed and names the refused field beside it", async () => {
    const refusal =
      "Enter a client ID ending in .apps.googleusercontent.com, as the Google Cloud console shows it.";
    action.current = vi.fn((): Promise<FormActionState> =>
      Promise.resolve({
        fieldErrors: { iosClientId: refusal },
        message: "Please check the information you entered.",
        ok: false,
      })
    );
    await renderForm(
      <TenantSignInSettingsForm
        canEdit
        initialSettings={savedSettings}
        tenantId="TENANT001"
      />
    );

    fireEvent.change(textbox("iOS client ID"), {
      target: { value: "ios.example.com" },
    });
    await act(() => {
      fireEvent.click(submitButton());
    });

    await waitFor(() => {
      expect(screen.getByText(refusal)).toBeDefined();
    });
    expect(textbox("iOS client ID").value).toBe("ios.example.com");
  });

  it("shows each provider the callback URL to register, copyable without edit access", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await renderForm(
      <TenantSignInSettingsForm
        callbackUrls={{
          apple: "https://comics.example/api/v1/auth/apple/callback",
          google: "https://comics.example/api/v1/auth/google/callback",
        }}
        canEdit={false}
        initialSettings={savedSettings}
        tenantId="TENANT001"
      />
    );

    expect(
      screen.getByText("https://comics.example/api/v1/auth/apple/callback")
    ).toBeDefined();
    expect(
      screen.getByText("https://comics.example/api/v1/auth/google/callback")
    ).toBeDefined();

    const [appleCopy, googleCopy] = screen.getAllByRole<HTMLButtonElement>(
      "button",
      { name: "Copy the callback URL" }
    );
    expect(appleCopy?.matches(":disabled")).toBe(false);
    await act(() => {
      fireEvent.click(googleCopy as HTMLButtonElement);
    });
    expect(writeText).toHaveBeenCalledWith(
      "https://comics.example/api/v1/auth/google/callback"
    );
  });

  it("leaves the callback URL out while the tenant has no domain", async () => {
    await renderForm(
      <TenantSignInSettingsForm
        canEdit
        initialSettings={savedSettings}
        tenantId="TENANT001"
      />
    );

    expect(
      screen.queryByRole("button", { name: "Copy the callback URL" })
    ).toBeNull();
  });

  it("keeps saving closed when the settings could not be read", async () => {
    await renderForm(
      <TenantSignInSettingsForm
        canEdit
        loadErrorMessage="Could not load the sign-in providers. Please try again later."
        tenantId="TENANT001"
      />
    );

    expect(
      screen.getByText(
        "Could not load the sign-in providers. Please try again later."
      )
    ).toBeDefined();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(submitButton().disabled).toBe(true);
  });

  it("leaves the settings read-only for an operator who is not an admin", async () => {
    await renderForm(
      <TenantSignInSettingsForm
        canEdit={false}
        initialSettings={savedSettings}
        tenantId="TENANT001"
      />
    );

    expect(textbox("Services ID").matches(":disabled")).toBe(true);
    expect(
      screen
        .getByRole<HTMLButtonElement>("button", { name: "Replace" })
        .matches(":disabled")
    ).toBe(true);
    // The provider switches are Base UI checkboxes, which say so with
    // `aria-disabled` instead.
    for (const provider of [
      "Offer Sign in with Apple",
      "Offer Sign in with Google",
    ]) {
      expect(
        screen
          .getByRole("checkbox", { name: provider })
          .getAttribute("aria-disabled")
      ).toBe("true");
    }
    expect(
      screen.getByText(
        "Only a tenant administrator can change this setting. You have read-only access."
      )
    ).toBeDefined();
    expect(submitButton().disabled).toBe(true);
  });
});
