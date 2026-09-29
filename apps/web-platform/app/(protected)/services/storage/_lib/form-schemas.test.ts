import { toFormDataInput } from "@publira/utils/form-data";
import { describe, expect, it } from "vitest";

import {
  STORAGE_SECRET_CLEAR,
  STORAGE_SECRET_REPLACE,
  STORAGE_SECRET_UNCHANGED,
} from "#lib/storage-settings-shared";

import { storageFormFields, storageFormSchema } from "./form-schemas";

const formData = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    bucket: "publira-media",
    region: "us-east-1",
    revision: "3",
    ...fields,
  })) {
    data.set(name, value);
  }
  return data;
};

const parse = async (fields: Record<string, string>) => {
  const schema = await storageFormSchema("en");
  return schema.safeParse(toFormDataInput(formData(fields), storageFormFields));
};

describe("storageFormSchema", () => {
  it("clears both halves of the credential for the ambient credential", async () => {
    const result = await parse({
      access_key_id: "AKIAEXAMPLE",
      credential_mode: "ambient",
      secret_access_key: "left-in-the-field",
    });

    expect(result.data).toMatchObject({
      accessKeyId: "",
      secretAccessKey: "",
      secretAccessKeyUpdateMode: STORAGE_SECRET_CLEAR,
    });
  });

  it("keeps the stored secret without sending one", async () => {
    const result = await parse({
      access_key_id: "AKIAEXAMPLE",
      credential_mode: "access_key",
      secret_access_key_update_mode: String(STORAGE_SECRET_UNCHANGED),
    });

    expect(result.data).toMatchObject({
      accessKeyId: "AKIAEXAMPLE",
      revision: 3n,
      secretAccessKey: "",
      secretAccessKeyUpdateMode: STORAGE_SECRET_UNCHANGED,
    });
  });

  it("sends a replacement secret", async () => {
    const result = await parse({
      access_key_id: "AKIANEW",
      credential_mode: "access_key",
      secret_access_key: "new-secret",
      secret_access_key_update_mode: String(STORAGE_SECRET_REPLACE),
    });

    expect(result.data).toMatchObject({
      accessKeyId: "AKIANEW",
      secretAccessKey: "new-secret",
      secretAccessKeyUpdateMode: STORAGE_SECRET_REPLACE,
    });
  });

  it("refuses a replacement without its secret", async () => {
    const result = await parse({
      access_key_id: "AKIANEW",
      credential_mode: "access_key",
      secret_access_key_update_mode: String(STORAGE_SECRET_REPLACE),
    });

    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Enter the secret access key.",
    ]);
  });

  it("refuses an access key without its id", async () => {
    const result = await parse({
      credential_mode: "access_key",
      secret_access_key: "new-secret",
      secret_access_key_update_mode: String(STORAGE_SECRET_REPLACE),
    });

    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Enter the access key ID.",
    ]);
  });

  it.each([
    ["fewer than three characters", "ab"],
    ["uppercase letters", "Publira"],
    ["the shape of an IP address", [10, 0, 0, 1].join(".")],
    ["consecutive dots", "publira..media"],
    ["a trailing hyphen", "publira-"],
  ])("refuses a bucket name with %s", async (_case, bucket) => {
    const result = await parse({ bucket, credential_mode: "ambient" });

    expect(result.success).toBe(false);
  });

  it.each([
    ["endpoint", "s3.example.com"],
    ["endpoint", "ftp://s3.example.com"],
    ["public_base_url", "https://media.example.com/?v=1"],
  ])("refuses %s=%s", async (name, value) => {
    const result = await parse({ credential_mode: "ambient", [name]: value });

    expect(result.success).toBe(false);
  });

  it("reads the path-style checkbox", async () => {
    const result = await parse({
      credential_mode: "ambient",
      endpoint: "http://127.0.0.1:9000",
      force_path_style: "on",
    });

    expect(result.data).toMatchObject({
      endpoint: "http://127.0.0.1:9000",
      forcePathStyle: true,
    });
  });
});
