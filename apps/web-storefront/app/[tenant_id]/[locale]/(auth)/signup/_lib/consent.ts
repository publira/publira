/**
 * Whether the versions a form showed are the ones the tenant publishes now,
 * each named once: a version sent twice must not stand in for a page the form
 * never named.
 */
export const sameVersions = (left: string[], right: string[]): boolean => {
  const leftIds = new Set(left);
  const rightIds = new Set(right);
  return (
    leftIds.size === left.length &&
    leftIds.size === rightIds.size &&
    left.every((id) => rightIds.has(id))
  );
};
