import { sharedCatalog } from "@publira/i18n/catalog";
import { describe, expect, it } from "vitest";

import {
  authTokenFormSchema,
  authTokenSearchParamSchema,
  emailFormSchema,
  errorSearchParamSchema,
  passwordFormSchema,
  returnToFormSchema,
  returnToSearchParamSchema,
  tenantIdFormSchema,
  tenantIdSchema,
} from "./auth-input";
import type { HostMessages } from "./messages";

const VALID_TOKEN = "a".repeat(64);
const VALID_TENANT_ID = "01234567-89ab-cdef-0123-456789abcdef";
const JA: HostMessages = sharedCatalog("ja");
const EN: HostMessages = sharedCatalog("en");

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
  it("rejects a missing or malformed token", () => {
    expect(authTokenFormSchema(JA).safeParse(null).success).toBe(false);
    expect(authTokenFormSchema(JA).safeParse("short").success).toBe(false);
    expect(authTokenFormSchema(JA).parse(VALID_TOKEN)).toBe(VALID_TOKEN);

    expect(
      authTokenFormSchema(EN).safeParse("short").error?.issues[0]?.message
    ).toBe("This confirmation link is not valid.");
  });
});

describe("errorSearchParamSchema", () => {
  it("trims a message and falls back to empty", () => {
    expect(errorSearchParamSchema.parse("  失敗しました  ")).toBe(
      "失敗しました"
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
  it("accepts a UUID tenant id and rejects other strings", () => {
    expect(tenantIdFormSchema(JA).parse(VALID_TENANT_ID)).toBe(VALID_TENANT_ID);
    expect(tenantIdFormSchema(JA).safeParse("favicon.ico").success).toBe(false);
    expect(tenantIdFormSchema(JA).safeParse("").success).toBe(false);

    expect(tenantIdFormSchema(EN).safeParse("").error?.issues[0]?.message).toBe(
      "Tenant ID not found."
    );
  });
});

describe("emailFormSchema", () => {
  it("trims and requires an email", () => {
    expect(emailFormSchema(JA).parse("  user@example.com  ")).toBe(
      "user@example.com"
    );
    expect(emailFormSchema(JA).safeParse("").success).toBe(false);
    expect(emailFormSchema(JA).safeParse("not-an-email").success).toBe(false);

    expect(emailFormSchema(EN).safeParse("").error?.issues[0]?.message).toBe(
      "Enter your email address."
    );
  });
});

describe("passwordFormSchema", () => {
  it("does not trim, and rejects an empty value", () => {
    expect(passwordFormSchema(JA).parse(" secret ")).toBe(" secret ");
    expect(passwordFormSchema(JA).safeParse("").success).toBe(false);
    expect(passwordFormSchema(EN).safeParse("").error?.issues[0]?.message).toBe(
      "Enter your password."
    );
  });
});
