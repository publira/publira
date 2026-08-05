// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EpisodePagesForm } from "./episode-pages-form";

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

vi.mock("@publira/ui-components/button", () => ({
  Button: (props: React.ComponentProps<"button">) => (
    <button {...props} type="button" />
  ),
}));

vi.mock("@publira/ui-components/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  CardHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  CardTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

vi.mock("@publira/ui-components/field", () => ({
  Field: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FieldContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  FieldDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  FieldLabel: ({
    children,
    htmlFor,
  }: {
    children: React.ReactNode;
    htmlFor?: string;
  }) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock("@publira/ui-components/form-message", () => ({
  FormMessage: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
}));

vi.mock("@publira/ui-components/input", () => ({
  Input: (props: React.ComponentPropsWithRef<"input">) => <input {...props} />,
}));

afterEach(() => {
  cleanup();
});

describe("EpisodePagesForm", () => {
  const action = vi.fn(() => Promise.resolve(null));

  const renderForm = () =>
    render(
      <EpisodePagesForm
        action={action}
        episodePublicId="EP001"
        seriesPublicId="SERIES001"
      />
    );

  it("初期状態は pages モードでファイル入力が画像向けになる", () => {
    const { container } = renderForm();

    const uploadMode = container.querySelector(
      'input[name="upload_mode"]'
    ) as HTMLInputElement | null;
    const fileInput = container.querySelector(
      "#episode_pages"
    ) as HTMLInputElement | null;

    expect(uploadMode?.value).toBe("pages");
    expect(fileInput?.name).toBe("pages");
    expect(fileInput?.multiple).toBe(true);
    expect(fileInput?.accept).toBe("image/*");
    expect(
      screen.getByRole("button", { name: "ページ画像を追加" })
    ).toBeTruthy();
  });

  it("ZIP と ePub の切り替えで入力属性と文言が変わる", () => {
    const { container } = renderForm();

    fireEvent.click(screen.getByRole("button", { name: "ZIP で入稿" }));

    const fileInputAfterZip = container.querySelector(
      "#episode_pages"
    ) as HTMLInputElement | null;

    expect(fileInputAfterZip?.name).toBe("archive");
    expect(fileInputAfterZip?.multiple).toBe(false);
    expect(fileInputAfterZip?.accept).toBe(".zip,application/zip");
    expect(screen.getByRole("button", { name: "ZIP を入稿" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "ePub で入稿" }));

    const fileInputAfterEpub = container.querySelector(
      "#episode_pages"
    ) as HTMLInputElement | null;

    expect(fileInputAfterEpub?.name).toBe("archive");
    expect(fileInputAfterEpub?.accept).toBe(".epub,application/epub+zip");
    expect(screen.getByRole("button", { name: "ePub を入稿" })).toBeTruthy();
  });

  it("ファイル選択後にファイル名を表示し、モード切り替えでクリアする", () => {
    const { container } = renderForm();
    const fileInput = container.querySelector(
      "#episode_pages"
    ) as HTMLInputElement | null;

    expect(fileInput).toBeTruthy();
    if (!fileInput) {
      return;
    }

    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(["a"], "page-1.png", { type: "image/png" }),
          new File(["b"], "page-2.png", { type: "image/png" }),
        ],
      },
    });

    expect(screen.getByText("page-1.png")).toBeTruthy();
    expect(screen.getByText("page-2.png")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "ZIP で入稿" }));

    expect(screen.queryByText("page-1.png")).toBeNull();
    expect(screen.queryByText("page-2.png")).toBeNull();
  });
});
