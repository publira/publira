import * as ActionForm from "@publira/ui-components/action-form";
import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { PromotionCodeItem } from "#lib/promotion-code-shared";

import { updatePromotionCodeAction } from "../_lib/actions";
import { PromotionCodeLimitsFields } from "./promotion-code-limits-fields";

interface PromotionCodeEditFormProps {
  /** Where Cancel returns: the code's terms, on the same page of the list. */
  cancelHref: string;
  code: PromotionCodeItem;
  /** The page of the list the drawer was opened from, which saving returns to. */
  listToken: string;
  tenantId: string;
  timeZone: string;
}

/**
 * The window and the limits of a code, the part of it that can change. The
 * code, the discount, and the target are fixed, so the form offers none of
 * them. Saving goes back to the code's terms.
 */
export const PromotionCodeEditForm = ({
  cancelHref,
  code,
  listToken,
  tenantId,
  timeZone,
}: PromotionCodeEditFormProps) => (
  <ActionForm.Root action={updatePromotionCodeAction} className="grid gap-5">
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="promotion_code_id" type="hidden" value={code.id} />
    <input name="list_token" type="hidden" value={listToken} />

    <p className="text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
        <Message message="admin.promotion_codes.edit_description" />
      </Suspense>
    </p>

    <ActionForm.Fieldset className="grid gap-5">
      <PromotionCodeLimitsFields initialCode={code} timeZone={timeZone} />
    </ActionForm.Fieldset>

    <div className="flex justify-end gap-2">
      <LinkButton
        render={<Link href={cancelHref} scroll={false} />}
        variant="outline"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="admin.common.cancel" />
        </Suspense>
      </LinkButton>
      <ActionForm.Submit>
        <ActionForm.Idle>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.promotion_codes.save" />
          </Suspense>
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.promotion_codes.saving" />
          </Suspense>
        </ActionForm.Pending>
      </ActionForm.Submit>
    </div>
  </ActionForm.Root>
);
