import { toFormDataInput } from "@publira/utils/form-data";
import { describe, expect, it } from "vitest";

import {
  SEARCH_PASSWORD_CLEAR,
  SEARCH_PASSWORD_REPLACE,
  SEARCH_PASSWORD_UNCHANGED,
} from "#lib/search-settings-shared";

import { searchFormFields, searchFormSchema } from "./form-schemas";

const formData = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    engine: "opensearch",
    revision: "3",
    url: "https://search.example.com",
    ...fields,
  })) {
    data.set(name, value);
  }
  return data;
};

const parse = async (fields: Record<string, string>) => {
  const schema = await searchFormSchema("en");
  return schema.safeParse(toFormDataInput(formData(fields), searchFormFields));
};

const issueMessages = async (fields: Record<string, string>) => {
  const result = await parse(fields);
  return result.error?.issues.map((issue) => issue.message) ?? [];
};

describe("searchFormSchema", () => {
  it("sends nothing but the engine for SQL, clearing what another engine left in the form", async () => {
    const result = await parse({
      credential_mode: "basic",
      engine: "sql",
      index: "publira-catalog",
      password: "left-in-the-field",
      password_update_mode: String(SEARCH_PASSWORD_REPLACE),
      url: "https://search.example.com",
      username: "publira",
    });

    expect(result.data).toEqual({
      engine: "sql",
      index: "",
      password: "",
      passwordUpdateMode: SEARCH_PASSWORD_CLEAR,
      revision: 3n,
      url: "",
      username: "",
    });
  });

  it("clears both halves of the credential when the engine takes none", async () => {
    const result = await parse({
      credential_mode: "none",
      password: "left-in-the-field",
      username: "publira",
    });

    expect(result.data).toMatchObject({
      engine: "opensearch",
      password: "",
      passwordUpdateMode: SEARCH_PASSWORD_CLEAR,
      url: "https://search.example.com",
      username: "",
    });
  });

  it("keeps the stored password without sending one", async () => {
    const result = await parse({
      credential_mode: "basic",
      password_update_mode: String(SEARCH_PASSWORD_UNCHANGED),
      username: "publira",
    });

    expect(result.data).toMatchObject({
      password: "",
      passwordUpdateMode: SEARCH_PASSWORD_UNCHANGED,
      username: "publira",
    });
  });

  it("sends a replacement password", async () => {
    const result = await parse({
      credential_mode: "basic",
      password: " s3cret ",
      password_update_mode: String(SEARCH_PASSWORD_REPLACE),
      username: "publira",
    });

    expect(result.data).toMatchObject({
      password: "s3cret",
      passwordUpdateMode: SEARCH_PASSWORD_REPLACE,
    });
  });

  it("refuses an engine the server does not know", async () => {
    await expect(issueMessages({ engine: "solr" })).resolves.toContain(
      "Choose a search engine."
    );
  });

  it("refuses another engine without a URL", async () => {
    await expect(
      issueMessages({ engine: "elasticsearch", url: "" })
    ).resolves.toContain("Enter the engine's URL.");
  });

  it.each([
    "search.example.com",
    "ftp://search.example.com",
    "https://publira:s3cret@search.example.com",
  ])("refuses %s as the engine's URL", async (url) => {
    await expect(issueMessages({ url })).resolves.toContain(
      "Enter a URL that starts with http:// or https://, without a username or a password in it."
    );
  });

  it.each(["Publira", "-catalog", "_catalog", "+catalog", "my catalog", "a/b"])(
    "refuses %s as the index alias",
    async (index) => {
      await expect(issueMessages({ index })).resolves.toContain(
        "An index alias uses lowercase letters, digits, hyphens, underscores, and dots, and doesn't start with a hyphen, an underscore, or a plus sign."
      );
    }
  );

  it("leaves an empty alias to the server's default", async () => {
    const result = await parse({ index: "" });

    expect(result.success).toBe(true);
    expect(result.data?.index).toBe("");
  });

  it("refuses a credential over http://", async () => {
    await expect(
      issueMessages({
        credential_mode: "basic",
        password: "s3cret",
        password_update_mode: String(SEARCH_PASSWORD_REPLACE),
        url: "http://search.example.com",
        username: "publira",
      })
    ).resolves.toContain(
      "A username and a password can only be sent to an https:// URL."
    );
  });

  it("refuses a username without a password to replace the stored one with", async () => {
    await expect(
      issueMessages({
        credential_mode: "basic",
        password_update_mode: String(SEARCH_PASSWORD_REPLACE),
        username: "publira",
      })
    ).resolves.toContain("Enter the password.");
  });

  it("refuses a credential without a username", async () => {
    await expect(
      issueMessages({
        credential_mode: "basic",
        password: "s3cret",
        password_update_mode: String(SEARCH_PASSWORD_REPLACE),
      })
    ).resolves.toContain("Enter the username.");
  });
});
