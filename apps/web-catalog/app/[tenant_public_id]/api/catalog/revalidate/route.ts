import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";

const revalidateRequestSchema = z
  .object({
    tags: z.array(z.string().trim().min(1)).min(1),
    tenantPublicId: z.string().trim().min(1),
  })
  .strict();

const normalizeTags = (tags: string[]): string[] => {
  const unique = new Set<string>();
  for (const tag of tags) {
    const normalized = tag.trim();
    if (!normalized) {
      continue;
    }
    unique.add(normalized);
  }
  return [...unique];
};

interface RouteContext {
  params: Promise<{ tenant_public_id: string }>;
}

export const POST = async (request: NextRequest, { params }: RouteContext) => {
  const token = process.env.NEXT_REVALIDATE_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      { error: "NEXT_REVALIDATE_TOKEN is not configured" },
      { status: 500 }
    );
  }

  const headerToken = request.headers.get("x-revalidate-token")?.trim();
  if (!headerToken || headerToken !== token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const routeParams = await params;
  const tenantPublicIdFromPath = routeParams.tenant_public_id.trim();
  if (!tenantPublicIdFromPath) {
    return NextResponse.json({ error: "invalid tenant path" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = revalidateRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
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

  const tenantPublicId = parsed.data.tenantPublicId.trim();
  if (tenantPublicId !== tenantPublicIdFromPath) {
    return NextResponse.json({ error: "tenant mismatch" }, { status: 400 });
  }

  const allowedPrefix = `tenant:${tenantPublicId}:catalog:`;
  const tags = normalizeTags(parsed.data.tags).filter((tag) =>
    tag.startsWith(allowedPrefix)
  );

  if (tags.length === 0) {
    return NextResponse.json(
      { error: "no valid tags for tenant" },
      { status: 400 }
    );
  }

  for (const tag of tags) {
    revalidateTag(tag, "max");
  }

  return NextResponse.json({ revalidated: tags.length, tags }, { status: 200 });
};
