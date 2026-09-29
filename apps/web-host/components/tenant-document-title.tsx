"use client";

import { useEffect } from "react";

interface TenantDocumentTitleProps {
  /** Screen name, already resolved from the catalog by the caller. */
  pageTitle: string;
  /** Site name from `getTenantSiteLabel()`, which supplies its own stand-in. */
  siteLabel: string;
}

export const TenantDocumentTitle = ({
  pageTitle,
  siteLabel,
}: TenantDocumentTitleProps) => {
  useEffect(() => {
    document.title = [pageTitle.trim(), siteLabel.trim()]
      .filter(Boolean)
      .join(" | ");
  }, [pageTitle, siteLabel]);

  return null;
};
