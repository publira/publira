"use client";

import { useSearchParams } from "next/navigation";

import { parseSettingsFlashSearchParams } from "./_lib/search-params";

/**
 * A layout is not passed `searchParams` and does not re-render on navigation,
 * so the flash reads the query through `useSearchParams` instead. The parent
 * wraps this in `<Suspense>` so the static shell can ship without the query.
 */
export const SettingsFlash = () => {
  const searchParams = useSearchParams();
  const { message, status } = parseSettingsFlashSearchParams({
    message: searchParams.get("message") ?? undefined,
    status: searchParams.get("status") ?? undefined,
  });

  if (!message) {
    return null;
  }

  return (
    <p
      className={`rounded-md border px-4 py-3 text-sm ${
        status === "success"
          ? "border-success/30 bg-success/10 text-success"
          : "border-destructive/30 bg-destructive/10 text-destructive"
      }`}
      role={status === "success" ? "status" : "alert"}
    >
      {message}
    </p>
  );
};
