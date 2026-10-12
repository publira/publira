import { Checkbox } from "@publira/ui-components/checkbox";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import type { TenantLegalPage } from "#lib/tenant";

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
 * The box a reader ticks to agree to `pages`, over a link to each. Each version
 * sent is the one whose title this field links to, so what the API records is
 * the text the reader was shown. Keyed by those versions, so a page republished
 * while the form was open is agreed to anew rather than carried over.
 */
export const LegalPagesConsentField = ({
  pages,
}: {
  pages: TenantLegalPage[];
}) => (
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
          <Message message="storefront.auth.signup.consent_label" />
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
