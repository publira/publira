"use server";

import { VALIDATION_ERROR_MESSAGE } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { returnToFormSchema, tenantIdFormSchema } from "./auth-input";
import { requirePublicSession, withPublicSessionReauth } from "./auth-session";
import {
  followTarget,
  followTargetKinds,
  followsCacheTag,
  unfollowTarget,
} from "./follow";

export type FollowActionState =
  | { isFollowing: boolean; message: string; ok: true }
  | { message: string; ok: false }
  | null;

const publicIdFormSchema = z.string().trim().min(1).max(64);

const followFormSchema = z.object({
  intent: z.enum(["follow", "unfollow"]),
  publicId: publicIdFormSchema,
  returnTo: returnToFormSchema,
  targetKind: z.enum(followTargetKinds),
  tenantId: tenantIdFormSchema,
});

export const toggleFollowAction = async (
  _prevState: FollowActionState,
  formData: FormData
): Promise<FollowActionState> => {
  const parsed = followFormSchema.safeParse(
    toFormDataInput(formData, {
      intent: "value",
      publicId: "value",
      returnTo: "value",
      targetKind: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return {
      message: VALIDATION_ERROR_MESSAGE,
      ok: false,
    };
  }

  const { intent, publicId, returnTo, targetKind, tenantId } = parsed.data;
  await requirePublicSession(returnTo);
  const result = await withPublicSessionReauth(returnTo, () =>
    intent === "follow"
      ? followTarget({ publicId, targetKind, tenantId })
      : unfollowTarget({ publicId, targetKind, tenantId })
  );
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(followsCacheTag(tenantId));
  return {
    isFollowing: result.isFollowing,
    message:
      intent === "follow" ? "フォローしました。" : "フォローを解除しました。",
    ok: true,
  };
};
