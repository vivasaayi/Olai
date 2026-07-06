import * as FileSystem from "expo-file-system";

/**
 * Write a file atomically: write to a temp sibling first, then move it into
 * place. A crash mid-write leaves the previous good file intact instead of a
 * truncated/corrupt JSON blob.
 */
export async function writeFileAtomic(path: string, contents: string) {
  const tempPath = `${path}.tmp-${Math.random().toString(36).slice(2)}`;
  try {
    await FileSystem.writeAsStringAsync(tempPath, contents);
    // moveAsync overwrites the destination on both iOS and Android.
    await FileSystem.moveAsync({ from: tempPath, to: path });
  } catch (error) {
    // Best-effort cleanup of the temp file so we don't leak partial writes.
    try {
      await FileSystem.deleteAsync(tempPath, { idempotent: true });
    } catch {
      // ignore cleanup failures
    }
    throw error;
  }
}

/**
 * Read + JSON.parse a file, returning `undefined` when the file is missing or
 * corrupt. Unlike a bare `catch {}`, corruption is logged so it is not silent
 * data loss, and the caller can decide how to surface skipped entries.
 */
export async function readJsonFile<T>(path: string, label: string): Promise<T | undefined> {
  let raw: string;
  try {
    raw = await FileSystem.readAsStringAsync(path);
  } catch {
    // Missing/unreadable file — treat as absent.
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`Skipping corrupt ${label} at ${path}:`, error);
    return undefined;
  }
}
