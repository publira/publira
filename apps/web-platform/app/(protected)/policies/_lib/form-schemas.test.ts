import { toFormDataInput } from "@publira/utils/form-data";
import { describe, expect, it } from "vitest";

import {
  retentionDefaultsFormFields,
  retentionDefaultsFormSchema,
  securityPolicyFormFields,
  securityPolicyFormSchema,
} from "./form-schemas";

const securityValues = {
  login_attempts_per_account_per_day: "50",
  login_attempts_per_account_per_minute: "5",
  login_attempts_per_source_per_day: "300",
  login_attempts_per_source_per_hour: "30",
  mail_requests_per_address_per_day: "20",
  mail_requests_per_address_per_hour: "5",
  mail_requests_per_source_per_day: "150",
  mail_requests_per_source_per_hour: "30",
  password_verification_per_day: "50",
  password_verification_per_minute: "5",
  revision: "3",
  store_purchase_confirmation_per_day: "100",
  store_purchase_confirmation_per_minute: "10",
  wait_free_ticket_use_per_day: "100",
  wait_free_ticket_use_per_minute: "10",
};

const parseSecurity = async (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    ...securityValues,
    ...fields,
  })) {
    data.set(name, value);
  }
  const schema = await securityPolicyFormSchema("en");
  return schema.safeParse(toFormDataInput(data, securityPolicyFormFields));
};

describe("securityPolicyFormSchema", () => {
  it("reads the in-app purchase confirmation limit", async () => {
    const result = await parseSecurity({});

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      storePurchaseConfirmationPerDay: 100,
      storePurchaseConfirmationPerMinute: 10,
    });
  });

  it("refuses a daily confirmation limit below the per-minute one", async () => {
    const result = await parseSecurity({
      store_purchase_confirmation_per_day: "9",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      "The daily limit for In-app purchase confirmations must be at least its per-minute limit."
    );
  });

  it("refuses a confirmation limit of zero", async () => {
    const result = await parseSecurity({
      store_purchase_confirmation_per_minute: "0",
    });

    expect(result.success).toBe(false);
  });

  it("reads the wait-for-free ticket use limit", async () => {
    const result = await parseSecurity({
      wait_free_ticket_use_per_day: "60",
      wait_free_ticket_use_per_minute: "6",
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      waitFreeTicketUsePerDay: 60,
      waitFreeTicketUsePerMinute: 6,
    });
  });

  it("refuses a daily ticket use limit below the per-minute one", async () => {
    const result = await parseSecurity({
      wait_free_ticket_use_per_day: "9",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      "The daily limit for Wait-for-free ticket uses must be at least its per-minute limit."
    );
  });

  it("refuses a ticket use limit of zero", async () => {
    const result = await parseSecurity({
      wait_free_ticket_use_per_minute: "0",
    });

    expect(result.success).toBe(false);
  });

  it("reads the sign-in attempt limits", async () => {
    const result = await parseSecurity({
      login_attempts_per_account_per_day: "70",
      login_attempts_per_account_per_minute: "7",
      login_attempts_per_source_per_day: "400",
      login_attempts_per_source_per_hour: "40",
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      loginAttemptsPerAccountPerDay: 70,
      loginAttemptsPerAccountPerMinute: 7,
      loginAttemptsPerSourcePerDay: 400,
      loginAttemptsPerSourcePerHour: 40,
    });
  });

  it("refuses a daily sign-in attempt limit per address below the per-minute one", async () => {
    const result = await parseSecurity({
      login_attempts_per_account_per_day: "4",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      "The daily limit for Sign-in attempts per address must be at least its per-minute limit."
    );
  });

  it("refuses a daily failed sign-in limit per source below the hourly one", async () => {
    const result = await parseSecurity({
      login_attempts_per_source_per_day: "29",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      "The daily limit for Failed sign-ins per source must be at least its per-hour limit."
    );
  });

  it.each([
    "login_attempts_per_account_per_minute",
    "login_attempts_per_account_per_day",
    "login_attempts_per_source_per_hour",
    "login_attempts_per_source_per_day",
  ])("refuses zero as %s", async (name) => {
    const result = await parseSecurity({ [name]: "0" });

    expect(result.success).toBe(false);
  });

  it("reads an empty list URL as no list", async () => {
    const result = await parseSecurity({ disposable_email_domains_url: "  " });

    expect(result.success).toBe(true);
    expect(result.data?.disposableEmailDomainsUrl).toBe("");
  });

  it("reads a list URL with the spaces around it dropped", async () => {
    const result = await parseSecurity({
      disposable_email_domains_url:
        " https://lists.example.com/disposable.conf ",
    });

    expect(result.success).toBe(true);
    expect(result.data?.disposableEmailDomainsUrl).toBe(
      "https://lists.example.com/disposable.conf"
    );
  });

  it.each([
    ["a relative path", "lists/disposable.conf"],
    ["another scheme", "file:///etc/disposable.conf"],
    ["a URL past 2048 bytes", `https://lists.example.com/${"a".repeat(2048)}`],
    // 700 characters, but 2100 bytes in UTF-8, which is what the server counts.
    [
      "a URL past 2048 bytes in UTF-8",
      `https://lists.example.com/${"あ".repeat(700)}`,
    ],
    // The WHATWG parser finds a host in both; Go's net/url finds none.
    ["a URL with no slashes after the scheme", "https:lists.example.com/file"],
    ["a URL with three slashes", "https:///lists.example.com/file"],
    ["a URL with a broken escape", "https://lists.example.com/%zz.conf"],
  ])("refuses %s as the list URL", async (_name, value) => {
    const result = await parseSecurity({ disposable_email_domains_url: value });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      "Enter an http or https URL for the disposable email domain list, or leave it empty."
    );
  });
});

const retentionValues = {
  content_event_days: "90",
  daily_ranking_snapshot_days: "90",
  revision: "3",
  weekly_ranking_snapshot_days: "400",
  withdrawn_comment_days: "180",
};

const parseRetention = async (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    ...retentionValues,
    ...fields,
  })) {
    data.set(name, value);
  }
  const schema = await retentionDefaultsFormSchema("en");
  return schema.safeParse(toFormDataInput(data, retentionDefaultsFormFields));
};

describe("retentionDefaultsFormSchema", () => {
  it("accepts a content-event period at the lower bound", async () => {
    const result = await parseRetention({ content_event_days: "30" });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ contentEventDays: 30 });
  });

  it("refuses a content-event period below the lower bound and names it", async () => {
    const result = await parseRetention({ content_event_days: "29" });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Enter a whole number of days from 30 through 36500 for Content events (days). Recommendations and statistics are built from content events, so they are kept for at least 30 days.",
    ]);
  });

  it("keeps a lower bound of one day for the other periods", async () => {
    const result = await parseRetention({ withdrawn_comment_days: "1" });

    expect(result.success).toBe(true);
  });
});
