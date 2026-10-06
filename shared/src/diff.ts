/**
 * 3-Way Merge Engine based on Google's diff-match-patch
 * Used for automatic, robust merging of concurrent edits on Markdown files
 */

import { diff_match_patch } from 'diff-match-patch';

export interface MergeResult {
  mergedText: string;
  hasConflict: boolean;
  appliedCount: number;
  totalPatches: number;
}

const dmp = new diff_match_patch();
// Match threshold: lower = stricter, higher = more lenient/fuzzy
dmp.Match_Threshold = 0.5;
dmp.Patch_DeleteThreshold = 0.5;

/**
 * Perform a 3-way text merge between Base, Local, and Remote versions.
 *
 * @param baseText The common ancestor version before changes
 * @param localText The current local file text
 * @param remoteText The incoming remote version from server
 * @returns MergeResult with merged content and conflict status
 */
export function threeWayMerge(
  baseText: string,
  localText: string,
  remoteText: string
): MergeResult {
  // Case 1: Local and Remote are identical
  if (localText === remoteText) {
    return {
      mergedText: localText,
      hasConflict: false,
      appliedCount: 0,
      totalPatches: 0
    };
  }

  // Case 2: Only Local changed (Remote is still identical to Base)
  if (baseText === remoteText) {
    return {
      mergedText: localText,
      hasConflict: false,
      appliedCount: 0,
      totalPatches: 0
    };
  }

  // Case 3: Only Remote changed (Local is still identical to Base)
  if (baseText === localText) {
    return {
      mergedText: remoteText,
      hasConflict: false,
      appliedCount: 0,
      totalPatches: 0
    };
  }

  // Case 4: Both Local and Remote have diverged from Base
  // Step 1: Compute the diff/patch from Base -> Local
  const localPatches = dmp.patch_make(baseText, localText);

  if (localPatches.length === 0) {
    return {
      mergedText: remoteText,
      hasConflict: false,
      appliedCount: 0,
      totalPatches: 0
    };
  }

  // Step 2: Apply the Local patch onto Remote
  const [mergedText, results] = dmp.patch_apply(localPatches, remoteText);

  const appliedCount = results.filter(Boolean).length;
  const hasConflict = results.some((success) => !success);

  return {
    mergedText,
    hasConflict,
    appliedCount,
    totalPatches: localPatches.length
  };
}

/**
 * Format conflicted copies filename
 * e.g. "Meeting notes (Conflicted copy MacBook 202610061430).md"
 */
export function formatConflictFilename(
  originalPath: string,
  deviceName: string,
  timestamp: number = Date.now()
): string {
  const date = new Date(timestamp);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const timeStr = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
  
  const lastDot = originalPath.lastIndexOf('.');
  const sanitizedDevice = deviceName.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Device';

  if (lastDot === -1) {
    return `${originalPath} (Conflicted copy ${sanitizedDevice} ${timeStr})`;
  }

  const name = originalPath.substring(0, lastDot);
  const ext = originalPath.substring(lastDot);
  return `${name} (Conflicted copy ${sanitizedDevice} ${timeStr})${ext}`;
}
