// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TenantDocumentTitle } from "./tenant-document-title";

describe("TenantDocumentTitle", () => {
  it("Assemble document.title from page title and site name", () => {
    render(<TenantDocumentTitle pageTitle="Dashboard" siteLabel="Publira" />);

    expect(document.title).toBe("Dashboard | Publira");
  });

  it("If pageTitle is empty, set only the site name", () => {
    render(<TenantDocumentTitle pageTitle="   " siteLabel="Publira" />);

    expect(document.title).toBe("Publira");
  });

  it("If siteLabel is blank, set only the page title", () => {
    render(<TenantDocumentTitle pageTitle="Sign in" siteLabel="  " />);

    expect(document.title).toBe("Sign in");
  });
});
