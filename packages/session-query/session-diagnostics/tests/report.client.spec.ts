/** Reports contain the confirmed selection and archive exactly the immutable preview strings. */
import { strFromU8, unzipSync } from 'fflate'
import { expect, it } from 'vitest'
import { diagnosticArchive, diagnosticReport } from '../src/client/report.ts'
import { diagnosticData } from './fixtures.client.ts'

it('exports only selected groups and keeps explicit incomplete coverage', () => {
  const data = diagnosticData()
  data.incomplete = true
  data.unindexedSessions = 3
  data.failedSessions = 1
  data.omittedOccurrences = 5
  const selected = data.groups.slice(0, 1)
  const report = diagnosticReport(data, selected, 'Report', 'Incomplete index')
  expect(JSON.parse(report.json)).toMatchObject({
    formatVersion: 1, incomplete: true, unindexedSessions: 3, failedSessions: 1, omittedOccurrences: 5, groups: selected,
  })
  expect(report.json).not.toContain('EXIT_60')
  expect(report.markdown).toContain('Incomplete index')
  expect(report.markdown).toContain('session-0 · #2')
  expect(report.markdown).not.toContain('session-1')
})

it('freezes the preview rather than exporting later data or a fresh query', () => {
  const data = diagnosticData()
  const report = diagnosticReport(data, data.groups, 'Report', 'Incomplete index')
  const preview = { ...report }
  const first = data.groups[0]
  if (first === undefined) throw new Error('missing fixture group')
  first.message = 'Later private error'
  data.groups.length = 0
  const files = unzipSync(diagnosticArchive(report))
  expect(Object.keys(files).sort()).toEqual(['diagnostics.json', 'diagnostics.md'])
  expect(strFromU8(files['diagnostics.json']!)).toBe(preview.json)
  expect(strFromU8(files['diagnostics.md']!)).toBe(preview.markdown)
  expect(preview.json).not.toContain('Later private error')
})

it.each([3, 6])('preserves a %i-backtick payload inside a longer literal fence', (width) => {
  const data = diagnosticData()
  const item = data.groups[0]?.occurrences[0]
  if (item === undefined) throw new Error('missing fixture occurrence')
  const embedded = '`'.repeat(width)
  item.details = `before\n${embedded}html\n<script>arbitrary error text</script>\n${embedded}\nafter`
  const report = diagnosticReport(data, data.groups, 'Report', 'Incomplete index')
  const outer = '`'.repeat(width + 1)
  expect(report.markdown).toContain(`${outer}text\n${item.sessionId} · #${item.eventSeq}\n${item.details}\n${outer}`)
  expect(JSON.parse(report.json).groups[0].occurrences[0].details).toBe(item.details)
  expect(report.json).not.toMatch(/"(?:arguments|attachments|cwd|transcript|stdout)"\s*:/)
})

it('keeps source, code, Markdown images, and HTML inside the literal summary', () => {
  const data = diagnosticData()
  const group = data.groups[0]
  if (group === undefined) throw new Error('missing fixture group')
  group.source = '`tool`'
  group.code = '<img src="https://example.invalid/code">'
  group.message = '![remote image](https://example.invalid/message)\n# Forged heading\n<img src="https://example.invalid/error">'
  const report = diagnosticReport(data, data.groups, 'Report', 'Incomplete index')
  expect(report.markdown).toContain(`## ${group.category}\n\n\`\`\`text\n${group.source} · ${group.code}\n${group.message}\n\`\`\``)
  expect(JSON.parse(report.json).groups[0]).toMatchObject({ source: group.source, code: group.code, message: group.message })
})
