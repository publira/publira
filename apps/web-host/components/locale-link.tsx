"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

import { withLocalePrefix } from "#lib/locale-path";

import { useLocale, useTenantDefaultLocale } from "./locale-provider";

type LocaleLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  /** App-internal path without the locale prefix, e.g. `/series/SR01`. */
  href: string;
};

/**
 * `next/link` that keeps the reader inside their locale.
 *
 * Every in-app link in this app goes through it, so a bare `/series` written
 * in a page or produced by a `lib/*` reader still resolves to `/{locale}/series`
 * — a plain `<Link href="/series">` would drop the prefix and bounce the reader
 * through the proxy's default-locale redirect.
 *
 * The locale comes from the route tree rather than the browser URL, so the
 * href is identical during SSR and after hydration. Hrefs that leave the app
 * pass through untouched.
 */
export const LocaleLink = ({ href, ...props }: LocaleLinkProps) => {
  const locale = useLocale();
  const defaultLocale = useTenantDefaultLocale();

  return (
    <Link href={withLocalePrefix(locale, defaultLocale, href)} {...props} />
  );
};
