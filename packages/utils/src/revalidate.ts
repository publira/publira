import { createHash, timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";
import { z } from "zod";

export const REVALIDATE_TOKEN_ENV = "PUBLIRA_REVALIDATE_TOKEN";

const revalidateRequestSchema = z.strictObject({
  tags: z.array(z.string().trim().min(1).max(256)).min(1),
});

const readEnv = (name: string): string => {
  const value = process.env[name];

  return typeof value === "string" ? value.trim() : "";
};

/**
 * Compares the digests rather than the tokens, so neither the time taken nor
 * an early return on a length mismatch says how much of a guess was right.
 */
const tokensMatch = (expected: string, given: string): boolean =>
  timingSafeEqual(
    createHash("sha256").update(expected).digest(),
    createHash("sha256").update(given).digest()
  );

/**
 * The `POST /api/v1/revalidate` Route Handler the Go servers send the cache
 * tags a write left stale to. It accepts a `{ "tags": [...] }` body from a
 * caller whose `X-Revalidate-Token` header is `PUBLIRA_REVALIDATE_TOKEN`, and
 * marks each tag stale with `revalidateTag(tag, "max")`. Without the token it
 * answers every request with 500, which the servers retry, rather than
 * accepting any caller.
 */
export const handleRevalidateRequest = async (
  request: Request
): Promise<Response> => {
  const token = readEnv(REVALIDATE_TOKEN_ENV);

  if (!token) {
    return Response.json(
      { error: `${REVALIDATE_TOKEN_ENV} is not configured` },
      { status: 500 }
    );
  }

  const headerToken = request.headers.get("x-revalidate-token")?.trim();

  if (!(headerToken && tokensMatch(token, headerToken))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = revalidateRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      {
        error: "invalid payload",
        issues: parsed.error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path.join("."),
        })),
      },
      { status: 400 }
    );
  }

  const tags = [...new Set(parsed.data.tags)];

  for (const tag of tags) {
    revalidateTag(tag, "max");
  }

  return Response.json({ revalidated: tags.length, tags });
};
