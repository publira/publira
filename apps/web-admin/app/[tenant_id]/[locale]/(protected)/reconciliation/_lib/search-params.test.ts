import { describe, expect, it } from "vitest";

import {
  parseReconciliationSearchParams,
  reconciliationQuery,
} from "./search-params";

const RUN_ID = "018f10d0-0007-7000-8000-000000000001";

describe("parseReconciliationSearchParams", () => {
  it("reads the run, its filters, and both pages", () => {
    expect(
      parseReconciliationSearchParams({
        findings_token: "findings-page",
        kind: "record_unmatched",
        mode: "test",
        run: RUN_ID,
        token: "runs-page",
      })
    ).toEqual({
      findingsToken: "findings-page",
      kind: "record_unmatched",
      mode: "test",
      run: RUN_ID,
      token: "runs-page",
    });
  });

  it("falls back to the default view for values it cannot use", () => {
    expect(
      parseReconciliationSearchParams({
        findings_token: ["a", "b"],
        kind: "other",
        mode: "sandbox",
        run: "not-a-uuid",
        token: ["c", "d"],
      })
    ).toEqual({
      findingsToken: "",
      kind: "",
      mode: "",
      run: "",
      token: "",
    });
  });
});

describe("reconciliationQuery", () => {
  it("keeps the runs page beside the open run and its filters", () => {
    expect(
      reconciliationQuery({
        findingsToken: "findings-page",
        kind: "held_refund",
        mode: "live",
        run: RUN_ID,
        token: "runs-page",
      })
    ).toBe(
      `?findings_token=findings-page&kind=held_refund&mode=live&run=${RUN_ID}&token=runs-page`
    );
  });

  it("drops a run's filters and page along with the run", () => {
    expect(
      reconciliationQuery({
        findingsToken: "findings-page",
        kind: "held_refund",
        mode: "live",
        token: "runs-page",
      })
    ).toBe("?token=runs-page");
  });

  it("answers a bare query for the default view", () => {
    expect(reconciliationQuery({})).toBe("?");
  });
});
