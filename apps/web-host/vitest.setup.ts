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

/**
 * jsdom implements no `matchMedia` either, and the episode reader asks it
 * whether the window is held upright before it lets the viewport show a
 * spread. A window jsdom has no size for matches no query, which is the
 * answer the server renders with too.
 */
globalThis.matchMedia ??= (query: string): MediaQueryList => ({
  addEventListener: observeNothing,
  addListener: observeNothing,
  dispatchEvent: () => false,
  matches: false,
  media: query,
  onchange: null,
  removeEventListener: observeNothing,
  removeListener: observeNothing,
});
