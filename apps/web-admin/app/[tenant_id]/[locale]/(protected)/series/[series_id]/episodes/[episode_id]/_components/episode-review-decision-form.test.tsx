// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type * as ActionForm from "@publira/ui-components/action-form";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EpisodeReviewDecisionForm } from "./episode-review-decision-form";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

afterEach(() => {
  cleanup();
});

const renderForm = (
  action: (
    state: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State>
) =>
  render(
    <EpisodeReviewDecisionForm
      action={action}
      episodeId="EP001-ID"
      episodePublicId="EP001"
      seriesPublicId="SERIES001"
      tenantId="TENANT001"
    />
  );

describe("EpisodeReviewDecisionForm", () => {
  it.each([
    ["Approve", "approve"],
    ["Return", "return"],
  ])(
    "sends the comment with the decision its %s button names",
    async (name, decision) => {
      const action = vi.fn((_state: ActionForm.State, _formData: FormData) =>
        Promise.resolve<ActionForm.State>(null)
      );

      renderForm(action);

      fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), {
        target: { value: "Fix page 3." },
      });
      fireEvent.click(await screen.findByRole("button", { name }));

      await waitFor(() => {
        expect(action).toHaveBeenCalledTimes(1);
      });

      const formData = action.mock.calls[0]?.[1];

      expect(formData?.get("decision")).toBe(decision);
      expect(formData?.get("comment")).toBe("Fix page 3.");
      expect(formData?.get("episode_id")).toBe("EP001-ID");
    }
  );

  it("shows what the Action says about the comment beside it", async () => {
    renderForm(() =>
      Promise.resolve({
        fieldErrors: {
          comment: "Write what to fix before returning the episode.",
        },
        message: "Write what to fix before returning the episode.",
        ok: false,
      })
    );

    fireEvent.click(await screen.findByRole("button", { name: "Return" }));

    expect(
      await screen.findAllByText(
        "Write what to fix before returning the episode."
      )
    ).not.toHaveLength(0);
  });
});
