import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { readerDataExportReadyDataSchema } from "./reader-data-export-ready";

const data = {
  expires_at: "2026-11-09T06:00:00Z",
  settings_url: "https://tenant.example.test/settings",
  tenant_name: "Aoto Press",
};

describe("readerDataExportReadyDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(readerDataExportReadyDataSchema.parse(data)).toEqual(data);
  });

  it("rejects a settings_url that is not an http(s) URL", () => {
    const parsed = readerDataExportReadyDataSchema.safeParse({
      ...data,
      settings_url: "data:text/html,<p>settings</p>",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("ReaderDataExportReadyEmail", () => {
  it("says until when the archive can be downloaded and links the account settings", async () => {
    const result = await renderEmail({
      data,
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "reader_data_export_ready",
      timeZone: "Asia/Tokyo",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    expect(result.html).toContain("Your data is ready");
    expect(result.html).toContain("2026");
    expect(result.html).toContain(data.settings_url);
  });
});
