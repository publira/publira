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
import type { AdminClientMessageKey } from "#lib/messages";
import type { SeriesDeletionReference } from "#lib/series";

import type { SeriesDeleteActionState } from "../../series-types";

interface SeriesDeleteDialogProps {
  action: (
    prevState: SeriesDeleteActionState,
    formData: FormData
  ) => Promise<SeriesDeleteActionState>;
  seriesId: string;
  seriesPublicId: string;
  tenantId: string;
  /** The series' saved title, which the typed confirmation has to equal. */
  title: string;
}

const REFERENCE_LINKS: Record<
  SeriesDeletionReference,
  {
    href: (seriesPublicId: string) => string;
    message: AdminClientMessageKey;
  }
> = {
  episodes: {
    href: (seriesPublicId) => `/series/${seriesPublicId}/episodes`,
    message: "admin.series.delete.view_episodes",
  },
  promotion_codes: {
    href: () => "/promotion-codes",
    message: "admin.series.delete.view_promotion_codes",
  },
  subscription_plans: {
    href: () => "/subscription-plans",
    message: "admin.series.delete.view_subscription_plans",
  },
  volumes: {
    href: (seriesPublicId) => `/series/${seriesPublicId}/volumes`,
    message: "admin.series.delete.view_volumes",
  },
};

/** The screen a refusal points to, where what refers to the series is. */
const ReferenceLink = ({
  reference,
  seriesPublicId,
}: {
  reference: SeriesDeletionReference;
  seriesPublicId: string;
}) => {
  const { href, message } = REFERENCE_LINKS[reference];

  return (
    <Link
      className="font-medium underline underline-offset-4"
      href={href(seriesPublicId)}
    >
      <ClientMessage message={message} />
    </Link>
  );
};

/**
 * Deletes the series from a dialog that asks for its title. A refusal stays in
 * the dialog, naming what refers to the series; a deletion leaves for the
 * series list, which the Action redirects to. Every opening starts over, with
 * an empty field and no refusal left from the last one.
 */
export const SeriesDeleteDialog = ({
  action,
  seriesId,
  seriesPublicId,
  tenantId,
  title,
}: SeriesDeleteDialogProps) => {
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
        <ClientMessage message="admin.series.delete.action" />
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
                  <input name="series_id" type="hidden" value={seriesId} />
                  <input
                    name="series_public_id"
                    type="hidden"
                    value={seriesPublicId}
                  />

                  <Dialog.Header>
                    <Dialog.Title className="text-lg font-semibold">
                      <ClientMessage
                        message="admin.series.delete.confirm_title"
                        values={{ title }}
                      />
                    </Dialog.Title>
                    <Dialog.Description className="grid gap-2 text-sm text-muted-foreground">
                      <span>
                        <ClientMessage message="admin.series.delete.confirm_description" />
                      </span>
                      <span>
                        <ClientMessage message="admin.series.delete.confirm_kept" />
                      </span>
                    </Dialog.Description>
                  </Dialog.Header>

                  <Field.Root>
                    <Field.Label required>
                      <ClientMessage message="admin.series.delete.title_label" />
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
                            reference={state.reference}
                            seriesPublicId={seriesPublicId}
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
                        <ClientMessage message="admin.series.delete.confirm_action" />
                      </ActionForm.Idle>
                      <ActionForm.Pending>
                        <ClientMessage message="admin.series.delete.pending" />
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
