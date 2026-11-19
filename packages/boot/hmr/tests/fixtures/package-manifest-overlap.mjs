/** Exercise process-wide Node hooks without retaining them in the test runner. */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import NodeModule, { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PackageManifests } from '../../src/package-manifest.ts'

const [root] = process.argv.slice(2)
const require = createRequire(import.meta.url)
const realm = require('node-addon-require-builtin').requireBuiltin('internal/bootstrap/realm')
const binding = realm.internalBinding('modules')
const reader = require('internal/modules/package_json_reader')
const manifest = join(root, 'package.json')
const methods = () => [binding.readPackageJSON, binding.getPackageScopeConfig, binding.getPackageType,
  reader.getNearestParentPackageJSON, NodeModule._load]
const original = methods()

for (const reverse of [false, true]) {
  writeFileSync(manifest, '{"type":"commonjs"}')
  const first = new PackageManifests()
  const second = new PackageManifests()
  try {
    first.invalidate(manifest)
    second.invalidate(manifest)
    const remaining = reverse ? first : second
    ;(reverse ? second : first).dispose()
    assert.equal(require('node:path').join, join)
    writeFileSync(manifest, '{"type":"module"}')
    remaining.invalidate(manifest)
    assert.equal(binding.getPackageType(pathToFileURL(join(root, 'entry.js')).href), 'module')
    remaining.dispose()
    assert.deepEqual(methods(), original)
  } finally {
    second.dispose()
    first.dispose()
  }
}
process.stdout.write('overlapping hooks restored\n')
