"use server";

import { getMessage } from "@publira/i18n";
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
import { LOCALE_FIELD_NAME, localeFormSchema } from "./locale-form";
import { loadHostMessages } from "./messages";

export type FollowActionState =
  | { isFollowing: boolean; message: string; ok: true }
  | { message: string; ok: false }
  | null;

const publicIdFormSchema = z.string().trim().min(1).max(64);

const followFormSchema = z.object({
  intent: z.enum(["follow", "unfollow"]),
  locale: localeFormSchema,
  publicId: publicIdFormSchema,
  returnTo: returnToFormSchema,
  targetKind: z.enum(followTargetKinds),
  tenantId: tenantIdSchema,
});

export const toggleFollowAction = async (
  _prevState: FollowActionState,
  formData: FormData
): Promise<FollowActionState> => {
  await assertSameOrigin();
  const parsed = followFormSchema.safeParse(
    toFormDataInput(formData, {
      intent: "value",
      locale: "value",
      publicId: "value",
      returnTo: "value",
      targetKind: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    // The locale field parses on its own — it falls back rather than failing —
    // so the rejection can still be worded in the reader's language.
    return {
      message: validationErrorMessage(
        localeFormSchema.parse(formData.get(LOCALE_FIELD_NAME))
      ),
      ok: false,
    };
  }

  const { intent, locale, publicId, returnTo, targetKind, tenantId } =
    parsed.data;
  await requirePublicSession(locale, returnTo, tenantId);
  const result = await withPublicSessionReauth(
    locale,
    returnTo,
    () =>
      intent === "follow"
        ? followTarget({ locale, publicId, targetKind, tenantId })
        : unfollowTarget({ locale, publicId, targetKind, tenantId }),
    tenantId
  );
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(followsCacheTag(tenantId));
  const messages = await loadHostMessages(locale);
  return {
    isFollowing: result.isFollowing,
    message: getMessage(
      messages,
      intent === "follow" ? "host.follow.followed" : "host.follow.unfollowed"
    ),
    ok: true,
  };
};
