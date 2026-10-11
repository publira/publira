import { z } from "zod";

import { getTenantMobileAppAssociation } from "#lib/mobile-app-association";
import { isTenantIdFormat } from "#lib/tenant-id-format";

const androidCallbackPathSchema = z.object({
  provider: z.literal("apple"),
  tenantId: z.string().refine(isTenantIdFormat),
});

/**
 * What Apple posts back to the Android app's sign-in. `state` is the
 * application ID of the app that started it, which the app hands Apple for
 * exactly this; `error` replaces the token when the reader stopped.
 */
const androidCallbackFormSchema = z.object({
  code: z.string().optional(),
  error: z.string().optional(),
  id_token: z.string().optional(),
  state: z.string().min(1),
  user: z.string().optional(),
});

type AndroidCallbackForm = z.output<typeof androidCallbackFormSchema>;

const readAndroidCallbackForm = async (
  request: Request
): Promise<AndroidCallbackForm | null> => {
  try {
    const formData = await request.formData();
    const parsed = androidCallbackFormSchema.safeParse(
      Object.fromEntries(
        [...formData.entries()].filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      )
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** The `dev` flavor of the tenant's app, which a store build never is. */
const devApplicationId = (applicationId: string) => `${applicationId}.dev`;

/**
 * The application IDs this storefront hands an answer back to: the tenant's
 * app, and where the storefront runs in development its `dev` flavor as well.
 * An intent's package is not checked against a signature, so in production a
 * `dev` flavor is whatever app claims that name, and is never handed a token.
 */
const acceptedApplicationIds = (applicationId: string): string[] =>
  process.env.NODE_ENV === "production"
    ? [applicationId]
    : [applicationId, devApplicationId(applicationId)];

/**
 * Sent in place of Apple's answer to a `dev` flavor a production storefront
 * does not hand one to, so the app reports a failed sign-in instead of
 * leaving the reader on a blank tab.
 */
const DEV_BUILD_REFUSED = "dev_build_refused";

/**
 * The Android intent `sign_in_with_apple` waits for, carrying `fields` as the
 * query its callback activity parses.
 */
const appIntentUrl = (
  applicationId: string,
  fields: Record<string, string | undefined>
) => {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) {
      query.set(name, value);
    }
  }
  return `intent://callback?${query.toString()}#Intent;package=${applicationId};scheme=signinwithapple;end`;
};

/**
 * A redirect the browser follows as a navigation, which is what opens an
 * intent; a 303 makes it a GET rather than a second post.
 */
const openApp = (
  applicationId: string,
  fields: Record<string, string | undefined>
) =>
  new Response(null, {
    headers: { Location: appIntentUrl(applicationId, fields) },
    status: 303,
  });

/**
 * Where Apple posts the Android app's sign-in back to. Android has no native
 * Sign in with Apple, so the app runs Apple's web flow with the tenant's
 * Services ID, and Apple answers only to an `https://` address registered on
 * it. Nothing is signed in here: the answer goes on to the app, which sends
 * the token to `LoginWithIdToken` itself, with the nonce only it holds.
 */
export const POST = async (
  request: Request,
  {
    params,
  }: RouteContext<"/[tenant_id]/api/v1/auth/[provider]/callback/android">
) => {
  const { provider, tenant_id } = await params;
  const path = androidCallbackPathSchema.safeParse({
    provider,
    tenantId: tenant_id,
  });
  if (!path.success) {
    return new Response(null, { status: 404 });
  }

  const form = await readAndroidCallbackForm(request);
  if (!form) {
    return new Response(null, { status: 400 });
  }

  const association = await getTenantMobileAppAssociation(path.data.tenantId);
  if (!association.ok) {
    return new Response(null, {
      headers: { "Retry-After": "30" },
      status: 503,
    });
  }
  const applicationId = association.value.android?.applicationId ?? "";
  if (!applicationId) {
    return new Response(null, { status: 404 });
  }
  // Only an app of this tenant's is handed the answer, whatever a forged post
  // names.
  if (acceptedApplicationIds(applicationId).includes(form.state)) {
    return openApp(form.state, form);
  }
  // A `dev` build pointed at a production storefront offers Apple too, since
  // it cannot tell how the storefront runs; it is told the sign-in failed,
  // with nothing of Apple's answer.
  if (form.state === devApplicationId(applicationId)) {
    return openApp(form.state, {
      error: DEV_BUILD_REFUSED,
      state: form.state,
    });
  }
  return new Response(null, { status: 400 });
};
