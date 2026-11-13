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

import type { CreatorDeleteActionState } from "../../creator-types";

interface CreatorDeleteDialogProps {
  action: (
    prevState: CreatorDeleteActionState,
    formData: FormData
  ) => Promise<CreatorDeleteActionState>;
  creatorId: string;
  creatorPublicId: string;
  /** The Author's saved name, which the typed confirmation has to equal. */
  name: string;
  tenantId: string;
}

/**
 * Deletes the Author from a dialog that asks for their name. A refusal stays
 * in the dialog, naming what refers to them; a deletion leaves for the Author
 * list, which the Action redirects to. Every opening starts over, with an
 * empty field and no refusal left from the last one.
 */
export const CreatorDeleteDialog = ({
  action,
  creatorId,
  creatorPublicId,
  name,
  tenantId,
}: CreatorDeleteDialogProps) => {
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
        <ClientMessage message="admin.creators.delete.action" />
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
                  <input name="creator_id" type="hidden" value={creatorId} />
                  <input
                    name="creator_public_id"
                    type="hidden"
                    value={creatorPublicId}
                  />

                  <Dialog.Header>
                    <Dialog.Title className="text-lg font-semibold">
                      <ClientMessage
                        message="admin.creators.delete.confirm_title"
                        values={{ name }}
                      />
                    </Dialog.Title>
                    <Dialog.Description className="grid gap-2 text-sm text-muted-foreground">
                      <span>
                        <ClientMessage message="admin.creators.delete.confirm_description" />
                      </span>
                      <span>
                        <ClientMessage message="admin.creators.delete.confirm_kept" />
                      </span>
                    </Dialog.Description>
                  </Dialog.Header>

                  <Field.Root>
                    <Field.Label required>
                      <ClientMessage message="admin.creators.delete.name_label" />
                    </Field.Label>
                    <Field.Content>
                      <Input
                        autoComplete="off"
                        name="name_confirmation"
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
                      {state.reference === "series" ? (
                        <>
                          {" "}
                          <Link
                            className="font-medium underline underline-offset-4"
                            href="/series"
                          >
                            <ClientMessage message="admin.creators.delete.view_series" />
                          </Link>
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
                    {/* The Action compares the name again, so this only
                        saves a request it would refuse. */}
                    <ActionForm.Submit
                      disabled={typed !== name}
                      variant="destructiveFilled"
                    >
                      <ActionForm.Idle>
                        <ClientMessage message="admin.creators.delete.confirm_action" />
                      </ActionForm.Idle>
                      <ActionForm.Pending>
                        <ClientMessage message="admin.creators.delete.pending" />
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
