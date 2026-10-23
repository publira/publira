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

import { EpisodeTitleForm } from "./episode-title-form";

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

const renderForm = (
  action: (
    prevState: ActionForm.State,
    formData: FormData
  ) => Promise<ActionForm.State> = () => Promise.resolve(null)
) =>
  render(
    <EpisodeTitleForm
      action={action}
      episodeId="EP001-ID"
      episodePublicId="EP001"
      initialTitle="Episode 1 — A beginning morning"
      seriesPublicId="SERIES001"
      tenantId="TENANT001"
    />
  );

afterEach(() => {
  cleanup();
});

describe("EpisodeTitleForm", () => {
  it("opens on the title the episode holds", () => {
    renderForm();

    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: /Title/u }).value
    ).toBe("Episode 1 — A beginning morning");
  });

  it("sends the new title with the episode it names", async () => {
    const action = vi.fn((_prevState: ActionForm.State, _formData: FormData) =>
      Promise.resolve(null)
    );
    renderForm(action);

    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: /Title/u,
    });
    fireEvent.change(input, { target: { value: "Episode 1 — Morning" } });
    fireEvent.click(screen.getByRole("button", { name: "Update title" }));

    await waitFor(() => {
      expect(action).toHaveBeenCalledOnce();
    });
    const formData = action.mock.calls[0]?.[1];
    expect(formData?.get("title")).toBe("Episode 1 — Morning");
    expect(formData?.get("episode_id")).toBe("EP001-ID");
    expect(formData?.get("episode_public_id")).toBe("EP001");
    expect(formData?.get("series_public_id")).toBe("SERIES001");
    expect(formData?.get("tenant_id")).toBe("TENANT001");
  });

  it("shows the refusal the Action returned", async () => {
    renderForm(() =>
      Promise.resolve({
        message: "Could not update the title. Please try again later.",
        ok: false,
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Update title" }));

    expect(
      await screen.findByText(
        "Could not update the title. Please try again later."
      )
    ).toBeTruthy();
  });

  it("writes the title in the language of its tab", async () => {
    const action = vi.fn((_prevState: ActionForm.State, _formData: FormData) =>
      Promise.resolve(null)
    );
    render(
      <EpisodeTitleForm
        action={action}
        episodeId="EP001-ID"
        episodePublicId="EP001"
        initialTitle="Episode 1 — Morning"
        seriesPublicId="SERIES001"
        tenantId="TENANT001"
        translationLocale="en"
      >
        <nav aria-label="Languages" />
      </EpisodeTitleForm>
    );

    expect(screen.getByRole("navigation", { name: "Languages" })).toBeTruthy();
    expect(
      screen.getByText("The title readers of the English site and app see.")
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update title" }));

    await waitFor(() => {
      expect(action).toHaveBeenCalledOnce();
    });
    expect(action.mock.calls[0]?.[1].get("translation_locale")).toBe("en");
  });

  it("adds the title in a language the episode has none in yet", async () => {
    const action = vi.fn((_prevState: ActionForm.State, _formData: FormData) =>
      Promise.resolve(null)
    );
    render(
      <EpisodeTitleForm
        action={action}
        episodeId="EP001-ID"
        episodePublicId="EP001"
        initialTitle=""
        seriesPublicId="SERIES001"
        tenantId="TENANT001"
        translated={false}
        translationLocale="en"
      />
    );

    expect(
      screen.getByText("This episode has no English title yet", {
        exact: false,
      })
    ).toBeTruthy();
    const input = screen.getByRole<HTMLInputElement>("textbox", {
      name: /Title/u,
    });
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "Episode 1 — Morning" } });
    fireEvent.click(screen.getByRole("button", { name: "Add translation" }));

    await waitFor(() => {
      expect(action).toHaveBeenCalledOnce();
    });
    const formData = action.mock.calls[0]?.[1];
    expect(formData?.get("title")).toBe("Episode 1 — Morning");
    expect(formData?.get("translation_locale")).toBe("en");
  });
});
