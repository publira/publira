"use server";

import { validationErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { returnToFormSchema, tenantIdSchema } from "./auth-input";
import { requirePublicSession, withPublicSessionReauth } from "./auth-session";
import { assertSameOrigin } from "./csrf";
import {
  followTarget,
  followTargetKinds,
  followsCacheTag,
  unfollowTarget,
} from "./follow";
import {
  LOCALE_FIELD_NAME,
  localeFormSchema,
  requireFormLocale,
} from "./locale-form";
import { getMessagesFor } from "./messages";
import { recordIdSchema } from "./record-id";

export type FollowActionState =
  | { isFollowing: boolean; message: string; ok: true }
  | { message: string; ok: false }
  | null;

const followFormSchema = z.object({
  intent: z.enum(["follow", "unfollow"]),
  locale: localeFormSchema,
  returnTo: returnToFormSchema,
  targetId: recordIdSchema,
  targetKind: z.enum(followTargetKinds),
  tenantId: tenantIdSchema,
});

export const toggleFollowAction = async (
  _prevState: FollowActionState,
  formData: FormData
): Promise<FollowActionState> => {
  await assertSameOrigin();
  // Read first: the rejection below is worded in the reader's language, and a
  // submission that names no locale did not come from a form this site rendered.
  const submittedLocale = requireFormLocale(formData.get(LOCALE_FIELD_NAME));
  const parsed = followFormSchema.safeParse(
    toFormDataInput(formData, {
      intent: "value",
      locale: "value",
      returnTo: "value",
      targetId: "value",
      targetKind: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    return { message: validationErrorMessage(submittedLocale), ok: false };
  }

  const { intent, locale, returnTo, targetId, targetKind, tenantId } =
    parsed.data;
  await requirePublicSession(locale, returnTo, tenantId);
  const result = await withPublicSessionReauth(
    locale,
    returnTo,
    () =>
      intent === "follow"
        ? followTarget({ locale, targetId, targetKind, tenantId })
        : unfollowTarget({ locale, targetId, targetKind, tenantId }),
    tenantId
  );
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(followsCacheTag(tenantId));
  const t = await getMessagesFor(locale);
  return {
    isFollowing: result.isFollowing,
    message:
      intent === "follow"
        ? t("host.follow.followed")
        : t("host.follow.unfollowed"),
    ok: true,
  };
};
