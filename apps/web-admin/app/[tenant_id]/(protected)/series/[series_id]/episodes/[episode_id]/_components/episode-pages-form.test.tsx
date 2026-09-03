// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render as renderBase,
  screen,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleProvider } from "#components/admin-locale-context";

import { EpisodePagesForm } from "./episode-pages-form";

const render = (ui: React.ReactNode) =>
  renderBase(ui, {
    wrapper: ({ children }) => (
      <AdminLocaleProvider locale="ja">{children}</AdminLocaleProvider>
    ),
  });

vi.mock("#lib/use-tenant-id", () => ({
  useTenantId: () => "TENANT001",
}));

afterEach(() => {
  cleanup();
});

const action = vi.fn(() => Promise.resolve(null));

const renderForm = () =>
  render(
    <EpisodePagesForm
      action={action}
      episodePublicId="EP001"
      seriesPublicId="SERIES001"
    />
  );

/**
 * Next.js keeps recently visited pages mounted inside a hidden `<Activity>`
 * for its router bfcache, so two episode edit pages can sit in the document
 * at the same time.
 */
const renderBothForms = () =>
  render(
    <>
      <EpisodePagesForm
        action={action}
        episodePublicId="EP001"
        seriesPublicId="SERIES001"
      />
      <EpisodePagesForm
        action={action}
        episodePublicId="EP002"
        seriesPublicId="SERIES001"
      />
    </>
  );

const fileInput = (): HTMLInputElement =>
  screen.getByLabelText<HTMLInputElement>(
    /ページ画像|ZIP ファイル|ePub ファイル/u
  );

describe("EpisodePagesForm", () => {
  it("starts in pages mode with the file input set for images", () => {
    const { container } = renderForm();

    const uploadMode = container.querySelector(
      'input[name="upload_mode"]'
    ) as HTMLInputElement | null;
    const input = fileInput();

    expect(uploadMode?.value).toBe("pages");
    expect(input.name).toBe("pages");
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe("image/*");
    expect(
      screen.getByRole("button", { name: "ページ画像を追加" })
    ).toBeTruthy();
  });

  it("changes the input attributes and the wording when switching between ZIP and ePub", () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "ZIP で入稿" }));

    const fileInputAfterZip = fileInput();

    expect(fileInputAfterZip.name).toBe("archive");
    expect(fileInputAfterZip.multiple).toBe(false);
    expect(fileInputAfterZip.accept).toBe(".zip,application/zip");
    expect(screen.getByRole("button", { name: "ZIP を入稿" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "ePub で入稿" }));

    const fileInputAfterEpub = fileInput();

    expect(fileInputAfterEpub.name).toBe("archive");
    expect(fileInputAfterEpub.accept).toBe(".epub,application/epub+zip");
    expect(screen.getByRole("button", { name: "ePub を入稿" })).toBeTruthy();
  });

  it("shows the file name after a file is chosen and clears it when the mode changes", () => {
    renderForm();
    const input = fileInput();

    fireEvent.change(input, {
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

  it("keeps the ids unique when it is mounted twice", () => {
    renderBothForms();

    const ids = [...document.querySelectorAll("[id]")].map(
      (element) => element.id
    );

    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it("points each label at its own input when it is mounted twice", () => {
    renderBothForms();

    const inputs = screen.getAllByLabelText<HTMLInputElement>(/ページ画像/u);

    expect(inputs).toHaveLength(2);
    expect(inputs.map((input) => input.name)).toEqual(["pages", "pages"]);
  });
});
