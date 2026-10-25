/**
 * The plan page, with the outcome a reader returns to it with: `cancelled` is
 * what Stripe's checkout names when they leave it, and the other two are what
 * the subscribe Action names when the checkout could not be started.
 */
export const plansPath = (
  subscription?: "cancelled" | "error" | "unavailable"
): string => (subscription ? `/plans?subscription=${subscription}` : "/plans");
