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
import type { LabelDeletionReference } from "#lib/label";

import type { LabelDeleteActionState } from "../../label-types";

interface LabelDeleteDialogProps {
  action: (
    prevState: LabelDeleteActionState,
    formData: FormData
  ) => Promise<LabelDeleteActionState>;
  labelId: string;
  labelPublicId: string;
  /** The label's saved name, which the typed confirmation has to equal. */
  name: string;
  tenantId: string;
}

const REFERENCE_HREFS: Record<
  LabelDeletionReference,
  (labelId: string) => string
> = {
  promotion_codes: () => "/promotion-codes",
  series: (labelId) =>
    `/series?${new URLSearchParams({ label_id: labelId }).toString()}`,
  subscription_plans: () => "/subscription-plans",
};

/** The screen a refusal points to, where what refers to the label is. */
const ReferenceLink = ({
  labelId,
  reference,
}: {
  labelId: string;
  reference: LabelDeletionReference;
}) => (
  <Link
    className="font-medium underline underline-offset-4"
    href={REFERENCE_HREFS[reference](labelId)}
  >
    {reference === "promotion_codes" ? (
      <ClientMessage message="admin.labels.delete.view_promotion_codes" />
    ) : null}
    {reference === "series" ? (
      <ClientMessage message="admin.labels.delete.view_series" />
    ) : null}
    {reference === "subscription_plans" ? (
      <ClientMessage message="admin.labels.delete.view_subscription_plans" />
    ) : null}
  </Link>
);

/**
 * Deletes the label from a dialog that asks for its name. A refusal stays in
 * the dialog, naming what refers to the label; a deletion leaves for the label
 * list, which the Action redirects to. Every opening starts over, with an
 * empty field and no refusal left from the last one.
 */
export const LabelDeleteDialog = ({
  action,
  labelId,
  labelPublicId,
  name,
  tenantId,
}: LabelDeleteDialogProps) => {
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
        <ClientMessage message="admin.labels.delete.action" />
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
                  <input name="label_id" type="hidden" value={labelId} />
                  <input
                    name="label_public_id"
                    type="hidden"
                    value={labelPublicId}
                  />

                  <Dialog.Header>
                    <Dialog.Title className="text-lg font-semibold">
                      <ClientMessage
                        message="admin.labels.delete.confirm_title"
                        values={{ name }}
                      />
                    </Dialog.Title>
                    <Dialog.Description className="grid gap-2 text-sm text-muted-foreground">
                      <span>
                        <ClientMessage message="admin.labels.delete.confirm_description" />
                      </span>
                      <span>
                        <ClientMessage message="admin.labels.delete.confirm_kept" />
                      </span>
                    </Dialog.Description>
                  </Dialog.Header>

                  <Field.Root>
                    <Field.Label required>
                      <ClientMessage message="admin.labels.delete.name_label" />
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
                      {state.reference ? (
                        <>
                          {" "}
                          <ReferenceLink
                            labelId={labelId}
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
                    {/* The Action compares the name again, so this only
                        saves a request it would refuse. */}
                    <ActionForm.Submit
                      disabled={typed !== name}
                      variant="destructiveFilled"
                    >
                      <ActionForm.Idle>
                        <ClientMessage message="admin.labels.delete.confirm_action" />
                      </ActionForm.Idle>
                      <ActionForm.Pending>
                        <ClientMessage message="admin.labels.delete.pending" />
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
