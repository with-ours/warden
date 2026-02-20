import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Get the `.warden/sessions` directory for a repo.
 */
export function getSessionsDir(repoPath: string): string {
  return join(repoPath, '.warden', 'sessions');
}

/**
 * Build a session file path inside `.warden/sessions/`.
 * Format: {ISO-timestamp}-{sessionId}.jsonl
 *
 * Session IDs are sanitized to be filesystem-safe.
 */
export function getSessionPath(
  repoPath: string,
  sessionId: string,
  timestamp: Date = new Date()
): string {
  const ts = timestamp.toISOString().replace(/:/g, '-');
  const safeId = sanitizeSessionId(sessionId);
  return join(getSessionsDir(repoPath), `${ts}-${safeId}.jsonl`);
}

/**
 * Sanitize a session ID for use in filenames.
 * Replaces any non-alphanumeric/dash/underscore/dot characters with underscores.
 */
function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Copy a Claude SDK session transcript to `.warden/sessions/`.
 *
 * Returns the destination path on success, undefined on failure.
 * Failures are non-fatal: session storage is best-effort.
 */
export function saveSession(
  transcriptPath: string,
  repoPath: string,
  sessionId: string,
  timestamp?: Date
): string | undefined {
  try {
    if (!existsSync(transcriptPath)) return undefined;
    const destPath = getSessionPath(repoPath, sessionId, timestamp);
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(transcriptPath, destPath);
    return destPath;
  } catch {
    // Session storage is best-effort. Don't break the analysis pipeline.
    return undefined;
  }
}
