"use client";

import * as Toast from "@publira/ui-components/toast";
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
  /**
   * The query parameter each placeholder of `message` is filled from, which
   * leaves the URL with the flag. A screen redirected to once a record is gone
   * names the record this way, since nothing is left to read its name from.
   */
  valueParams?: Readonly<Record<string, string>>;
}

const noValueParams: Readonly<Record<string, string>> = {};

const FlashToastEffect = ({
  keyName = "created",
  message,
  title,
  valueParams = noValueParams,
}: FlashToastProps) => {
  const t = useClientMessages();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const values = Object.fromEntries(
    Object.entries(valueParams).map(([placeholder, param]) => [
      placeholder,
      searchParams.get(param) ?? "",
    ])
  );

  const resolvedTitle = title ?? (message ? t(message, values) : "");
  const { add } = Toast.useManager();
  const firedRef = useRef(false);

  const onFlash = useEffectEvent(() => {
    add({ title: resolvedTitle, type: "success" });
    startTransition(() => {
      const next = new URLSearchParams(searchParams.toString());
      next.delete(keyName);

      for (const param of Object.values(valueParams)) {
        next.delete(param);
      }

      const nextQuery = next.toString();
      // This lands a round trip after the reader may have scrolled on, even
      // mid-drag, so it must not send the page back to the top.
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
        scroll: false,
      });
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
