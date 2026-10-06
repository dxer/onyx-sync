import { describe, it, expect } from 'vitest';
import { threeWayMerge, formatConflictFilename } from '../diff';

describe('3-Way Merge Engine', () => {
  it('returns identical text when local and remote are identical', () => {
    const base = 'Hello World';
    const local = 'Hello Modern World';
    const remote = 'Hello Modern World';

    const result = threeWayMerge(base, local, remote);
    expect(result.mergedText).toBe(local);
    expect(result.hasConflict).toBe(false);
  });

  it('keeps local change when remote did not change from base', () => {
    const base = 'line 1\nline 2\nline 3';
    const local = 'line 1\nline 2 modified\nline 3';
    const remote = 'line 1\nline 2\nline 3';

    const result = threeWayMerge(base, local, remote);
    expect(result.mergedText).toBe(local);
    expect(result.hasConflict).toBe(false);
  });

  it('accepts remote change when local did not change from base', () => {
    const base = 'line 1\nline 2\nline 3';
    const local = 'line 1\nline 2\nline 3';
    const remote = 'line 1\nline 2\nline 3 remote modified';

    const result = threeWayMerge(base, local, remote);
    expect(result.mergedText).toBe(remote);
    expect(result.hasConflict).toBe(false);
  });

  it('automatically merges non-overlapping changes from both devices', () => {
    const base = 'Title\n\nSection 1 original\n\nSection 2 original\n';
    // Local device updated Section 1
    const local = 'Title\n\nSection 1 updated by PC\n\nSection 2 original\n';
    // Remote device (e.g. iPhone) updated Section 2
    const remote = 'Title\n\nSection 1 original\n\nSection 2 updated by iPhone\n';

    const result = threeWayMerge(base, local, remote);
    expect(result.hasConflict).toBe(false);
    expect(result.mergedText).toContain('Section 1 updated by PC');
    expect(result.mergedText).toContain('Section 2 updated by iPhone');
  });

  it('detects conflict on overlapping conflicting line changes', () => {
    const base = 'Header\nTarget line original\nFooter';
    const local = 'Header\nTarget line edited by PC\nFooter';
    const remote = 'Header\nTarget line completely rewritten by Phone\nFooter';

    const result = threeWayMerge(base, local, remote);
    // Since both modified the same short line from base, DMP will detect a conflict / failure to cleanly apply
    expect(result.hasConflict).toBe(true);
  });

  it('formats conflict copy filenames correctly', () => {
    const fixedTime = new Date('2026-10-06T15:30:00Z').getTime();
    const formatted = formatConflictFilename('Notes/Meeting.md', 'iPhone 15', fixedTime);
    expect(formatted).toMatch(/^Notes\/Meeting \(Conflicted copy iPhone 15 \d{12}\)\.md$/);
  });
});
