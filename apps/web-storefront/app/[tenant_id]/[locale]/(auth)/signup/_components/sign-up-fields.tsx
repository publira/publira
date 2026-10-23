import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";

import { LegalPagesConsentField } from "#components/legal-pages-consent-field";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import {
  consentPages,
  getTenantAgeVerification,
  getTenantLegalPages,
} from "#lib/tenant";
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
    <Field.Root>
      <Field.Label>{t("storefront.auth.signup.birth_date_label")}</Field.Label>
      <Field.Content>
        <Input autoComplete="bday" name="birthDate" type="date" />
        <Field.Description>
          {t("storefront.auth.signup.birth_date_help")}
        </Field.Description>
      </Field.Content>
    </Field.Root>
  );
};

/**
 * Asked only where the tenant names a terms or privacy page.
 */
export const ConsentField = async () => {
  const [locale, tenantId] = await Promise.all([getLocale(), getTenantId()]);
  const pages = consentPages(await getTenantLegalPages(tenantId, locale));
  if (pages.length === 0) {
    return null;
  }

  return <LegalPagesConsentField pages={pages} />;
};
