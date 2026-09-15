import { toFormDataInput } from "@publira/utils/form-data";
import { describe, expect, it } from "vitest";

import {
  authTokenFormSchema,
  authTokenSearchParamSchema,
  birthDateFormSchema,
  emailFormSchema,
  errorSearchParamSchema,
  passwordFormSchema,
  returnToFormSchema,
  returnToSearchParamSchema,
  tenantIdFormSchema,
  tenantIdSchema,
} from "./auth-input";

const VALID_TOKEN = "a".repeat(64);
const VALID_TENANT_ID = "01234567-89ab-cdef-0123-456789abcdef";
const JA = "ja" as const;
const EN = "en" as const;

describe("returnToSearchParamSchema", () => {
  it("keeps a same-origin path", () => {
    expect(returnToSearchParamSchema.parse("/dashboard")).toBe("/dashboard");
    expect(returnToSearchParamSchema.parse("/series/s1?page=2")).toBe(
      "/series/s1?page=2"
    );
  });

  it("neutralizes open redirects and login loops", () => {
    expect(returnToSearchParamSchema.parse("https://evil.example")).toBe("/");
    expect(returnToSearchParamSchema.parse("//evil.example")).toBe("/");
    expect(returnToSearchParamSchema.parse("/\\evil.example")).toBe("/");
    expect(returnToSearchParamSchema.parse("/login?returnTo=/dashboard")).toBe(
      "/"
    );
  });

  it("falls back when the query is missing, empty, or conflicting", () => {
    expect(returnToSearchParamSchema.parse(null)).toBe("/");
    expect(returnToSearchParamSchema.parse("   ")).toBe("/");
    expect(returnToSearchParamSchema.parse(["/a", "/b"])).toBe("/");
  });
});

describe("returnToFormSchema", () => {
  it("applies the same sanitization as the query schema", () => {
    expect(returnToFormSchema.parse("/my")).toBe("/my");
    expect(returnToFormSchema.parse("https://evil.example")).toBe("/");
    expect(returnToFormSchema.parse("/\\evil.example")).toBe("/");
    expect(returnToFormSchema.parse(null)).toBe("/");
  });
});

describe("authTokenSearchParamSchema", () => {
  it("accepts the 64-char hex the server issues", () => {
    expect(authTokenSearchParamSchema.parse(VALID_TOKEN)).toBe(VALID_TOKEN);
    expect(authTokenSearchParamSchema.parse(` ${VALID_TOKEN} `)).toBe(
      VALID_TOKEN
    );
  });

  it("drops anything that is not a 64-char hex token", () => {
    expect(authTokenSearchParamSchema.parse(null)).toBe("");
    expect(authTokenSearchParamSchema.parse("not-a-token")).toBe("");
    expect(authTokenSearchParamSchema.parse("A".repeat(64))).toBe(
      "A".repeat(64)
    );
    expect(authTokenSearchParamSchema.parse("g".repeat(64))).toBe("");
    expect(authTokenSearchParamSchema.parse(VALID_TOKEN.slice(0, 63))).toBe("");
  });
});

describe("authTokenFormSchema", () => {
  it("rejects a missing or malformed token", async () => {
    const ja = await authTokenFormSchema(JA);
    const en = await authTokenFormSchema(EN);

    expect(ja.safeParse(null).success).toBe(false);
    expect(ja.safeParse("short").success).toBe(false);
    expect(ja.parse(VALID_TOKEN)).toBe(VALID_TOKEN);

    expect(en.safeParse("short").error?.issues[0]?.message).toBe(
      "This confirmation link is not valid. Request a new confirmation email."
    );
  });
});

describe("errorSearchParamSchema", () => {
  it("trims a message and falls back to empty", () => {
    expect(errorSearchParamSchema.parse("  Something went wrong  ")).toBe(
      "Something went wrong"
    );
    expect(errorSearchParamSchema.parse(null)).toBe("");
  });
});

describe("tenantIdSchema", () => {
  it("accepts a UUID tenant id and rejects other strings", () => {
    expect(tenantIdSchema.parse(VALID_TENANT_ID)).toBe(VALID_TENANT_ID);
    expect(tenantIdSchema.safeParse("favicon.ico").success).toBe(false);
    expect(tenantIdSchema.safeParse("").success).toBe(false);
  });
});

describe("tenantIdFormSchema", () => {
  it("accepts a UUID tenant id and rejects other strings", async () => {
    const ja = await tenantIdFormSchema(JA);
    const en = await tenantIdFormSchema(EN);

    expect(ja.parse(VALID_TENANT_ID)).toBe(VALID_TENANT_ID);
    expect(ja.safeParse("favicon.ico").success).toBe(false);
    expect(ja.safeParse("").success).toBe(false);

    expect(en.safeParse("").error?.issues[0]?.message).toBe(
      "Tenant ID not found. Check the URL and try again."
    );
  });
});

describe("emailFormSchema", () => {
  it("trims and requires an email", async () => {
    const ja = await emailFormSchema(JA);
    const en = await emailFormSchema(EN);

    expect(ja.parse("  user@example.com  ")).toBe("user@example.com");
    expect(ja.safeParse("").success).toBe(false);
    expect(ja.safeParse("not-an-email").success).toBe(false);

    expect(en.safeParse("").error?.issues[0]?.message).toBe(
      "Enter your email address."
    );
  });
});

describe("birthDateFormSchema", () => {
  it("accepts a calendar date and reads a form that did not ask as empty", async () => {
    const schema = await birthDateFormSchema(EN);

    // A form the tenant's rule did not make ask submits no field at all, which
    // reaches the schema as the `undefined` `toFormDataInput` answers with.
    const absent = toFormDataInput(new FormData(), { birthDate: "value" });

    expect(schema.parse(" 1990-04-02 ")).toBe("1990-04-02");
    expect(schema.parse("")).toBe("");
    expect(schema.parse(absent.birthDate)).toBe("");
  });

  it("rejects anything that is not a plausible past calendar day", async () => {
    const schema = await birthDateFormSchema(EN);
    const tomorrow = Temporal.Now.plainDateISO("UTC").add({ days: 2 });

    expect(schema.safeParse("1990-4-2").success).toBe(false);
    expect(schema.safeParse("1990-02-30").success).toBe(false);
    expect(schema.safeParse(tomorrow.toString()).success).toBe(false);
    expect(schema.safeParse("1800-01-01").success).toBe(false);
    expect(schema.safeParse("1990-04-02T00:00:00Z").success).toBe(false);
  });

  it("words the rejection in the reader's language", async () => {
    const en = await birthDateFormSchema(EN);
    const ja = await birthDateFormSchema(JA);

    expect(en.safeParse("nope").error?.issues[0]?.message).toBe(
      "Enter your date of birth as a past calendar date."
    );
    expect(ja.safeParse("nope").error?.issues[0]?.message).toBe(
      "生年月日を過去の日付で入力してください。"
    );
  });
});

describe("passwordFormSchema", () => {
  it("does not trim, and rejects an empty value", async () => {
    const ja = await passwordFormSchema(JA);
    const en = await passwordFormSchema(EN);

    expect(ja.parse(" secret ")).toBe(" secret ");
    expect(ja.safeParse("").success).toBe(false);
    expect(en.safeParse("").error?.issues[0]?.message).toBe(
      "Enter your password."
    );
  });
});
