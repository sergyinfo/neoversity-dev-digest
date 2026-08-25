import type { FastifyRequest } from 'fastify';
import type { Container } from '../../platform/container.js';

export interface RequestContext {
  workspaceId: string;
  userId: string;
}

/**
 * Resolve the tenancy context for a request via the AuthProvider. In MVP
 * (LocalNoAuthProvider) this always returns the default workspace + system user.
 * Every module uses this so workspace scoping is never forgotten.
 */
export async function getContext(
  container: Container,
  req: FastifyRequest,
): Promise<RequestContext> {
  const [user, workspace] = await Promise.all([
    container.auth.currentUser(req),
    container.auth.currentWorkspace(req),
  ]);
  return { workspaceId: workspace.id, userId: user.id };
}

/**
 * The workspace id alone, for the many handlers that never look at the user.
 *
 * Narrower than `getContext` on purpose: a handler that only scopes a query has
 * no business holding a user id it might accidentally start trusting. Same
 * resolution, same AuthProvider, one field.
 */
export async function getWorkspaceId(
  container: Container,
  req: FastifyRequest,
): Promise<string> {
  const { workspaceId } = await getContext(container, req);
  return workspaceId;
}
