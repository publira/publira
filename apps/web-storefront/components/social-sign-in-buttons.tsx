import { Button } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Image from "next/image";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { LocaleField } from "#components/locale-field";
import { Message } from "#components/message";
import { TenantIdField } from "#components/tenant-id-field";
import { startSocialSignInAction } from "#lib/social-sign-in-actions";
import { getTenantSignInClients, getTenantSiteInfo } from "#lib/tenant";
import type { TenantImageVariant } from "#lib/tenant";
import { resolveTenantBrandMarkVariant } from "#lib/tenant-brand-mark";
import { getTenantId } from "#lib/tenant-id";

/** The height a provider's mark is drawn at, the size of the site's icons. */
const SIGN_IN_MARK_HEIGHT_PX = 16;

/**
 * The provider's mark at the head of its button, at its master's own aspect
 * ratio. The label already names the provider, so the mark is decoration and
 * has no text of its own.
 */
const SignInMark = ({ variant }: { variant: TenantImageVariant }) => (
  <Image
    alt=""
    className="h-4 w-auto shrink-0"
    height={variant.height}
    sizes={`${Math.ceil((SIGN_IN_MARK_HEIGHT_PX * variant.width) / variant.height)}px`}
    src={variant.url}
    width={variant.width}
  />
);

const SignInFields = ({
  provider,
  returnTo,
}: {
  provider: string;
  returnTo: string;
}) => (
  <>
    <LocaleField />
    <TenantIdField />
    <input name="intent" type="hidden" value="login" />
    <input name="provider" type="hidden" value={provider} />
    <input name="returnTo" type="hidden" value={returnTo} />
  </>
);

/**
 * A button per provider the tenant offers, above the other ways in the caller
 * offers as `children`, and nothing where there is neither.
 *
 * Every way in is a form, so the block shows only while it holds one: a
 * passkey control the browser cannot use renders nothing, and the divider
 * would otherwise stand above an empty space. The caller's ways in come last
 * because such a control appears only once the page has hydrated, and below
 * the providers it moves none of their buttons as it does.
 *
 * A provider's button carries the mark the tenant uploaded for it, and its
 * label alone where it uploaded none.
 */
export const SocialSignInButtons = async ({
  children,
  returnTo,
}: {
  children?: ReactNode;
  returnTo: string;
}) => {
  const tenantId = await getTenantId();

  const [clients, tenant] = await Promise.all([
    getTenantSignInClients(tenantId),
    getTenantSiteInfo(tenantId),
  ]);

  if (!clients.apple && !clients.google && !children) {
    return null;
  }

  const appleMark = resolveTenantBrandMarkVariant(tenant, "apple_sign_in");
  const googleMark = resolveTenantBrandMarkVariant(tenant, "google_sign_in");

  return (
    <div className="hidden gap-2 has-[form]:grid">
      <p className="text-center text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-8" />}>
          <Message message="storefront.auth.social.divider" />
        </Suspense>
      </p>
      {clients.apple ? (
        <form action={startSocialSignInAction}>
          <SignInFields provider="apple" returnTo={returnTo} />
          <Button className="w-full" type="submit" variant="outline">
            {appleMark ? <SignInMark variant={appleMark} /> : null}
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="storefront.auth.social.continue_with_apple" />
            </Suspense>
          </Button>
        </form>
      ) : null}
      {clients.google ? (
        <form action={startSocialSignInAction}>
          <SignInFields provider="google" returnTo={returnTo} />
          <Button className="w-full" type="submit" variant="outline">
            {googleMark ? <SignInMark variant={googleMark} /> : null}
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="storefront.auth.social.continue_with_google" />
            </Suspense>
          </Button>
        </form>
      ) : null}
      {children}
    </div>
  );
};
