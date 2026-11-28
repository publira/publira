import { describe, expect, it } from "vitest";

import { buildRecentEventHref } from "./recent-event-href";

describe("buildRecentEventHref", () => {
  it.each([
    ["tenant_created", "/tenants/01JABCDEF"],
    ["operator_role_granted", "/operators/01JABCDEF"],
    ["end_user_created", "/users/01JABCDEF"],
  ])("sends %s to %s", (eventType, href) => {
    expect(buildRecentEventHref({ eventType, target: "01JABCDEF" })).toBe(href);
  });

  it("links nothing for an event kind it does not know", () => {
    expect(
      buildRecentEventHref({ eventType: "tenant_deleted", target: "01JABCDEF" })
    ).toBeNull();
  });

  it("links nothing when the event has no target", () => {
    expect(
      buildRecentEventHref({ eventType: "operator_role_granted", target: "" })
    ).toBeNull();
  });
});
