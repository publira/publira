import { describe, expect, it } from "vitest";

import {
  SECRET_UPDATE_MODE_CLEAR,
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
} from "./email-settings-shared";
import { toProviderCredentialUpdates } from "./provider-credential-form";

const formData = (values: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }
  return data;
};

const fields = [
  { name: "api_key", required: true },
  { name: "signing_key", required: false },
];

const options = { enabled: true, requiredMessage: "Required." };

describe("toProviderCredentialUpdates", () => {
  it("turns what the form did to each field into the API's update modes", () => {
    expect(
      toProviderCredentialUpdates(
        formData({
          credential_api_key: "  new-key  ",
          credential_api_key_mode: "replace",
          credential_signing_key_configured: "1",
          credential_signing_key_mode: "clear",
        }),
        fields,
        options
      )
    ).toEqual({
      fields: [
        { mode: SECRET_UPDATE_MODE_REPLACE, name: "api_key", value: "new-key" },
        { mode: SECRET_UPDATE_MODE_CLEAR, name: "signing_key", value: "" },
      ],
      ok: true,
    });
  });

  it("leaves a stored value as it is when a replace enters nothing", () => {
    expect(
      toProviderCredentialUpdates(
        formData({
          credential_api_key_configured: "1",
          credential_api_key_mode: "replace",
          credential_signing_key_mode: "replace",
        }),
        fields,
        options
      )
    ).toEqual({
      fields: [
        { mode: SECRET_UPDATE_MODE_UNCHANGED, name: "api_key", value: "" },
        { mode: SECRET_UPDATE_MODE_UNCHANGED, name: "signing_key", value: "" },
      ],
      ok: true,
    });
  });

  it("names every required field that would be missing once turned on", () => {
    const data = formData({
      credential_api_key_mode: "replace",
      credential_signing_key_mode: "replace",
    });

    expect(toProviderCredentialUpdates(data, fields, options)).toEqual({
      fieldErrors: { credential_api_key: "Required." },
      ok: false,
    });
    expect(
      toProviderCredentialUpdates(data, fields, { ...options, enabled: false })
        .ok
    ).toBe(true);
  });

  it("refuses a form that posts a field in a shape it could not have", () => {
    expect(
      toProviderCredentialUpdates(
        formData({
          credential_api_key_mode: "overwrite",
          credential_signing_key_mode: "keep",
        }),
        fields,
        options
      )
    ).toEqual({ ok: false });
  });
});
