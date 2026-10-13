import { describe, expect, it } from "vitest";

import {
  legalPageAgreementExemptPaths,
  legalPageAgreementHref,
  legalPageAgreementRedirect,
  legalPageAgreementReturnTo,
} from "./legal-page-agreement-path";

const agreementPath = "/en/settings/agreement";
const exemptPaths = ["/terms", "/legal/privacy", "/settings"];

describe("legalPageAgreementHref", () => {
  it("carries where the reader goes once they agree", () => {
    expect(legalPageAgreementHref(agreementPath, "/my?tab=history")).toBe(
      "/en/settings/agreement?returnTo=%2Fmy%3Ftab%3Dhistory"
    );
  });
});

describe("legalPageAgreementRedirect", () => {
  it("sends the reader to agree from any other page, with its query", () => {
    expect(
      legalPageAgreementRedirect({
        agreementPath,
        exemptPaths,
        pathname: "/en/series/abc",
        search: "page=2",
      })
    ).toBe("/en/settings/agreement?returnTo=%2Fseries%2Fabc%3Fpage%3D2");
  });

  it("reads the rewritten pathname a server render reports the same way", () => {
    expect(
      legalPageAgreementRedirect({
        agreementPath,
        exemptPaths,
        pathname: "/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/en/my",
        search: "",
      })
    ).toBe("/en/settings/agreement?returnTo=%2Fmy");
  });

  it("leaves the reader on a page they are asked to read, in any locale", () => {
    for (const pathname of ["/terms", "/ja/terms", "/en/legal/privacy"]) {
      expect(
        legalPageAgreementRedirect({
          agreementPath,
          exemptPaths,
          pathname,
          search: "",
        })
      ).toBeNull();
    }
  });

  it("leaves the reader on the screen that deletes the account, but not below it", () => {
    expect(
      legalPageAgreementRedirect({
        agreementPath,
        exemptPaths,
        pathname: "/settings",
        search: "",
      })
    ).toBeNull();
    expect(
      legalPageAgreementRedirect({
        agreementPath,
        exemptPaths,
        pathname: "/settings/notifications",
        search: "",
      })
    ).toBe("/en/settings/agreement?returnTo=%2Fsettings%2Fnotifications");
  });

  it("never sends the reader on from the agreement screen itself", () => {
    for (const pathname of [
      "/settings/agreement",
      "/en/settings/agreement",
      "/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/en/settings/agreement",
    ]) {
      expect(
        legalPageAgreementRedirect({
          agreementPath,
          exemptPaths,
          pathname,
          search: "returnTo=%2Fmy",
        })
      ).toBeNull();
    }
  });
});

describe("legalPageAgreementExemptPaths", () => {
  it("leaves the pages asked about and the account's deletion open", () => {
    expect(legalPageAgreementExemptPaths(["/terms"])).toEqual([
      "/terms",
      "/settings",
    ]);
  });

  it("is null for a reader who owes nothing", () => {
    expect(legalPageAgreementExemptPaths([])).toBeNull();
  });
});

describe("legalPageAgreementReturnTo", () => {
  it("keeps any other page, with its query", () => {
    expect(legalPageAgreementReturnTo("/series/abc?page=2")).toBe(
      "/series/abc?page=2"
    );
  });

  it("never returns to the agreement screen itself", () => {
    for (const returnTo of [
      "/settings/agreement",
      "/settings/agreement?returnTo=%2Fmy",
      "/settings/agreement#top",
    ]) {
      expect(legalPageAgreementReturnTo(returnTo)).toBe("/");
    }
  });
});
