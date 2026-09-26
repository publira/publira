// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommentDeleteButton } from "./comment-delete-button";

vi.mock("#components/locale-provider", () => ({
  useLocale: () => "en",
  useTenantDefaultLocale: () => "en",
}));

// `<Message>` is an async Server Component that only the Next.js compiler can
// render. The catalog is the real one, so the assertions stay on the copy a
// reader actually sees.
vi.mock("#components/message", () => ({
  Message: ({ message }: { message: MessageKey<SharedMessages> }) =>
    bindMessages(sharedCatalog("en"))(message),
}));

const { withdrawEpisodeCommentAction } = vi.hoisted(() => ({
  withdrawEpisodeCommentAction: vi.fn(),
}));

vi.mock("../_lib/comment-actions", () => ({
  withdrawEpisodeCommentAction,
}));

afterEach(() => {
  cleanup();
  withdrawEpisodeCommentAction.mockReset();
});

const renderDeleteButton = () =>
  render(
    <CommentDeleteButton
      aria-label="Delete your comment from May 1"
      commentPublicId="COMMENT01"
      episodePublicId="EPISODE01"
      returnTo="/series/SERIES01/episodes/EPISODE01"
      tenantId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    />
  );

describe("CommentDeleteButton", () => {
  it("deletes the comment and takes the control away once it is gone", async () => {
    withdrawEpisodeCommentAction.mockResolvedValue({
      message: "Your comment was deleted.",
      ok: true,
    });

    renderDeleteButton();

    fireEvent.click(
      screen.getByRole("button", { name: "Delete your comment from May 1" })
    );

    await waitFor(() => {
      expect(screen.getByText("Your comment was deleted.")).toBeTruthy();
    });
    expect(screen.queryByRole("button")).toBeNull();
    const formData: FormData = withdrawEpisodeCommentAction.mock.calls[0]?.[1];
    expect(formData.get("commentPublicId")).toBe("COMMENT01");
    expect(formData.get("episodePublicId")).toBe("EPISODE01");
    expect(formData.get("locale")).toBe("en");
  });

  it("keeps the control when the Action refuses", async () => {
    withdrawEpisodeCommentAction.mockResolvedValue({
      message: "Could not delete your comment.",
      ok: false,
    });

    renderDeleteButton();

    fireEvent.click(
      screen.getByRole("button", { name: "Delete your comment from May 1" })
    );

    await waitFor(() => {
      expect(screen.getByText("Could not delete your comment.")).toBeTruthy();
    });
    expect(
      screen.getByRole("button", { name: "Delete your comment from May 1" })
        .textContent
    ).toBe("Delete");
  });
});
