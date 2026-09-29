import { Checkbox } from "@publira/ui-components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import {
  consentPages,
  getTenantAgeVerification,
  getTenantLegalPages,
} from "#lib/tenant";
import type { TenantLegalPage } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

/**
 * Offered only where the tenant checks ages, and optional there: a reader who
 * leaves it empty still gets an account, and can give the date later on the
 * settings screen.
 *
 * The control carries no `max`. Capping it at today would read the clock while
 * this route prerenders, which Cache Components refuses
 * (`blocking-prerender-current-time`); a date in the future is refused by the
 * form instead.
 */
export const BirthDateField = async () => {
  const tenantId = await getTenantId();
  const [ageVerification, t] = await Promise.all([
    getTenantAgeVerification(tenantId),
    getMessages(),
  ]);
  if (ageVerification === "none") {
    return null;
  }

  return (
    <Field>
      <FieldLabel>{t("host.auth.signup.birth_date_label")}</FieldLabel>
      <FieldContent>
        <Input autoComplete="bday" name="birthDate" type="date" />
        <FieldDescription>
          {t("host.auth.signup.birth_date_help")}
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};

/** Opens in a new tab, so reading the text does not throw away the form. */
const LegalPageLink = ({ page }: { page: TenantLegalPage }) => (
  <LocaleLink
    href={page.href}
    className="text-primary underline underline-offset-4"
    rel="noopener"
    target="_blank"
  >
    {page.title}
  </LocaleLink>
);

/**
 * Asked only where the tenant names a terms or privacy page. Each version sent
 * is the one whose title this form links to, so what the API records is the
 * text the reader was shown. Keyed by those versions, so a page republished
 * while the form was open is agreed to anew rather than carried over.
 */
export const ConsentField = async () => {
  const [locale, tenantId] = await Promise.all([getLocale(), getTenantId()]);
  const pages = consentPages(await getTenantLegalPages(tenantId, locale));
  if (pages.length === 0) {
    return null;
  }

  return (
    <Field key={pages.map((page) => page.versionId).join(" ")}>
      {pages.map((page) => (
        <input
          key={page.versionId}
          name="agreedPageVersionIds"
          type="hidden"
          value={page.versionId}
        />
      ))}
      <div className="flex items-center gap-2">
        <Checkbox name="consent" required />
        <FieldLabel>
          <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
            <Message message="host.auth.signup.consent_label" />
          </Suspense>
        </FieldLabel>
      </div>
      <FieldDescription className="flex flex-wrap gap-x-4 gap-y-1 pl-6">
        {pages.map((page) => (
          <LegalPageLink key={page.versionId} page={page} />
        ))}
      </FieldDescription>
    </Field>
  );
};
