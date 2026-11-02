/**
 * The preview page count stored beside `price`. A free episode opens its whole
 * body, so it keeps none: a count left on it would open those pages alone
 * again the moment the episode is priced, without anyone having chosen to.
 * The form already sends 0 for a free price, and this covers the submission
 * that was rendered while the episode was still priced.
 */
export const previewPageCountFor = (
  price: number,
  previewPageCount: number
): number => (price > 0 ? previewPageCount : 0);
