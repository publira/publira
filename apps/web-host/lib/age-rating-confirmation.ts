"use client";

import { useEffect, useState } from "react";

import type { RestrictedAgeRating } from "./age-rating";
import { RESTRICTED_AGE_RATINGS } from "./age-rating";

/**
 * Per-tenant key: the public site serves every tenant from one origin, and a
 * confirmation is a statement on that site, not a fact about the browser.
 */
const storageKey = (tenantId: string): string =>
  `publira.age-rating.confirmation.${tenantId}`;

/** Same-tab signal. `storage` only fires in other tabs. */
const CONFIRMATION_EVENT = "publira:age-rating-confirmation";

const isRestrictedAgeRating = (
  value: string | null
): value is RestrictedAgeRating =>
  value !== null && RESTRICTED_AGE_RATINGS.some((rating) => rating === value);

export const readConfirmedAgeRating = (
  tenantId: string
): RestrictedAgeRating | undefined => {
  const id = tenantId.trim();
  if (!id || typeof window === "undefined") {
    return undefined;
  }

  try {
    const stored = window.localStorage.getItem(storageKey(id));
    return isRestrictedAgeRating(stored) ? stored : undefined;
  } catch {
    // Private mode and blocked storage are an unconfirmed reader, not a crash.
    return undefined;
  }
};

/**
 * Remember the highest rating this browser has confirmed on this tenant.
 * Confirming `r18` keeps covering `r15`; confirming `r15` later does not
 * lower an `r18` already stored.
 */
export const writeConfirmedAgeRating = (
  tenantId: string,
  rating: RestrictedAgeRating
): RestrictedAgeRating | undefined => {
  const id = tenantId.trim();
  if (!id || typeof window === "undefined") {
    return undefined;
  }

  const current = readConfirmedAgeRating(id);
  const next = current === "r18" || rating === "r18" ? "r18" : "r15";

  try {
    window.localStorage.setItem(storageKey(id), next);
  } catch {
    return current;
  }

  window.dispatchEvent(new Event(CONFIRMATION_EVENT));
  return next;
};

/**
 * The rating this browser has confirmed, starting unconfirmed until
 * `localStorage` can be read. That first paint is what a first-time visitor
 * sees, so a rated body never appears in the SSR HTML.
 *
 * The Effect is a sync with storage — an external system — rather than a
 * props-to-state copy.
 */
export const useConfirmedAgeRating = (
  tenantId: string
): RestrictedAgeRating | undefined => {
  const [confirmed, setConfirmed] = useState<RestrictedAgeRating | undefined>();

  useEffect(() => {
    const sync = () => {
      setConfirmed(readConfirmedAgeRating(tenantId));
    };

    sync();
    window.addEventListener(CONFIRMATION_EVENT, sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener(CONFIRMATION_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [tenantId]);

  return confirmed;
};
