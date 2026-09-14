import { describe, expect, it } from "vitest";

import {
  authTokenFormSchema,
  authTokenSearchParamSchema,
  emailFormSchema,
  emailSearchParamSchema,
  errorSearchParamSchema,
  inviteTokenFormSchema,
  nextPathFormSchema,
  nextPathSearchParamSchema,
  passwordFormSchema,
  tenantIdFormSchema,
} from "./auth-input";

const VALID_TOKEN = "a".repeat(64);
const VALID_TENANT_ID = "01234567-89ab-cdef-0123-456789abcdef";
const JA = "ja" as const;
const EN = "en" as const;

describe("nextPathSearchParamSchema", () => {
  it("keeps a same-origin path", () => {
    expect(nextPathSearchParamSchema.parse("/series")).toBe("/series");
    expect(nextPathSearchParamSchema.parse("/series/s1?page=2")).toBe(
      "/series/s1?page=2"
    );
  });

  it("neutralizes open redirects and login loops", () => {
    expect(nextPathSearchParamSchema.parse("https://evil.example")).toBe("/");
    expect(nextPathSearchParamSchema.parse("//evil.example")).toBe("/");
    expect(nextPathSearchParamSchema.parse("/login?next=/series")).toBe("/");
  });

  it("falls back when the query is missing, empty, or conflicting", () => {
    expect(nextPathSearchParamSchema.parse(null)).toBe("/");
    expect(nextPathSearchParamSchema.parse("   ")).toBe("/");
    expect(nextPathSearchParamSchema.parse(["/a", "/b"])).toBe("/");
  });
});

describe("nextPathFormSchema", () => {
  it("applies the same sanitization as the query schema", () => {
    expect(nextPathFormSchema.parse("/series")).toBe("/series");
    expect(nextPathFormSchema.parse("https://evil.example")).toBe("/");
    expect(nextPathFormSchema.parse(null)).toBe("/");
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
    expect(authTokenSearchParamSchema.parse("g".repeat(64))).toBe("");
    expect(authTokenSearchParamSchema.parse(VALID_TOKEN.slice(0, 63))).toBe("");
  });
});

describe("authTokenFormSchema", () => {
  it("rejects a missing or malformed token", async () => {
    const authTokenJA = await authTokenFormSchema(JA);

    expect(authTokenJA.safeParse(null).success).toBe(false);
    expect(authTokenJA.safeParse("short").success).toBe(false);
    expect(authTokenJA.parse(VALID_TOKEN)).toBe(VALID_TOKEN);
  });
});

describe("inviteTokenFormSchema", () => {
  it("rejects a missing or malformed invite token", async () => {
    const inviteTokenEN = await inviteTokenFormSchema(EN);

    expect(inviteTokenEN.safeParse("").error?.issues[0]?.message).toBe(
      "The invitation token was not found."
    );
    expect(inviteTokenEN.parse(VALID_TOKEN)).toBe(VALID_TOKEN);
  });
});

describe("emailSearchParamSchema", () => {
  it("keeps a well-formed email and hides anything else", () => {
    expect(emailSearchParamSchema.parse("admin@example.com")).toBe(
      "admin@example.com"
    );
    expect(emailSearchParamSchema.parse("not-an-email")).toBe("");
    expect(emailSearchParamSchema.parse(null)).toBe("");
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

describe("tenantIdFormSchema", () => {
  it("accepts a UUID tenant id and rejects other strings", async () => {
    const tenantIdJA = await tenantIdFormSchema(JA);

    expect(tenantIdJA.parse(VALID_TENANT_ID)).toBe(VALID_TENANT_ID);
    expect(tenantIdJA.safeParse("TENANT001").success).toBe(false);
    expect(tenantIdJA.safeParse("").success).toBe(false);
  });
});

describe("emailFormSchema", () => {
  it("trims and requires an email", async () => {
    const emailEN = await emailFormSchema(EN);
    const emailJA = await emailFormSchema(JA);

    expect(emailJA.parse("  admin@example.com  ")).toBe("admin@example.com");
    expect(emailJA.safeParse("").success).toBe(false);
    expect(emailJA.safeParse("not-an-email").success).toBe(false);

    expect(emailEN.safeParse("").error?.issues[0]?.message).toBe(
      "Enter your email address."
    );
  });
});

describe("passwordFormSchema", () => {
  it("does not trim, and rejects an empty value", async () => {
    const passwordEN = await passwordFormSchema(EN);
    const passwordJA = await passwordFormSchema(JA);

    expect(passwordJA.parse(" secret ")).toBe(" secret ");
    expect(passwordJA.safeParse("").success).toBe(false);
    expect(passwordEN.safeParse("").error?.issues[0]?.message).toBe(
      "Enter your password."
    );
  });
});
