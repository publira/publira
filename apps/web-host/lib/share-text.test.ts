import { bindMessages } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { describe, expect, it } from "vitest";

import type { CreatorCredit } from "./catalog";
import { shareText } from "./share-text";

const credit = (name: string): CreatorCredit => ({
  name,
  publicId: name.replaceAll(" ", "_"),
  roleName: "Original Author",
});

const messages = (locale: "en" | "ja") => bindMessages(sharedCatalog(locale));

describe("shareText", () => {
  it("names the work and the one creator credited on it", () => {
    expect(
      shareText(messages("en"), "en", "Published Series", [
        credit("Published Author"),
      ])
    ).toBe("Published Series by Published Author");
  });

  it("joins several creators the way the reader's language joins a list", () => {
    expect(
      shareText(messages("en"), "en", "Published Series", [
        credit("First Author"),
        credit("Second Author"),
        credit("Third Author"),
      ])
    ).toBe("Published Series by First Author, Second Author, and Third Author");
  });

  it("words the same credits in the reader's own language", () => {
    expect(
      shareText(messages("ja"), "ja", "Published Series", [
        credit("First Author"),
        credit("Second Author"),
      ])
    ).toBe("Published Series（First Author、Second Author）");
  });

  it("leaves an uncredited work as its own name, with no empty bracket", () => {
    expect(shareText(messages("en"), "en", "Published Series", [])).toBe(
      "Published Series"
    );
  });
});
