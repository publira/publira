// @vitest-environment jsdom

import { DashboardIcon } from "@publira/icons";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConsoleHeader,
  ConsoleHeaderUser,
  ConsoleSidebar,
} from "./console-layout";

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} data-next-link="true">
      {children}
    </a>
  ),
}));

const navigation = [
  {
    items: [
      {
        description: "公開準備と編集状況の概況",
        href: "/",
        icon: DashboardIcon,
        label: "ダッシュボード",
      },
    ],
    title: "運用",
  },
];

afterEach(() => {
  cleanup();
});

describe("ConsoleHeader", () => {
  it("brandMark がなければテナント名だけのブランド領域になる", () => {
    render(<ConsoleHeader contextLabel="青枝出版" eyebrow="現在の運用先" />);

    expect(screen.getByText("青枝出版")).toBeDefined();
    expect(screen.queryByText("テナントロゴ")).toBeNull();
  });

  it("brandMark があればヘッダのブランド領域に載せる", () => {
    render(
      <ConsoleHeader
        brandMark={<span>テナントロゴ</span>}
        contextLabel="青枝出版"
        eyebrow="現在の運用先"
      />
    );

    expect(screen.getByText("テナントロゴ")).toBeDefined();
    expect(screen.getByText("青枝出版")).toBeDefined();
  });

  it("ログアウトはユーザーメニュー側なのでヘッダ直下には出さない", () => {
    render(<ConsoleHeader contextLabel="青枝出版" eyebrow="現在の運用先" />);

    expect(screen.queryByRole("button", { name: "ログアウト" })).toBeNull();
  });
});

describe("ConsoleHeaderUser", () => {
  it("役割ラベルに直してユーザーメニューへ渡す", () => {
    render(
      <ConsoleHeaderUser
        accountHref="/settings/account"
        currentUser={{
          name: "青枝 花子",
          publicId: "user_admin_001",
          role: "tenant_owner",
        }}
        logoutAction={() => {}}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /アカウントメニュー/u })
    );

    expect(screen.getByText("オーナー")).toBeDefined();
    expect(
      screen
        .getByRole("menuitem", { name: "アカウント設定" })
        .getAttribute("href")
    ).toBe("/settings/account");
  });
});

describe("ConsoleSidebar", () => {
  it("brandMark がなければ Publira のテキストブランドを出す", () => {
    render(
      <ConsoleSidebar logoLabel="Platform Console" navigation={navigation} />
    );

    expect(screen.getByText("Publira")).toBeDefined();
    expect(screen.getByText("Platform Console")).toBeDefined();
  });

  it("brandMark があれば Publira の代わりに載せる", () => {
    render(
      <ConsoleSidebar
        brandMark={<span>テナントロゴ</span>}
        navigation={navigation}
      />
    );

    expect(screen.queryByText("Publira")).toBeNull();
    expect(screen.getByText("テナントロゴ")).toBeDefined();
  });

  it("logoLabel がなければサブタイトルは出さない", () => {
    render(
      <ConsoleSidebar
        brandMark={<span>青枝出版</span>}
        navigation={navigation}
      />
    );

    expect(screen.getByText("青枝出版")).toBeDefined();
    expect(screen.queryByText("Admin Console")).toBeNull();
    expect(screen.queryByText("Platform Console")).toBeNull();
  });
});
