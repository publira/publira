// @vitest-environment jsdom

import type { FormActionState } from "@publira/ui-components/action-form";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageProps } from "#components/message";
import { getMessagesFor } from "#lib/messages";
import type { PlatformMessageAccessor } from "#lib/messages";

import { SearchAnalysisForm } from "./search-analysis-form";

const state = vi.hoisted(() => ({
  t: undefined as PlatformMessageAccessor | undefined,
}));

// `<Message>` is an async Server Component that only the Next.js compiler can
// render. The catalog is the real one, resolved ahead so the tree renders
// without suspending.
vi.mock("#components/message", () => ({
  Message: ({ message, values }: MessageProps) => state.t?.(message, values),
}));

const { save } = vi.hoisted(() => ({
  save: {
    calls: [] as FormData[],
    current: Promise.withResolvers<FormActionState>(),
  },
}));

vi.mock("../_lib/actions", () => ({
  updatePlatformSearchAnalysisAction: (
    _state: FormActionState,
    data: FormData
  ) => {
    save.calls.push(data);
    return save.current.promise;
  },
}));

const DEFINITION = `{
  "analyzer": {
    "written_form": {
      "tokenizer": "ja_search",
      "type": "custom"
    }
  }
}`;

const NORI_DEFINITION = JSON.stringify({
  analyzer: {
    alternate_form: { tokenizer: "nori_tokenizer", type: "custom" },
    written_form: { tokenizer: "nori_tokenizer", type: "custom" },
  },
  normalizer: { exact_match: { filter: ["lowercase"], type: "custom" } },
});

const editor = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", { name: /^Definition/u });

beforeEach(async () => {
  state.t = await getMessagesFor("en");
});

afterEach(() => {
  cleanup();
  // A submission left in flight would hold back the next test's transitions.
  save.current.resolve(null);
  save.current = Promise.withResolvers<FormActionState>();
  save.calls = [];
});

describe("SearchAnalysisForm", () => {
  it("shows the definition in force and the roles it has to define", () => {
    render(
      <SearchAnalysisForm
        settings={{
          analysis: DEFINITION,
          buildState: "serving",
          defaultAnalysis: true,
          revision: "3",
        }}
      />
    );

    expect(editor().value).toBe(DEFINITION);
    expect(screen.getByText("In use: the default definition.")).toBeTruthy();
    for (const role of ["written_form", "alternate_form", "exact_match"]) {
      expect(screen.getByText(role)).toBeTruthy();
    }
    // The default is already in force, so there is nothing to reset.
    expect(
      screen.queryByRole("button", { name: "Reset to default" })
    ).toBeNull();
  });

  // While the saved settings' index is built, or after its build failed, the
  // search answers from the previous index, so the saved definition is not
  // the one in use yet.
  it.each([
    ["building", true, /^Saved: the default definition\./u],
    ["failed", false, /^Saved: a definition of your own\./u],
  ] as const)(
    "calls the definition saved rather than in use while the build is %s",
    (buildState, defaultAnalysis, wording) => {
      render(
        <SearchAnalysisForm
          settings={{
            analysis: DEFINITION,
            buildState,
            defaultAnalysis,
            revision: "4",
          }}
        />
      );

      expect(screen.getByText(wording)).toBeTruthy();
      expect(screen.queryByText(/^In use:/u)).toBeNull();
    }
  );

  it("saves what the editor holds at the rendered revision", async () => {
    render(
      <SearchAnalysisForm
        settings={{
          analysis: DEFINITION,
          buildState: "serving",
          defaultAnalysis: true,
          revision: "3",
        }}
      />
    );

    fireEvent.change(editor(), { target: { value: NORI_DEFINITION } });
    fireEvent.click(screen.getByRole("button", { name: "Save text analysis" }));

    await waitFor(() => {
      expect(save.calls).toHaveLength(1);
    });
    expect(save.calls[0]?.get("intent")).toBe("replace");
    expect(save.calls[0]?.get("analysis")).toBe(NORI_DEFINITION);
    expect(save.calls[0]?.get("revision")).toBe("3");
  });

  it("keeps a refused definition in the editor, with the reason beside it", async () => {
    render(
      <SearchAnalysisForm
        settings={{
          analysis: DEFINITION,
          buildState: "serving",
          defaultAnalysis: true,
          revision: "3",
        }}
      />
    );

    fireEvent.change(editor(), { target: { value: NORI_DEFINITION } });
    fireEvent.click(screen.getByRole("button", { name: "Save text analysis" }));
    save.current.resolve({
      fieldErrors: {
        analysis:
          "the search engine refused the analysis definition: illegal_argument_exception: Unknown tokenizer type [nori_tokenizer] for [written_form]",
      },
      message: "The definition wasn't saved. Fix it and save again.",
      ok: false,
    });

    expect(
      await screen.findByText(/Unknown tokenizer type \[nori_tokenizer\]/u)
    ).toBeTruthy();
    expect(
      screen.getByText("The definition wasn't saved. Fix it and save again.")
    ).toBeTruthy();
    expect(editor().value).toBe(NORI_DEFINITION);
  });

  it("goes back to the default only once the operator confirms the rebuild", async () => {
    render(
      <SearchAnalysisForm
        settings={{
          analysis: NORI_DEFINITION,
          buildState: "serving",
          defaultAnalysis: false,
          revision: "5",
        }}
      />
    );
    expect(screen.getByText("In use: a saved definition.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(save.calls).toHaveLength(0);
    expect(
      within(dialog).getByText(/rebuilt with the default Japanese definition/u)
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Reset and rebuild" })
    );

    await waitFor(() => {
      expect(save.calls).toHaveLength(1);
    });
    expect(save.calls[0]?.get("intent")).toBe("default");
    expect(save.calls[0]?.get("revision")).toBe("5");

    save.current.resolve({
      message:
        "Text analysis saved. A new index is being built with it, and the search moves onto it once it's ready.",
      ok: true,
    });
    expect(await screen.findByText(/^Text analysis saved/u)).toBeTruthy();
  });

  // A save refreshes the page with the definition the server stored, laid out
  // its own way, under a new revision.
  it("shows the stored definition once the revision moves", () => {
    const { rerender } = render(
      <SearchAnalysisForm
        settings={{
          analysis: DEFINITION,
          buildState: "serving",
          defaultAnalysis: true,
          revision: "3",
        }}
      />
    );
    fireEvent.change(editor(), { target: { value: NORI_DEFINITION } });

    rerender(
      <SearchAnalysisForm
        settings={{
          analysis: '{\n  "stored": true\n}',
          buildState: "building",
          defaultAnalysis: false,
          revision: "4",
        }}
      />
    );

    expect(editor().value).toBe('{\n  "stored": true\n}');
  });
});
