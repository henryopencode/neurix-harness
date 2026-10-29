/** Local-source capture and app replacement with restoration after a failed promotion. */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { snapshotUpdateSource, swapUpdateBundles } from '../scripts/update-installed-macos.mjs'

it('captures uncommitted source and new files while excluding ignored files and removed files', () => {
  const root = mkdtempSync(join(tmpdir(), 'neurix-update-source-'))
  const source = join(root, 'working tree'), destination = join(root, 'build source')
  mkdirSync(source)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: source, stdio: 'pipe' })
  try {
    git('init', '--initial-branch=master')
    writeFileSync(join(source, 'tracked.txt'), 'committed\n')
    writeFileSync(join(source, 'removed.txt'), 'removed\n')
    writeFileSync(join(source, '.gitignore'), 'private.env\nnode_modules/\n')
    git('add', '.')
    git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Test',
      '-c', 'user.email=test@example.invalid', 'commit', '-m', 'source')
    writeFileSync(join(source, 'tracked.txt'), 'local edits\n')
    writeFileSync(join(source, 'new file.txt'), 'uncommitted addition\n')
    writeFileSync(join(source, 'private.env'), 'private fixture\n')
    rmSync(join(source, 'removed.txt'))
    snapshotUpdateSource(source, destination)
    expect(readFileSync(join(destination, 'tracked.txt'), 'utf8')).toBe('local edits\n')
    expect(readFileSync(join(destination, 'new file.txt'), 'utf8')).toBe('uncommitted addition\n')
    expect(existsSync(join(destination, 'private.env'))).toBe(false)
    expect(existsSync(join(destination, 'removed.txt'))).toBe(false)
    expect(readFileSync(join(source, 'tracked.txt'), 'utf8')).toBe('local edits\n')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it.skipIf(process.platform === 'win32')('retains a dangling source symlink without reading its target', () => {
  const root = mkdtempSync(join(tmpdir(), 'neurix-update-link-'))
  const source = join(root, 'source'), destination = join(root, 'snapshot')
  mkdirSync(source)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: source, stdio: 'pipe' })
  try {
    git('init', '--initial-branch=master')
    writeFileSync(join(source, 'tracked.txt'), 'source\n')
    git('add', '.')
    git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Test',
      '-c', 'user.email=test@example.invalid', 'commit', '-m', 'source')
    symlinkSync('absent.txt', join(source, 'linked.txt'))
    snapshotUpdateSource(source, destination)
    expect(readlinkSync(join(destination, 'linked.txt'))).toBe('absent.txt')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it.each(['install', 'failed-promotion', 'existing-backup'] as const)('%s preserves the replaced app or restores it', (operation) => {
  const root = mkdtempSync(join(tmpdir(), 'neurix-update-swap-'))
  const installed = join(root, 'Neurix Harness.app'), prepared = join(root, 'incoming.app'), backup = join(root, 'backup.app')
  mkdirSync(installed)
  writeFileSync(join(installed, 'version'), 'old\n')
  try {
    if (operation !== 'failed-promotion') {
      mkdirSync(prepared)
      writeFileSync(join(prepared, 'version'), 'new\n')
    }
    if (operation === 'existing-backup') {
      mkdirSync(backup)
      writeFileSync(join(backup, 'version'), 'previous backup\n')
      expect(() => { swapUpdateBundles(installed, prepared, backup) }).toThrow('备份路径已存在')
      expect(readFileSync(join(backup, 'version'), 'utf8')).toBe('previous backup\n')
    } else if (operation === 'failed-promotion') {
      expect(() => { swapUpdateBundles(installed, prepared, backup) }).toThrow('已恢复旧应用')
      expect(existsSync(backup)).toBe(false)
    } else {
      swapUpdateBundles(installed, prepared, backup)
      expect(readFileSync(join(backup, 'version'), 'utf8')).toBe('old\n')
    }
    expect(readFileSync(join(installed, 'version'), 'utf8')).toBe(operation === 'install' ? 'new\n' : 'old\n')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
