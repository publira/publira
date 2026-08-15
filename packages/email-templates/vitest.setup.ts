/**
 * Temporal is required by `formatDateTime` when invitation expiry is shown.
 * The renderer process must load the same polyfill before calling `renderEmail`.
 */
import "temporal-polyfill/global";
