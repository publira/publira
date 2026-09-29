/** Whether the versions a form showed are the ones the tenant publishes now. */
export const sameVersions = (left: string[], right: string[]): boolean => {
  const rightIds = new Set(right);
  return left.length === rightIds.size && left.every((id) => rightIds.has(id));
};
