export const normalizePlatformRole = (role: string): string => role.trim();

export const isPlatformSuperAdmin = (role: string | undefined): boolean =>
  normalizePlatformRole(role ?? "") === "platform_super_admin";

export const isPlatformOperator = (role: string | undefined): boolean =>
  normalizePlatformRole(role ?? "") === "platform_operator";

export const canManageEndUsers = (role: string | undefined): boolean => {
  const normalizedRole = normalizePlatformRole(role ?? "");
  return (
    normalizedRole === "platform_super_admin" ||
    normalizedRole === "platform_operator"
  );
};
