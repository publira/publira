"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { useToastManager } from "@publira/ui-components";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startTransition, useEffect, useEffectEvent, useRef } from "react";

import type { AdminMessageKey } from "#lib/locale";

import { isFlashFlagSet } from "./flash-flag";

interface FlashToastProps {
  keyName?: string;
  message?: AdminMessageKey;
  title?: string;
}

export const FlashToast = ({
  keyName = "created",
  message,
  title,
}: FlashToastProps) => {
  const messages = sharedCatalog(document.documentElement.lang);
  const resolvedTitle = title ?? (message ? getMessage(messages, message) : "");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { add } = useToastManager();
  const firedRef = useRef(false);

  const onFlash = useEffectEvent(() => {
    add({ title: resolvedTitle, type: "success" });
    startTransition(() => {
      const next = new URLSearchParams(searchParams.toString());
      next.delete(keyName);
      const nextQuery = next.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
    });
  });

  useEffect(() => {
    if (!isFlashFlagSet(searchParams.getAll(keyName))) {
      firedRef.current = false;
      return;
    }
    if (firedRef.current) {
      return;
    }
    firedRef.current = true;
    onFlash();
  }, [searchParams, keyName]);

  return null;
};
