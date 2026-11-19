/** Locally generated export from the exact redacted records shown in the preview. */
import { strToU8, zipSync } from 'fflate/browser'
import type { DiagnosticGroup, DiagnosticList } from '../types.ts'

/** Immutable preview and download payload prepared from one visible query result. */
export interface DiagnosticReport {
  markdown: string
  json: string
}

/**
 * Prepare both exported files before confirmation; all exported facts are visible in the JSON preview.
 * @param data - Current successful query result with completeness indicators.
 * @param groups - Explicitly selected groups, or all currently filtered groups.
 * @param title - Localized report heading.
 * @param incomplete - Localized completeness warning.
 * @returns Literal diagnostic text and exact machine-readable payload, without raw query paths.
 */
export function diagnosticReport(
  data: DiagnosticList, groups: readonly DiagnosticGroup[], title: string, incomplete: string,
): DiagnosticReport {
  const facts = { formatVersion: 1, generatedAt: new Date().toISOString(),
    incomplete: data.incomplete, unindexedSessions: data.unindexedSessions,
    omittedOccurrences: data.omittedOccurrences, failedSessions: data.failedSessions, groups,
  }
  const lines = [`# ${title}`, '', facts.generatedAt, '', ...(data.incomplete ? [incomplete, ''] : [])]
  for (const group of groups) {
    lines.push(`## ${group.category}`, '', literalTextBlock(`${group.source} · ${group.code}\n${group.message}`), '', `Occurrences: ${group.count}`, '')
    for (const item of group.occurrences) {
      lines.push(`### #${item.eventSeq} · ${new Date(item.at).toISOString()}`, '', literalTextBlock(`${item.sessionId} · #${item.eventSeq}\n${item.details}`), '')
    }
  }
  return { markdown: `${lines.join('\n')}\n`, json: JSON.stringify(facts, null, 2) + '\n' }
}

/** Keep diagnostic Markdown and HTML literal, including embedded code fences. */
function literalTextBlock(text: string): string {
  let width = 3
  for (const run of text.matchAll(/`+/g)) width = Math.max(width, run[0].length + 1)
  const fence = '`'.repeat(width)
  return `${fence}text\n${text}\n${fence}`
}

/**
 * Encode exactly the confirmed preview as an archive without reading any other data.
 * @param report - Prepared preview strings.
 * @returns ZIP bytes containing only the readable and machine-readable reports.
 */
export function diagnosticArchive(report: DiagnosticReport): Uint8Array {
  return zipSync({ 'diagnostics.md': strToU8(report.markdown), 'diagnostics.json': strToU8(report.json) })
}

/**
 * Download only the previewed files, without requesting new Host data or uploading content.
 * @param report - Frozen-in-time strings confirmed by the user.
 */
export function downloadDiagnosticReport(report: DiagnosticReport): void {
  const bytes = diagnosticArchive(report)
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' }))
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = `diagnostics-${new Date().toISOString().replaceAll(':', '-')}.zip`
    link.click()
  } finally { setTimeout(() => { URL.revokeObjectURL(url) }, 0) }
}
