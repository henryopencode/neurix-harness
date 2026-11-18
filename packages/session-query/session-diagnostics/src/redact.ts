/** Bounded diagnostic excerpts; raw arguments and complete transcripts are never copied. */

/**
 * Mask common credentials, URL query values and home directory names before indexing.
 * This is a best-effort excerpt filter, not a guarantee that arbitrary prose contains no private data.
 * @param text - Error text from a durable event.
 * @param limit - Maximum retained characters, including a truncation marker.
 * @returns Redacted, bounded text suitable for a local preview.
 */
export function redactDiagnostic(text: string, limit: number): string {
  const source = text.slice(0, limit * 4)
  const redacted = source
    .replace(/((?:authorization|cookie|set-cookie)\s*["']?\s*[:=]\s*["']?)([^\r\n]+)/gi, '$1[redacted]')
    .replace(/\bBearer\s+[\w.+/=-]+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|cookie)\s*["']?\s*[:=]\s*["']?)([^\s,"'};]+)/gi, '$1[redacted]')
    .replace(/\b(?:sk|ghp|github_pat)-?[A-Za-z0-9_]{16,}\b/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/([?&][\w.-]+=)[^\s&#"']+/g, '$1[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[redacted]@')
    .replace(/(?:\/Users\/|\/home\/)[^/\s]+/g, '~')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, '~')
  return redacted.length > limit || source.length < text.length ? `${redacted.slice(0, Math.max(0, limit - 1))}…` : redacted
}
