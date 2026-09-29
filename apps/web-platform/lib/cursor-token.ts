import { z } from "zod";

/** Cursor tokens are opaque, so the UI only rejects non-string query values. */
export const cursorTokenSchema = z.preprocess(
  (value) => (typeof value === "string" ? value : ""),
  z.string()
);

export const cursorPageHref = (pathname: string, token: string): string => {
  if (!token) {
    return pathname;
  }

  const search = new URLSearchParams({ token });
  return `${pathname}?${search.toString()}`;
};
