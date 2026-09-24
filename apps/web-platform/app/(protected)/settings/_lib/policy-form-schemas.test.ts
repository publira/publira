import { toFormDataInput } from "@publira/utils/form-data";
import { describe, expect, it } from "vitest";

import {
  securityPolicyFormFields,
  securityPolicyFormSchema,
} from "./policy-form-schemas";

const securityValues = {
  mail_requests_per_address_per_day: "20",
  mail_requests_per_address_per_hour: "5",
  mail_requests_per_source_per_day: "150",
  mail_requests_per_source_per_hour: "30",
  password_verification_per_day: "50",
  password_verification_per_minute: "5",
  revision: "3",
  store_purchase_confirmation_per_day: "100",
  store_purchase_confirmation_per_minute: "10",
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
});
