"use client";

import { useToastManager } from "@publira/ui-components";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startTransition, useEffect, useEffectEvent, useRef } from "react";

import { isFlashFlagSet } from "./flash-flag";

interface FlashToastProps {
  keyName?: string;
  title: string;
}

export const FlashToast = ({ keyName = "created", title }: FlashToastProps) => {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { add } = useToastManager();
  const firedRef = useRef(false);

  const onFlash = useEffectEvent(() => {
    add({ title, type: "success" });
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
