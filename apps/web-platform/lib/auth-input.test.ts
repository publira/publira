import { describe, expect, it } from "vitest";

import {
  authTokenFormSchema,
  authTokenSearchParamSchema,
  emailFormSchema,
  emailSearchParamSchema,
  errorSearchParamSchema,
  nextPathFormSchema,
  nextPathSearchParamSchema,
  passwordFormSchema,
} from "./auth-input";

const VALID_TOKEN = "a".repeat(64);

const JA = "ja" as const;
const EN = "en" as const;

const firstIssue = (result: { error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;

describe("nextPathSearchParamSchema", () => {
  it("keeps a same-origin path", () => {
    expect(nextPathSearchParamSchema.parse("/operators")).toBe("/operators");
    expect(nextPathSearchParamSchema.parse("/tenants/t1?page=2")).toBe(
      "/tenants/t1?page=2"
    );
  });

  it("neutralizes open redirects and login loops", () => {
    expect(nextPathSearchParamSchema.parse("https://evil.example")).toBe("/");
    expect(nextPathSearchParamSchema.parse("//evil.example")).toBe("/");
    expect(nextPathSearchParamSchema.parse("/login?next=/operators")).toBe("/");
  });

  it("falls back when the query is missing, empty, or conflicting", () => {
    expect(nextPathSearchParamSchema.parse(null)).toBe("/");
    expect(nextPathSearchParamSchema.parse("   ")).toBe("/");
    expect(nextPathSearchParamSchema.parse(["/a", "/b"])).toBe("/");
  });
});

describe("nextPathFormSchema", () => {
  it("applies the same sanitization as the query schema", () => {
    expect(nextPathFormSchema.parse("/operators")).toBe("/operators");
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
    const authTokenEN = await authTokenFormSchema(EN);

    expect(authTokenEN.safeParse(null).success).toBe(false);
    expect(authTokenEN.safeParse("short").success).toBe(false);
    expect(authTokenEN.parse(VALID_TOKEN)).toBe(VALID_TOKEN);
  });

  it("reports the rejection in the catalog's locale", async () => {
    const authTokenEN = await authTokenFormSchema(EN);
    const authTokenJA = await authTokenFormSchema(JA);

    expect(firstIssue(authTokenJA.safeParse("short"))).toBe(
      "確認リンクが無効です。新しい確認メールをリクエストしてください。"
    );
    expect(firstIssue(authTokenEN.safeParse("short"))).toBe(
      "This confirmation link is invalid. Request a new confirmation email."
    );
  });
});

describe("emailSearchParamSchema", () => {
  it("keeps a well-formed email and hides anything else", () => {
    expect(emailSearchParamSchema.parse("operator@example.com")).toBe(
      "operator@example.com"
    );
    expect(emailSearchParamSchema.parse("not-an-email")).toBe("");
    expect(emailSearchParamSchema.parse(null)).toBe("");
  });
});

describe("errorSearchParamSchema", () => {
  it("trims a message and falls back to empty", () => {
    expect(errorSearchParamSchema.parse("  It did not work  ")).toBe(
      "It did not work"
    );
    expect(errorSearchParamSchema.parse(null)).toBe("");
  });
});

describe("emailFormSchema", () => {
  it("trims and requires an email", async () => {
    const emailEN = await emailFormSchema(EN);

    expect(emailEN.parse("  operator@example.com  ")).toBe(
      "operator@example.com"
    );
    expect(emailEN.safeParse("").success).toBe(false);
    expect(emailEN.safeParse("not-an-email").success).toBe(false);
  });

  it("reports the rejection in the catalog's locale", async () => {
    const emailEN = await emailFormSchema(EN);
    const emailJA = await emailFormSchema(JA);

    expect(firstIssue(emailJA.safeParse(""))).toBe(
      "メールアドレスを入力してください。"
    );
    expect(firstIssue(emailEN.safeParse(""))).toBe("Enter your email address.");
    expect(firstIssue(emailEN.safeParse("not-an-email"))).toBe(
      "Enter a valid email address."
    );
  });
});

describe("passwordFormSchema", () => {
  it("does not trim, and rejects an empty value", async () => {
    const passwordEN = await passwordFormSchema(EN);

    expect(passwordEN.parse(" secret ")).toBe(" secret ");
    expect(passwordEN.safeParse("").success).toBe(false);
  });

  it("reports the rejection in the catalog's locale", async () => {
    const passwordEN = await passwordFormSchema(EN);
    const passwordJA = await passwordFormSchema(JA);

    expect(firstIssue(passwordJA.safeParse(""))).toBe(
      "パスワードを入力してください。"
    );
    expect(firstIssue(passwordEN.safeParse(""))).toBe("Enter your password.");
  });
});
