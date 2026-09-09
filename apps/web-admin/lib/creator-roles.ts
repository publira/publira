import { apiClient, withSessionHeaders } from "./api";

/**
 * The role at the top of the tenant's priority order, by public ID.
 *
 * The series form has no role control yet, so every creator it saves is
 * credited in this one — which is what a series credited to one person means.
 * [#1936](https://github.com/publira/publira/issues/1936) puts a select on each
 * creator row and this stops being the only answer.
 *
 * A tenant always has roles: tenant creation gives it the starting vocabulary,
 * and the console cannot delete a role a credit names. An empty list is
 * therefore a broken tenant rather than a state to paper over, so it throws.
 */
export const getLeadingCreatorRolePublicId = async (
  tenantId: string,
  sessionId: string
): Promise<string> => {
  const response = await apiClient.creatorRole.listCreatorRoles(
    { limit: 1, tenant: { tenantId } },
    withSessionHeaders(sessionId)
  );
  const publicId = response.creatorRoles.at(0)?.publicId?.trim();
  if (!publicId) {
    throw new Error(`tenant ${tenantId} has no creator roles`);
  }
  return publicId;
};
