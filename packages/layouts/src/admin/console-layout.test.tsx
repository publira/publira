// @vitest-environment jsdom

import { DashboardIcon } from "@publira/icons";
import { cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConsoleHeader, ConsoleSidebar } from "./console-layout";

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
    render(
      <ConsoleHeader
        contextLabel="青枝出版"
        eyebrow="現在の運用先"
        logoutAction={() => {}}
      />
    );

    expect(screen.getByText("青枝出版")).toBeDefined();
    expect(screen.queryByText("テナントロゴ")).toBeNull();
  });

  it("brandMark があればヘッダのブランド領域に載せる", () => {
    render(
      <ConsoleHeader
        brandMark={<span>テナントロゴ</span>}
        contextLabel="青枝出版"
        eyebrow="現在の運用先"
        logoutAction={() => {}}
      />
    );

    expect(screen.getByText("テナントロゴ")).toBeDefined();
    expect(screen.getByText("青枝出版")).toBeDefined();
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
