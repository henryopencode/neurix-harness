/** Unit selection keeps dynamically mounted owners and statically imported dependents reachable. */
import { expect, it } from 'vitest'
import { affectedUnitInputs, runAffectedUnitTests } from './neurix-affected-tests.ts'

it('selects a changed plugin’s tests even for a config-only or deleted implementation change', () => {
  const tracked = ['packages/client/plugin/tests/panel.client.spec.tsx', 'packages/client/other/tests/other.spec.ts', 'packages/client/plugin/src/index.ts']
  expect(affectedUnitInputs(['packages/client/plugin/package.json', 'packages/client/plugin/src/deleted.ts'], tracked))
    .toEqual(['packages/client/plugin/tests/panel.client.spec.tsx'])
  expect(affectedUnitInputs(['packages\\client\\plugin\\src\\index.ts'], tracked))
    .toEqual(['packages/client/plugin/src/index.ts', 'packages/client/plugin/tests/panel.client.spec.tsx'])
})

it('keeps shared sources for Vitest dependency discovery and excludes unrelated browser lanes', () => {
  const tracked = ['scripts/check.ts', 'scripts/check.spec.ts', 'apps/web/tests/surface.e2e.ts', 'apps/web/tests/unit.spec.ts']
  expect(affectedUnitInputs(tracked.slice(0, 3), tracked))
    .toEqual(['apps/web/tests/unit.spec.ts', 'scripts/check.spec.ts', 'scripts/check.ts'])
  expect(affectedUnitInputs(['README.md', 'vendor/cordis/src/index.ts'], tracked)).toEqual([])
})

it.each(['', 'master', '0000', 'a'.repeat(40) + '; echo unsafe'])('rejects an invalid comparison base: %s', (base) => {
  expect(() => runAffectedUnitTests(base)).toThrow('complete Git base commit')
})
