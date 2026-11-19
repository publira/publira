import { vi } from "vitest";

/**
 * `next/root-params` is a placeholder the Next.js compiler replaces, and
 * importing it anywhere else throws. `lib/locale.ts` imports it beside the
 * cookie reader every Server Action resolves its locale with, so nearly every
 * test reaches it; this stands in for it everywhere, and a test that renders
 * under a locale says which one with `vi.mocked(locale).mockResolvedValue()`.
 */
vi.mock("next/root-params", () => ({ locale: vi.fn() }));
