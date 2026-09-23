import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// apps/api/src (tsx) and apps/api/dist (build) are both three levels below the repository root.
export const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Relative paths in configuration (for example DATABASE_PATH=./database/taptalk.db) are relative
// to the repository root, not to whichever directory a workspace script runs in.
export function resolveFromRoot(path: string): string {
  return isAbsolute(path) ? path : resolve(repositoryRoot, path);
}
