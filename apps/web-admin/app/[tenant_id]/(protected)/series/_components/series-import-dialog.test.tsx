// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminLocaleTestProvider } from "#components/admin-locale-test-provider";
import {
  SERIES_IMPORT_MANIFEST_NAME,
  SERIES_IMPORT_MAX_BYTES,
  SERIES_IMPORT_PATH,
} from "#lib/series-import-manifest";
import type { SeriesImportResponse } from "#lib/series-import-manifest";

import { SeriesImportDialog } from "./series-import-dialog";

const { mockPush, mockRefresh } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

const mockFetch = vi.fn<typeof fetch>();

/** A manifest as a test writes it. */
interface Manifest {
  episodes: { pages: string[]; title: string }[];
  series: { id: string } | { title: string };
  version: number;
}

const zipFile = (manifest: Manifest) => {
  const bytes = zipSync({
    "001.png": strToU8("page"),
    [SERIES_IMPORT_MANIFEST_NAME]: strToU8(JSON.stringify(manifest)),
  });

  return new File([new Uint8Array(bytes)], "import.zip", {
    type: "application/zip",
  });
};

const validManifest = {
  episodes: [{ pages: ["001.png"], title: "Episode 1" }],
  series: { title: "A series" },
  version: 1,
};

const openAndPick = async (file: File, seriesPublicId?: string) => {
  render(
    <AdminLocaleTestProvider locale="en">
      <SeriesImportDialog currency="JPY" seriesPublicId={seriesPublicId} />
    </AdminLocaleTestProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: "Import from a ZIP" }));
  fireEvent.change(await screen.findByLabelText("ZIP file"), {
    target: { files: [file] },
  });
};

const importButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Import" });

const answer = (body: SeriesImportResponse, status = 200) =>
  mockFetch.mockResolvedValue(Response.json(body, { status }));

/** The form the dialog posted. */
const postedForm = () => {
  const body = mockFetch.mock.calls[0]?.[1]?.body;

  expect(body).toBeInstanceOf(FormData);

  // SAFETY: the assertion above holds it to `FormData`.
  return body as FormData;
};

describe("SeriesImportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("says what a valid ZIP will do before anything is sent", async () => {
    await openAndPick(zipFile(validManifest));

    expect(
      await screen.findByText(
        "Ready to create the series A series with 1 episode."
      )
    ).toBeDefined();
    expect(importButton().disabled).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("lists what is wrong with a ZIP and sends nothing", async () => {
    await openAndPick(
      zipFile({
        ...validManifest,
        episodes: [{ pages: ["gone.png"], title: "Episode 1" }],
      })
    );

    expect(
      await screen.findByText("Episode 1: gone.png is not in the ZIP.")
    ).toBeDefined();
    expect(importButton().disabled).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses a ZIP over the limit", async () => {
    const file = zipFile(validManifest);

    Object.defineProperty(file, "size", { value: SERIES_IMPORT_MAX_BYTES + 1 });
    await openAndPick(file);

    expect(
      await screen.findByText(
        "The ZIP is larger than one import takes. Keep each ZIP to 256MB or less, or import over several ZIPs."
      )
    ).toBeDefined();
  });

  it("posts the ZIP and lists each episode's outcome", async () => {
    answer({
      message: "The import stopped at the episode that failed.",
      ok: false,
      rows: [
        {
          episodePublicId: "EP001",
          pageCount: 1,
          position: 1,
          status: "imported",
          title: "Episode 1",
        },
        {
          message: "Storage is down.",
          pageCount: 3,
          position: 2,
          status: "failed",
          title: "Episode 2",
        },
        {
          pageCount: 2,
          position: 3,
          status: "not_started",
          title: "Episode 3",
        },
      ],
      seriesPublicId: "SERIES001",
    });

    await openAndPick(zipFile(validManifest));
    await screen.findByText(/Ready to create/u);
    fireEvent.click(importButton());

    expect(await screen.findByText("Storage is down.")).toBeDefined();
    expect(screen.getByText("Imported")).toBeDefined();
    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText("Not started")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Episode 1" }).getAttribute("href")
    ).toBe("/series/SERIES001/episodes/EP001");
    expect(
      screen
        .getByRole("link", { name: "Open the series' episodes" })
        .getAttribute("href")
    ).toBe("/series/SERIES001/episodes");

    expect(mockFetch.mock.calls[0]?.[0]).toBe(SERIES_IMPORT_PATH);
    expect(postedForm().get("series_public_id")).toBeNull();
    expect(mockRefresh).toHaveBeenCalledOnce();
  });

  it("names the series it may add to when it sits on an episode list", async () => {
    answer({ message: "Imported", ok: true, rows: [], seriesPublicId: "S1" });

    await openAndPick(
      zipFile({ ...validManifest, series: { id: "SERIES001" } }),
      "SERIES001"
    );
    await screen.findByText("Ready to add 1 episode to the series SERIES001.");
    fireEvent.click(importButton());

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    expect(postedForm().get("series_public_id")).toBe("SERIES001");
  });

  it("says the import may have run when the connection is lost", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    await openAndPick(zipFile(validManifest));
    await screen.findByText(/Ready to create/u);
    fireEvent.click(importButton());

    expect(
      await screen.findByText(/connection was lost during the import/u)
    ).toBeDefined();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("says the same of a gateway that gave up waiting for the answer", async () => {
    mockFetch.mockResolvedValue(
      new Response("Gateway Timeout", { status: 504 })
    );

    await openAndPick(zipFile(validManifest));
    await screen.findByText(/Ready to create/u);
    fireEvent.click(importButton());

    expect(
      await screen.findByText(/connection was lost during the import/u)
    ).toBeDefined();
  });

  it("reads a body a proxy refused as too large", async () => {
    mockFetch.mockResolvedValue(new Response("Too large", { status: 413 }));

    await openAndPick(zipFile(validManifest));
    await screen.findByText(/Ready to create/u);
    fireEvent.click(importButton());

    expect(
      await screen.findByText(/larger than one import takes/u)
    ).toBeDefined();
  });

  it("goes to the login page the route names", async () => {
    answer({ location: "/login", message: "Sign in again.", ok: false }, 401);

    await openAndPick(zipFile(validManifest));
    await screen.findByText(/Ready to create/u);
    fireEvent.click(importButton());

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/login");
    });
  });
});
