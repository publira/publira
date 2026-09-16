"use client";

import { useToastManager } from "@publira/ui-components";
import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { useActionState } from "react";

import { useClientMessages } from "#components/client-message";
import { useTenantId } from "#lib/use-tenant-id";

import { approveCommentAction, restoreCommentAction } from "../_lib/actions";
import type { CommentActionState } from "../comment-types";

/**
 * The two moderation actions that need nothing from the operator but the
 * decision itself.
 *
 * Both put a comment back into circulation, and neither is destructive — an
 * approval can be undone by removing the comment again, and a restore by
 * removing it again too — so neither asks for a confirmation. The reason field
 * the API accepts is left empty for the same reason: it exists for the
 * removals a tenant may have to account for.
 */
export type PlainCommentAction = "approve" | "restore";

interface CommentActionButtonProps {
  action: PlainCommentAction;
  publicId: string;
}

export const CommentActionButton = ({
  action,
  publicId,
}: CommentActionButtonProps) => {
  const t = useClientMessages();
  const copy =
    action === "approve"
      ? {
          done: t("admin.comments.approved"),
          idle: t("admin.comments.approve"),
          pending: t("admin.comments.approving"),
        }
      : {
          done: t("admin.comments.restored"),
          idle: t("admin.comments.restore"),
          pending: t("admin.comments.restoring"),
        };
  const tenantId = useTenantId();
  const { add } = useToastManager();
  // The Action drops the comment cache tag itself, so the list and the
  // navigation badge both come back updated; nothing here asks the router for
  // a refresh.
  const [state, formAction, isPending] = useActionState(
    async (
      previousState: CommentActionState,
      formData: FormData
    ): Promise<CommentActionState> => {
      const nextState = await (action === "approve"
        ? approveCommentAction(previousState, formData)
        : restoreCommentAction(previousState, formData));
      if (nextState?.ok) {
        add({ title: copy.done, type: "success" });
      }
      return nextState;
    },
    null
  );

  return (
    <form action={formAction} className="grid gap-1">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="public_id" type="hidden" value={publicId} />
      <Button
        disabled={isPending}
        size="sm"
        type="submit"
        variant={action === "approve" ? "default" : "outline"}
      >
        {isPending ? copy.pending : copy.idle}
      </Button>
      {state && !state.ok && state.publicId === publicId ? (
        <FormMessage variant="destructive">{state.message}</FormMessage>
      ) : null}
    </form>
  );
};
