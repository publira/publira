import * as ActionForm from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SettledToast } from "#components/settled-toast";

import { setPromotionCodePausedAction } from "../_lib/actions";

interface PromotionCodePauseButtonProps {
  codeId: string;
  /** Whether the code is paused now, which makes the button resume it. */
  paused: boolean;
  tenantId: string;
}

/**
 * Pauses the code, which refuses it until it is resumed, or resumes a paused
 * one. The drawer is re-rendered around the code as it then stands, so
 * success is a toast and a refusal is said under the button.
 */
export const PromotionCodePauseButton = ({
  codeId,
  paused,
  tenantId,
}: PromotionCodePauseButtonProps) => (
  <ActionForm.Root
    action={setPromotionCodePausedAction}
    className="grid gap-2"
    showSuccess={false}
  >
    <input name="tenant_id" type="hidden" value={tenantId} />
    <input name="promotion_code_id" type="hidden" value={codeId} />
    <input name="paused" type="hidden" value={paused ? "0" : "1"} />
    <SettledToast />
    <ActionForm.Submit variant="outline">
      {paused ? (
        <>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.promotion_codes.resume" />
            </Suspense>
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.promotion_codes.resuming" />
            </Suspense>
          </ActionForm.Pending>
        </>
      ) : (
        <>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.promotion_codes.pause" />
            </Suspense>
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.promotion_codes.pausing" />
            </Suspense>
          </ActionForm.Pending>
        </>
      )}
    </ActionForm.Submit>
  </ActionForm.Root>
);
