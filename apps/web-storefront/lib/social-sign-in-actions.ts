"use server";

import { toFormDataInput } from "@publira/utils/form-data";
import { z } from "zod";

import { returnToFormSchema } from "./auth-input";
import { requirePublicSession } from "./auth-session";
import { assertSameOrigin } from "./csrf";
import { localeFormSchema } from "./locale-form";
import { SIGN_IN_PROVIDERS } from "./sign-in-provider";
import { CONFIRMING_SCREENS } from "./social-sign-in-paths";
import { sendToProvider } from "./social-sign-in-start";
import { isTenantIdFormat } from "./tenant-id-format";

/**
 * An email change is started from its own form, which carries the addresses
 * the sign-in confirms, so this form offers signing in and deleting only.
 */
const startSignInFormSchema = z.object({
  intent: z.enum(["login", "delete"]),
  locale: localeFormSchema,
  provider: z.enum(SIGN_IN_PROVIDERS),
  returnTo: returnToFormSchema,
  tenantId: z.string().refine(isTenantIdFormat),
});

/**
 * Send the reader to the provider. Confirming a deletion needs the session it
 * deletes, so that intent is refused without one before the reader leaves the
 * site.
 */
export const startSocialSignInAction = async (
  formData: FormData
): Promise<void> => {
  await assertSameOrigin();
  const parsed = startSignInFormSchema.safeParse(
    toFormDataInput(formData, {
      intent: "value",
      locale: "value",
      provider: "value",
      returnTo: "value",
      tenantId: "value",
    })
  );
  if (!parsed.success) {
    // Every field is hidden, so a form that fails here was not the site's.
    throw new Error("the sign-in form was tampered with");
  }

  const { intent, locale, provider, returnTo, tenantId } = parsed.data;
  const accessToken =
    intent === "delete"
      ? await requirePublicSession(locale, CONFIRMING_SCREENS.delete, tenantId)
      : undefined;

  await sendToProvider({
    ...(accessToken ? { accessToken } : {}),
    intent,
    locale,
    provider,
    returnTo,
    tenantId,
  });
};
