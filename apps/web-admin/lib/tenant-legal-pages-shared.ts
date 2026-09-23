/**
 * A page the tenant names as its terms of service or its privacy policy.
 * `published` is false once the page has been unpublished: the nomination is
 * kept, but the storefront links to nothing for it until it is republished.
 *
 * Kept apart from `tenant-legal-pages.ts` because the settings card is a Client
 * Component: importing the type from the module that reads the session would
 * pull `next/headers` into the browser graph.
 */
export interface TenantLegalPage {
  pageId: string;
  published: boolean;
  slug: string;
  title: string;
}

/** A role is absent where the tenant has named no page for it. */
export interface TenantLegalPages {
  privacyPage?: TenantLegalPage;
  termsPage?: TenantLegalPage;
}
