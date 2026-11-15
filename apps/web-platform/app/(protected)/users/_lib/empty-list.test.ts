import { describe, expect, it } from "vitest";

import { emptyListCause } from "./empty-list";

const noFilters = {
  createdFrom: "",
  createdTo: "",
  email: "",
  status: "",
  tenantQuery: "",
};

describe("emptyListCause", () => {
  it("is none when nothing narrows the list", () => {
    expect(emptyListCause(noFilters, "")).toBe("none");
  });

  it("is email when the address is the only filter", () => {
    expect(
      emptyListCause({ ...noFilters, email: "reader@example.com" }, "")
    ).toBe("email");
  });

  it("is filtered when another filter narrows the address search", () => {
    expect(
      emptyListCause(
        { ...noFilters, email: "reader@example.com", status: "suspended" },
        ""
      )
    ).toBe("filtered");
    expect(
      emptyListCause({ ...noFilters, email: "reader@example.com" }, "tenant_a")
    ).toBe("filtered");
  });

  it("is filtered for the other filters without an address", () => {
    expect(
      emptyListCause({ ...noFilters, createdFrom: "2026-03-01" }, "")
    ).toBe("filtered");
  });
});
