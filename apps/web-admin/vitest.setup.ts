/**
 * Vitest setup for web-admin.
 * Add shared test-only side effects here (polyfills, matchers, etc.).
 */
import "temporal-polyfill/global";

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
