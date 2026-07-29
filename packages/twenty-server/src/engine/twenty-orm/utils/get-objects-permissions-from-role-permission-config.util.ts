import {
  type ObjectsPermissions,
  type ObjectsPermissionsByRoleId,
} from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { type RolePermissionConfig } from 'src/engine/twenty-orm/types/role-permission-config';
import { computePermissionIntersection } from 'src/engine/twenty-orm/utils/compute-permission-intersection.util';

// Mirrors what WorkspaceEntityManager grants the repository, so callers that
// read permissions ahead of a query (tool descriptors, selectable fields) see
// the same result the query itself will enforce.
// Multi-role union is not ready — use the first assigned role only.
export const getObjectsPermissionsFromRolePermissionConfig = ({
  rolesPermissions,
  rolePermissionConfig,
}: {
  rolesPermissions: ObjectsPermissionsByRoleId;
  rolePermissionConfig: RolePermissionConfig;
}): ObjectsPermissions => {
  if ('shouldBypassPermissionChecks' in rolePermissionConfig) {
    return {};
  }

  if ('intersectionOf' in rolePermissionConfig) {
    return computePermissionIntersection(
      rolePermissionConfig.intersectionOf.map(
        (roleId) => rolesPermissions[roleId] ?? {},
      ),
    );
  }

  const roleId = rolePermissionConfig.unionOf[0];

  if (!isDefined(roleId)) {
    return {};
  }

  return rolesPermissions[roleId] ?? {};
};
