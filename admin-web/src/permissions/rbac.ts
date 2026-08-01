export function permissionMatches(granted: string, required: string): boolean {
  if (granted === required || granted === '*') {
    return true
  }
  return granted.endsWith('*') && required.startsWith(granted.slice(0, -1))
}

export function hasPermission(
  grantedPermissions: Iterable<string>,
  requiredPermission: string,
  isSuperAdmin = false,
): boolean {
  if (isSuperAdmin) {
    return true
  }
  return Array.from(grantedPermissions).some(granted => permissionMatches(granted, requiredPermission))
}

export function hasAnyPermission(
  grantedPermissions: Iterable<string>,
  requiredPermissions: string[],
  isSuperAdmin = false,
): boolean {
  return requiredPermissions.length === 0
    || requiredPermissions.some(required => hasPermission(grantedPermissions, required, isSuperAdmin))
}

export function hasAllPermissions(
  grantedPermissions: Iterable<string>,
  requiredPermissions: string[],
  isSuperAdmin = false,
): boolean {
  return requiredPermissions.every(required => hasPermission(grantedPermissions, required, isSuperAdmin))
}
