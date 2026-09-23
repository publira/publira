import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Capability, Inventory } from "./check-reader-parity.ts";
import { findProblems, methodsIn, webRouteOf } from "./check-reader-parity.ts";

const inventory = (overrides: Partial<Inventory> = {}): Inventory => ({
  mobileRpcs: new Set(["GetSeriesDetail"]),
  mobileTests: "testApp('opens series detail', (tester) async {});",
  webRoutes: new Set(["[locale]/(site)/series/[series_id]"]),
  webRpcs: new Set(["GetSeriesDetail"]),
  ...overrides,
});

const seriesDetail: Capability = {
  mobile: { routes: ["/series/:seriesId"], rpcs: ["GetSeriesDetail"] },
  name: "A series",
  tests: ["opens series detail"],
  web: {
    routes: ["[locale]/(site)/series/[series_id]"],
    rpcs: ["GetSeriesDetail"],
  },
};

describe("webRouteOf", () => {
  it("names a page by its directory below the tenant segment", () => {
    assert.equal(
      webRouteOf(
        "apps/web-host/app/[tenant_id]/[locale]/(site)/series/page.tsx"
      ),
      "[locale]/(site)/series"
    );
    assert.equal(
      webRouteOf("apps/web-host/app/[tenant_id]/api/v1/views/route.ts"),
      "api/v1/views"
    );
  });

  it("leaves out what no reader does", () => {
    assert.equal(
      webRouteOf("apps/web-host/app/[tenant_id]/theme.css/route.ts"),
      null
    );
    assert.equal(
      webRouteOf("apps/web-host/app/[tenant_id]/[locale]/(site)/layout.tsx"),
      null
    );
  });
});

describe("methodsIn", () => {
  it("reads the method from a web call and from an app call", () => {
    assert.deepEqual(
      methodsIn(
        "await apiClient.catalog.getSeriesDetail({})",
        /\bapiClient\.\w+\.(?<method>\w+)\b/gu
      ),
      ["GetSeriesDetail"]
    );
    assert.deepEqual(
      methodsIn(
        "'/publira.v1.CatalogService/GetSeriesDetail';",
        /Service\/(?<method>[A-Z]\w*)'/gu
      ),
      ["GetSeriesDetail"]
    );
  });
});

describe("findProblems", () => {
  it("accepts a matrix that claims everything web-host serves", () => {
    assert.deepEqual(findProblems([seriesDetail], inventory()), []);
  });

  it("reports a web route and a web call no entry claims", () => {
    const problems = findProblems(
      [seriesDetail],
      inventory({
        webRoutes: new Set([
          "[locale]/(site)/series/[series_id]",
          "[locale]/(site)/genres",
        ]),
        webRpcs: new Set(["GetSeriesDetail", "ListPublishedGenres"]),
      })
    );
    assert.equal(problems.length, 2);
    assert.match(problems[0] ?? "", /\[locale\]\/\(site\)\/genres/u);
    assert.match(problems[1] ?? "", /ListPublishedGenres/u);
  });

  it("accepts an explicit exception in place of a mobile path", () => {
    const genres: Capability = {
      exception: "Not in the app yet.",
      name: "Genres",
      web: { routes: ["[locale]/(site)/genres"] },
    };
    assert.deepEqual(
      findProblems(
        [seriesDetail, genres],
        inventory({
          webRoutes: new Set([
            "[locale]/(site)/series/[series_id]",
            "[locale]/(site)/genres",
          ]),
        })
      ),
      []
    );
  });

  it("requires a mobile path or an exception, not both and not neither", () => {
    const neither: Capability = { name: "Neither", web: {} };
    const both: Capability = {
      exception: "Reason.",
      mobile: { rpcs: ["GetSeriesDetail"] },
      name: "Both",
      web: {},
    };
    const problems = findProblems([seriesDetail, neither, both], inventory());
    assert.equal(problems.length, 2);
    assert.match(problems[0] ?? "", /"Neither" has neither/u);
    assert.match(problems[1] ?? "", /"Both" has both/u);
  });

  it("reports what the matrix names that no longer exists", () => {
    const stale: Capability = {
      ...seriesDetail,
      mobile: { rpcs: ["GetSeriesDetail", "GetGone"] },
      tests: ["opens series detail", "a test nobody wrote"],
      web: {
        routes: ["[locale]/(site)/gone"],
        rpcs: ["GetSeriesDetail", "ListGone"],
      },
    };
    const problems = findProblems([seriesDetail, stale], inventory());
    assert.equal(problems.length, 4);
    assert.match(problems[0] ?? "", /web route \[locale\]\/\(site\)\/gone/u);
    assert.match(problems[1] ?? "", /web call ListGone/u);
    assert.match(problems[2] ?? "", /app call GetGone/u);
    assert.match(problems[3] ?? "", /a test nobody wrote/u);
  });

  it("requires a shared record to name a test", () => {
    const shared: Capability = {
      mobile: { rpcs: ["GetSeriesDetail"] },
      name: "Shared",
      sharedRecord: true,
      web: {},
    };
    const problems = findProblems([seriesDetail, shared], inventory());
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /"Shared" is a shared record/u);
  });
});
