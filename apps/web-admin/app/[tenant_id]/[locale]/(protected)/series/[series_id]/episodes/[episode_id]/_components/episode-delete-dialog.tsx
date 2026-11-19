"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as Dialog from "@publira/ui-components/dialog";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import Link from "next/link";
import { useState } from "react";

import { ClientMessage } from "#components/client-message";
import type { EpisodeDeletionReference } from "#lib/episode";

import type { EpisodeDeleteActionState } from "../episode-edit-types";

interface EpisodeDeleteDialogProps {
  action: (
    prevState: EpisodeDeleteActionState,
    formData: FormData
  ) => Promise<EpisodeDeleteActionState>;
  episodeId: string;
  episodePublicId: string;
  seriesId: string;
  seriesPublicId: string;
  tenantId: string;
  /** The episode's saved title, which the typed confirmation has to equal. */
  title: string;
}

/** The list a refusal points to, filtered to this episode. */
const ReferenceLink = ({
  episodePublicId,
  reference,
}: {
  episodePublicId: string;
  reference: EpisodeDeletionReference;
}) => {
  const query = new URLSearchParams({ episode: episodePublicId }).toString();

  return reference === "purchases" ? (
    <Link
      className="font-medium underline underline-offset-4"
      href={`/purchases?${query}`}
    >
      <ClientMessage message="admin.series.episodes.delete.view_purchases" />
    </Link>
  ) : (
    <Link
      className="font-medium underline underline-offset-4"
      href={`/access-tickets?${query}`}
    >
      <ClientMessage message="admin.series.episodes.delete.view_access_tickets" />
    </Link>
  );
};

/**
 * Deletes the episode from a dialog that asks for its title. A refusal stays
 * in the dialog, naming what refers to the episode; a deletion leaves for the
 * series' episode list, which the Action redirects to. Every opening starts
 * over, with an empty field and no refusal left from the last one.
 */
export const EpisodeDeleteDialog = ({
  action,
  episodeId,
  episodePublicId,
  seriesId,
  seriesPublicId,
  tenantId,
  title,
}: EpisodeDeleteDialogProps) => {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(0);
  const [typed, setTyped] = useState("");

  const handleOpenChange = (next: boolean) => {
    setOpen(next);

    if (next) {
      setOpening((current) => current + 1);
      setTyped("");
    }
  };

  return (
    <Dialog.Root onOpenChange={handleOpenChange} open={open}>
      <Dialog.Trigger render={<Button type="button" variant="destructive" />}>
        <ClientMessage message="admin.series.episodes.delete.action" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup>
            <ActionForm.Root
              action={action}
              className="grid gap-4"
              key={opening}
            >
              {({ state }) => (
                <>
                  <input name="tenant_id" type="hidden" value={tenantId} />
                  <input name="episode_id" type="hidden" value={episodeId} />
                  <input
                    name="episode_public_id"
                    type="hidden"
                    value={episodePublicId}
                  />
                  <input name="series_id" type="hidden" value={seriesId} />
                  <input
                    name="series_public_id"
                    type="hidden"
                    value={seriesPublicId}
                  />

                  <Dialog.Header>
                    <Dialog.Title className="text-lg font-semibold">
                      <ClientMessage
                        message="admin.series.episodes.delete.confirm_title"
                        values={{ title }}
                      />
                    </Dialog.Title>
                    <Dialog.Description className="grid gap-2 text-sm text-muted-foreground">
                      <span>
                        <ClientMessage message="admin.series.episodes.delete.confirm_description" />
                      </span>
                      <span>
                        <ClientMessage message="admin.series.episodes.delete.confirm_kept" />
                      </span>
                    </Dialog.Description>
                  </Dialog.Header>

                  <Field.Root>
                    <Field.Label required>
                      <ClientMessage message="admin.series.episodes.delete.title_label" />
                    </Field.Label>
                    <Field.Content>
                      <Input
                        autoComplete="off"
                        name="title_confirmation"
                        onValueChange={setTyped}
                        required
                        spellCheck={false}
                        type="text"
                        value={typed}
                      />
                    </Field.Content>
                  </Field.Root>

                  {state ? (
                    <FormMessage variant="destructive">
                      {state.message}
                      {state.reference ? (
                        <>
                          {" "}
                          <ReferenceLink
                            episodePublicId={episodePublicId}
                            reference={state.reference}
                          />
                        </>
                      ) : null}
                    </FormMessage>
                  ) : null}

                  <Dialog.Footer>
                    <Dialog.Close
                      render={<Button type="button" variant="outline" />}
                    >
                      <ClientMessage message="admin.common.cancel" />
                    </Dialog.Close>
                    {/* The Action compares the title again, so this only
                        saves a request it would refuse. */}
                    <ActionForm.Submit
                      disabled={typed !== title}
                      variant="destructiveFilled"
                    >
                      <ActionForm.Idle>
                        <ClientMessage message="admin.series.episodes.delete.confirm_action" />
                      </ActionForm.Idle>
                      <ActionForm.Pending>
                        <ClientMessage message="admin.series.episodes.delete.pending" />
                      </ActionForm.Pending>
                    </ActionForm.Submit>
                  </Dialog.Footer>
                </>
              )}
            </ActionForm.Root>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
