import * as AuthScreen from "@publira/layouts/auth-screen";
import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { z } from "zod";

import { LocaleField } from "#components/locale-field";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { TenantIdField } from "#components/tenant-id-field";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import type { StorefrontMessageKey } from "#lib/messages";
import { getTenantSiteCopy, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { SignInPanel } from "../../../_components/sign-in-panel";
import * as BrowserCheckoutForm from "./_components/browser-checkout-form";
import { readBrowserCheckout } from "./_lib/browser-checkout";
import { checkoutScriptOf } from "./_lib/checkout-scripts";

type PayPageProps =
  PageProps<"/[tenant_id]/[locale]/pay/[provider_id]/[checkout_id]">;

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "provider_id", "checkout_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { robots: { index: false }, title: t("storefront.pay.title") };
};

const payParamsSchema = z.object({
  checkout_id: routeParamString({ maxLength: 64 }),
  provider_id: routeParamString({ maxLength: 64 }),
});

const PayHeader = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [{ siteTagline }, siteLabel] = await Promise.all([
    getTenantSiteCopy(tenantId, locale),
    getTenantSiteLabel(tenantId, locale),
  ]);

  return (
    <>
      <AuthScreen.Title>{siteLabel}</AuthScreen.Title>
      {siteTagline ? (
        <AuthScreen.Tagline>{siteTagline}</AuthScreen.Tagline>
      ) : null}
    </>
  );
};

/** One labelled text field of the form, its label resolved from the catalog. */
const PayField = ({
  autoComplete,
  label,
  labelWidth,
  name,
  required = false,
  children,
}: {
  autoComplete: string;
  label: StorefrontMessageKey;
  labelWidth: string;
  name: string;
  required?: boolean;
  children?: ReactNode;
}) => (
  <Field.Root>
    <Field.Label required={required}>
      <Suspense fallback={<SkeletonLine className={`h-4 ${labelWidth}`} />}>
        <Message message={label} />
      </Suspense>
    </Field.Label>
    <Field.Content>
      <Input
        autoComplete={autoComplete}
        name={name}
        required={required}
        type="text"
      />
      {children}
    </Field.Content>
  </Field.Root>
);

/**
 * What the provider asks of the reader that the server holds nothing of: the
 * name it bills, and the address it is billed at.
 */
const BuyerFields = () => (
  <>
    <div className="grid gap-4 sm:grid-cols-2">
      <PayField
        autoComplete="family-name"
        label="storefront.pay.family_name_label"
        labelWidth="w-20"
        name="familyName"
        required
      />
      <PayField
        autoComplete="given-name"
        label="storefront.pay.given_name_label"
        labelWidth="w-20"
        name="givenName"
        required
      />
    </div>
    <PayField
      autoComplete="postal-code"
      label="storefront.pay.postal_code_label"
      labelWidth="w-24"
      name="postalCode"
      required
    >
      <Field.Description>
        <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
          <Message message="storefront.pay.postal_code_help" />
        </Suspense>
      </Field.Description>
    </PayField>
    <PayField
      autoComplete="address-level1"
      label="storefront.pay.prefecture_label"
      labelWidth="w-24"
      name="prefecture"
      required
    />
    <PayField
      autoComplete="address-level2"
      label="storefront.pay.city_label"
      labelWidth="w-20"
      name="city"
      required
    />
    <PayField
      autoComplete="address-line1"
      label="storefront.pay.address_line_label"
      labelWidth="w-28"
      name="addressLine"
      required
    />
    <PayField
      autoComplete="address-line2"
      label="storefront.pay.building_label"
      labelWidth="w-32"
      name="building"
    />
  </>
);

/** The form before the checkout is read: its fields, at the heights they render at. */
const PayFormSkeleton = () => (
  <div aria-hidden="true" className="grid gap-4">
    {[
      ["name", "w-20"],
      ["postalCode", "w-24"],
      ["prefecture", "w-24"],
      ["city", "w-20"],
      ["addressLine", "w-28"],
    ].map(([field, width]) => (
      <div className="grid gap-2" key={field}>
        <SkeletonLine className={`h-4 ${width}`} />
        <Skeleton className="h-10 w-full" />
      </div>
    ))}
    <Skeleton className="h-9 w-40" />
  </div>
);

/** A checkout the page cannot run, and the way back into the site. */
const PayUnavailable = ({ children }: { children: ReactNode }) => (
  <>
    <FormMessage variant="destructive">{children}</FormMessage>
    <p>
      <Suspense fallback={<SkeletonLine className="inline-block h-4 w-32" />}>
        <LocaleLink
          className="text-primary underline underline-offset-4"
          href="/"
        >
          <Message message="storefront.pay.to_home" />
        </LocaleLink>
      </Suspense>
    </p>
  </>
);

/**
 * The checkout the URL names, read on every request. One the tenant does not
 * hold, of a provider whose checkouts do not run in the browser or whose
 * script this build cannot run, is not found; one that can no longer be paid
 * says so instead of opening the provider's checkout.
 */
const PayForm = async ({ params }: Pick<PayPageProps, "params">) => {
  const parsed = parseRouteParams(payParamsSchema, await params);

  if (!parsed) {
    notFound();
  }

  const { checkout_id: checkoutId, provider_id: providerId } = parsed;

  if (!checkoutScriptOf(providerId)) {
    notFound();
  }

  await connection();
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const read = await readBrowserCheckout({
    checkoutId,
    locale,
    tenantId,
    provider: providerId,
  });

  if (read.kind === "missing") {
    notFound();
  }

  if (read.kind === "closed") {
    return (
      <PayUnavailable>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="storefront.pay.closed" />
        </Suspense>
      </PayUnavailable>
    );
  }

  if (read.kind === "failed") {
    return <PayUnavailable>{read.message}</PayUnavailable>;
  }

  return (
    <BrowserCheckoutForm.Root
      checkout={read.checkout}
      checkoutId={checkoutId}
      providerId={providerId}
    >
      <LocaleField />
      <TenantIdField />
      <BuyerFields />
      <ActionForm.Submit className="justify-self-start">
        <ActionForm.Idle>
          <BrowserCheckoutForm.Launch>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="storefront.pay.submit" />
            </Suspense>
          </BrowserCheckoutForm.Launch>
          <BrowserCheckoutForm.Retry>
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="storefront.pay.retry" />
            </Suspense>
          </BrowserCheckoutForm.Retry>
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="storefront.pay.submitting" />
          </Suspense>
        </ActionForm.Pending>
      </ActionForm.Submit>
    </BrowserCheckoutForm.Root>
  );
};

/**
 * Where a checkout of a provider whose payments only its own script can make
 * sends the reader: the URL the checkout RPC answered, reached by the
 * checkout's id without a session, because the app opens a checkout in the
 * system browser. The reader types the name and the address the provider asks
 * for, and the page opens the provider's checkout with them.
 */
const PayPage = ({ params }: PayPageProps) => (
  <AuthScreen.Root>
    <AuthScreen.Main>
      <AuthScreen.Header>
        <Suspense fallback={<Skeleton className="h-8 w-40" />}>
          <PayHeader />
        </Suspense>
      </AuthScreen.Header>

      <AuthScreen.Body>
        <AuthScreen.Note>
          <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
            <Message message="storefront.pay.description" />
          </Suspense>
        </AuthScreen.Note>

        <Suspense fallback={<PayFormSkeleton />}>
          <PayForm params={params} />
        </Suspense>
      </AuthScreen.Body>
    </AuthScreen.Main>

    <SignInPanel />
  </AuthScreen.Root>
);

export default PayPage;
