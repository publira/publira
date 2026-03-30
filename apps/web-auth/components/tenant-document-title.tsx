"use client";

import { useEffect } from "react";

interface TenantDocumentTitleProps {
  pageTitle: string;
  siteLabel: string;
}

export const TenantDocumentTitle = ({
  pageTitle,
  siteLabel,
}: TenantDocumentTitleProps) => {
  useEffect(() => {
    const normalizedSiteLabel = siteLabel.trim() || "サイト";
    const normalizedPageTitle = pageTitle.trim();

    document.title = normalizedPageTitle
      ? `${normalizedPageTitle} | ${normalizedSiteLabel}`
      : normalizedSiteLabel;
  }, [pageTitle, siteLabel]);

  return null;
};
