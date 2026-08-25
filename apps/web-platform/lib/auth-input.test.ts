import { describe, expect, it } from "vitest";

import en from "../../../locales/en.json" with { type: "json" };
import ja from "../../../locales/ja.json" with { type: "json" };
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
import type { PlatformMessages } from "./locale";

const VALID_TOKEN = "a".repeat(64);

const JA: PlatformMessages = ja;
const EN: PlatformMessages = en;

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
  it("rejects a missing or malformed token", () => {
    expect(authTokenFormSchema(JA).safeParse(null).success).toBe(false);
    expect(authTokenFormSchema(JA).safeParse("short").success).toBe(false);
    expect(authTokenFormSchema(JA).parse(VALID_TOKEN)).toBe(VALID_TOKEN);
  });

  it("reports the rejection in the catalog's locale", () => {
    expect(firstIssue(authTokenFormSchema(JA).safeParse("short"))).toBe(
      "確認リンクが無効です。"
    );
    expect(firstIssue(authTokenFormSchema(EN).safeParse("short"))).toBe(
      "This confirmation link is invalid."
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
    expect(errorSearchParamSchema.parse("  失敗しました  ")).toBe(
      "失敗しました"
    );
    expect(errorSearchParamSchema.parse(null)).toBe("");
  });
});

describe("emailFormSchema", () => {
  it("trims and requires an email", () => {
    expect(emailFormSchema(JA).parse("  operator@example.com  ")).toBe(
      "operator@example.com"
    );
    expect(emailFormSchema(JA).safeParse("").success).toBe(false);
    expect(emailFormSchema(JA).safeParse("not-an-email").success).toBe(false);
  });

  it("reports the rejection in the catalog's locale", () => {
    expect(firstIssue(emailFormSchema(JA).safeParse(""))).toBe(
      "メールアドレスを入力してください。"
    );
    expect(firstIssue(emailFormSchema(EN).safeParse(""))).toBe(
      "Enter your email address."
    );
    expect(firstIssue(emailFormSchema(EN).safeParse("not-an-email"))).toBe(
      "Enter a valid email address."
    );
  });
});

describe("passwordFormSchema", () => {
  it("does not trim, and rejects an empty value", () => {
    expect(passwordFormSchema(JA).parse(" secret ")).toBe(" secret ");
    expect(passwordFormSchema(JA).safeParse("").success).toBe(false);
  });

  it("reports the rejection in the catalog's locale", () => {
    expect(firstIssue(passwordFormSchema(JA).safeParse(""))).toBe(
      "パスワードを入力してください。"
    );
    expect(firstIssue(passwordFormSchema(EN).safeParse(""))).toBe(
      "Enter your password."
    );
  });
});
