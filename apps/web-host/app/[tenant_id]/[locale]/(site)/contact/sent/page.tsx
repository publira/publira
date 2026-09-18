import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { title: t("host.contact.sent_title") };
};

/**
 * The site's name sits inside the sentence, and the locales put it in different
 * places, so the whole line resolves at once.
 */
const ContactSentDescription = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const siteLabel = await getTenantSiteLabel(tenantId, locale);

  return (
    <Message
      message="host.contact.sent_description"
      values={{ site: siteLabel }}
    />
  );
};

/** Where the contact form lands once the API has accepted the message. */
const ContactSentPage = () => (
  <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
    <header className="space-y-2 border-b border-border/50 pb-6">
      <h1 className="text-2xl font-semibold">
        <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
          <Message message="host.contact.sent_heading" />
        </Suspense>
      </h1>
    </header>
    <p className="text-sm">
      <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
        <ContactSentDescription />
      </Suspense>
    </p>
    <p className="text-sm">
      <Suspense fallback={<SkeletonLine className="inline-block h-4 w-32" />}>
        <LocaleLink
          className="text-primary underline underline-offset-4"
          href="/"
        >
          <Message message="host.contact.back_to_top" />
        </LocaleLink>
      </Suspense>
    </p>
  </div>
);

export default ContactSentPage;
