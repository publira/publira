"use client";

import { useToastManager } from "@publira/ui-components/toast";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  startTransition,
  Suspense,
  useEffect,
  useEffectEvent,
  useRef,
} from "react";

import type { AdminClientMessageKey } from "#lib/messages";

import { useClientMessages } from "./client-message";
import { isFlashFlagSet } from "./flash-flag";

interface FlashToastProps {
  keyName?: string;
  message?: AdminClientMessageKey;
  title?: string;
}

const FlashToastEffect = ({
  keyName = "created",
  message,
  title,
}: FlashToastProps) => {
  const t = useClientMessages();
  const resolvedTitle = title ?? (message ? t(message) : "");
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

/**
 * Pages place this beside their sections rather than inside one, and it reads
 * the query string and the catalog, so it carries its own boundary: it renders
 * nothing, and waiting here must not hold back the page around it.
 */
export const FlashToast = (props: FlashToastProps) => (
  <Suspense fallback={null}>
    <FlashToastEffect {...props} />
  </Suspense>
);
