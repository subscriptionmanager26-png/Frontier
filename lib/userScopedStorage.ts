import * as FileSystem from 'expo-file-system/legacy';

/**
 * All on-disk files for a signed-in user should live under this directory so accounts
 * on the same device never mix data. Call `ensureUserScopedDocumentRoot` after auth is ready.
 */
export function getUserScopedDocumentRoot(userId: string): string {
  const base = FileSystem.documentDirectory;
  if (!base) {
    throw new Error('documentDirectory is not available on this platform');
  }
  const id = userId.trim();
  if (!id) {
    throw new Error('userId is required for scoped storage');
  }
  return `${base.replace(/\/+$/, '')}/users/${id}/`;
}

/** Creates `documentDirectory/users/<userId>/` (and parents) if missing. */
export async function ensureUserScopedDocumentRoot(userId: string): Promise<string> {
  const root = getUserScopedDocumentRoot(userId);
  await FileSystem.makeDirectoryAsync(root, { intermediates: true });
  return root;
}

/** Joins path segments under the user root; rejects absolute or parent segments. */
export function userScopedFileUri(userId: string, ...relativeSegments: string[]): string {
  const root = getUserScopedDocumentRoot(userId).replace(/\/+$/, '');
  const parts: string[] = [];
  for (const seg of relativeSegments) {
    const s = seg.replace(/^\/+|\/+$/g, '');
    if (!s || s.includes('..')) {
      throw new Error('invalid path segment');
    }
    parts.push(s);
  }
  return `${root}/${parts.join('/')}`;
}
