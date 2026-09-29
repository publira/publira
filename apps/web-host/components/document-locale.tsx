"use client";

import { useEffect } from "react";

import { useLocale } from "./locale-context";

/**
 * Keeps `<html lang>` naming the served locale across client-side navigations,
 * which re-render the root element without the attribute.
 */
export const DocumentLocale = () => {
  const locale = useLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return null;
};
