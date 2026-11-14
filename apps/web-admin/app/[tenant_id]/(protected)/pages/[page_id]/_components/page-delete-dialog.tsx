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

import { formatPagePath, isPageSlugConfirmed } from "../../page-types";
import type { PageDeleteActionState } from "../../page-types";

interface PageDeleteDialogProps {
  action: (
    prevState: PageDeleteActionState,
    formData: FormData
  ) => Promise<PageDeleteActionState>;
  pageId: string;
  /** The page's slug, which the typed confirmation has to equal. */
  slug: string;
  tenantId: string;
  /** The title of the page's default translation, which the dialog names it by. */
  title: string;
}

/**
 * Deletes the page from a dialog that asks for its slug. A refusal stays in
 * the dialog with the reason and, where there is one, a link to what clears
 * it; a deletion leaves for the page list, which the Action redirects to.
 * Every opening starts over, with an empty field and no refusal left from the
 * last one.
 */
export const PageDeleteDialog = ({
  action,
  pageId,
  slug,
  tenantId,
  title,
}: PageDeleteDialogProps) => {
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
        <ClientMessage message="admin.pages.delete.action" />
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
                  <input name="page_id" type="hidden" value={pageId} />

                  <Dialog.Header>
                    <Dialog.Title className="text-lg font-semibold">
                      <ClientMessage
                        message="admin.pages.delete.confirm_title"
                        values={{ title }}
                      />
                    </Dialog.Title>
                    <Dialog.Description className="grid gap-2 text-sm text-muted-foreground">
                      <span>
                        <ClientMessage message="admin.pages.delete.confirm_description" />
                      </span>
                      <span>
                        <ClientMessage message="admin.pages.delete.confirm_kept" />
                      </span>
                    </Dialog.Description>
                  </Dialog.Header>

                  <Field.Root>
                    <Field.Label required>
                      <ClientMessage
                        message="admin.pages.delete.slug_label"
                        values={{ slug: formatPagePath(slug) }}
                      />
                    </Field.Label>
                    <Field.Content>
                      <Input
                        autoComplete="off"
                        name="slug_confirmation"
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
                      {state.link ? (
                        <>
                          {" "}
                          <Link
                            className="font-medium underline underline-offset-4"
                            href={state.link.href}
                          >
                            {state.link.reference === "unpublish" ? (
                              <ClientMessage message="admin.pages.delete.open_published" />
                            ) : (
                              <ClientMessage message="admin.pages.delete.open_legal_pages" />
                            )}
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
                    {/* The Action compares the slug again, so this only
                        saves a request it would refuse. */}
                    <ActionForm.Submit
                      disabled={!isPageSlugConfirmed(typed, slug)}
                      variant="destructiveFilled"
                    >
                      <ActionForm.Idle>
                        <ClientMessage message="admin.pages.delete.confirm_action" />
                      </ActionForm.Idle>
                      <ActionForm.Pending>
                        <ClientMessage message="admin.pages.delete.pending" />
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
