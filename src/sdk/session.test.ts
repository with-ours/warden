import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getSessionsDir, getSessionPath, saveSession } from './session.js';

describe('session storage', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `warden-session-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getSessionsDir', () => {
    it('returns .warden/sessions under repo path', () => {
      expect(getSessionsDir('/repo')).toBe(join('/repo', '.warden', 'sessions'));
    });
  });

  describe('getSessionPath', () => {
    it('includes timestamp and session ID in filename', () => {
      const ts = new Date('2026-01-15T10:30:00.000Z');
      const path = getSessionPath('/repo', 'abc-123', ts);
      expect(path).toBe(join('/repo', '.warden', 'sessions', '2026-01-15T10-30-00.000Z-abc-123.jsonl'));
    });

    it('sanitizes unsafe characters in session IDs', () => {
      const ts = new Date('2026-01-15T10:30:00.000Z');
      const path = getSessionPath('/repo', 'ses/sion:id<>test', ts);
      expect(path).toContain('ses_sion_id__test.jsonl');
    });

    it('preserves alphanumeric, dot, dash, and underscore in session IDs', () => {
      const ts = new Date('2026-01-15T10:30:00.000Z');
      const path = getSessionPath('/repo', 'session_123-abc.v2', ts);
      expect(path).toContain('session_123-abc.v2.jsonl');
    });
  });

  describe('saveSession', () => {
    it('copies transcript file to .warden/sessions/', () => {
      const transcriptPath = join(tempDir, 'original.jsonl');
      writeFileSync(transcriptPath, '{"type":"result","session_id":"test"}\n');

      const ts = new Date('2026-01-15T10:30:00.000Z');
      const result = saveSession(transcriptPath, tempDir, 'test-session', ts);

      expect(result).toBeDefined();
      expect(existsSync(result!)).toBe(true);
      expect(readFileSync(result!, 'utf-8')).toBe('{"type":"result","session_id":"test"}\n');
    });

    it('creates the sessions directory if it does not exist', () => {
      const transcriptPath = join(tempDir, 'original.jsonl');
      writeFileSync(transcriptPath, 'data\n');

      const sessionsDir = getSessionsDir(tempDir);
      expect(existsSync(sessionsDir)).toBe(false);

      const result = saveSession(transcriptPath, tempDir, 'session-1');
      expect(result).toBeDefined();
      expect(existsSync(sessionsDir)).toBe(true);
    });

    it('returns undefined when source file does not exist', () => {
      const result = saveSession('/nonexistent/file.jsonl', tempDir, 'session-1');
      expect(result).toBeUndefined();
    });

    it('returns undefined on write errors (non-fatal)', () => {
      const transcriptPath = join(tempDir, 'original.jsonl');
      writeFileSync(transcriptPath, 'data\n');

      // Pass an invalid repo path to trigger a write error
      const result = saveSession(transcriptPath, '/dev/null/invalid', 'session-1');
      expect(result).toBeUndefined();
    });

    it('preserves original file after copy', () => {
      const transcriptPath = join(tempDir, 'original.jsonl');
      writeFileSync(transcriptPath, 'original content\n');

      saveSession(transcriptPath, tempDir, 'session-1');

      // Original file should still exist
      expect(existsSync(transcriptPath)).toBe(true);
      expect(readFileSync(transcriptPath, 'utf-8')).toBe('original content\n');
    });
  });
});
