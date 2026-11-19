import { vi } from "vitest";

/**
 * Vitest setup for web-admin.
 * Add shared test-only side effects here (polyfills, matchers, etc.).
 */

const observeNothing = () => {
  // Nothing in jsdom has a size to report.
};

/**
 * jsdom implements no `ResizeObserver`, and dnd-kit constructs one as soon as
 * it is imported — so a screen holding a sortable list cannot even be rendered
 * without this. Nothing such an observer would report is meaningful in jsdom,
 * where every element measures zero, so the stub only has to exist: what a
 * drag actually does is covered by the e2e suite.
 */
class ResizeObserverStub implements ResizeObserver {
  disconnect = observeNothing;
  observe = observeNothing;
  unobserve = observeNothing;
}

globalThis.ResizeObserver ??= ResizeObserverStub;

/**
 * `next/root-params` is a placeholder the Next.js compiler replaces, and
 * importing it anywhere else throws. `lib/locale.ts` imports it beside the
 * cookie reader every Server Action resolves its locale with, so nearly every
 * test reaches it; this stands in for it everywhere, and a test that renders
 * under a locale or a tenant says which one with
 * `vi.mocked(locale).mockResolvedValue()`.
 */
vi.mock("next/root-params", () => ({ locale: vi.fn(), tenant_id: vi.fn() }));
