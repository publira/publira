/**
 * Vitest setup for web-host.
 * Add shared test-only side effects here (polyfills, matchers, etc.).
 */
import "temporal-polyfill/global";

const observeNothing = () => {
  // Nothing in jsdom has a size to report.
};

/**
 * jsdom implements no `ResizeObserver`, and `@publira/comic-viewer` constructs
 * one as soon as its viewport mounts — so the episode reader cannot even be
 * rendered without this. Nothing such an observer would report is meaningful
 * in jsdom, where every element measures zero, so the stub only has to exist.
 */
class ResizeObserverStub implements ResizeObserver {
  disconnect = observeNothing;
  observe = observeNothing;
  unobserve = observeNothing;
}

globalThis.ResizeObserver ??= ResizeObserverStub;
