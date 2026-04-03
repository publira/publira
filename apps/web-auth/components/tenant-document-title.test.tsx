// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TenantDocumentTitle } from "./tenant-document-title";

describe("TenantDocumentTitle", () => {
  it("ページタイトルとサイト名から document.title を組み立てる", () => {
    render(
      <TenantDocumentTitle pageTitle="ダッシュボード" siteLabel="Publira" />
    );

    expect(document.title).toBe("ダッシュボード | Publira");
  });

  it("pageTitle が空ならサイト名のみを設定する", () => {
    render(<TenantDocumentTitle pageTitle="   " siteLabel="Publira" />);

    expect(document.title).toBe("Publira");
  });

  it("siteLabel が空白ならフォールバック名を使う", () => {
    render(<TenantDocumentTitle pageTitle="ログイン" siteLabel="  " />);

    expect(document.title).toBe("ログイン | サイト");
  });
});
