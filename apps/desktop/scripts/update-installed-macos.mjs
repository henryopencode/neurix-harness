/** Build a local macOS app from a working-tree snapshot and retain the replaced bundle for rollback. */

import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  accessSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'

const repository = resolve(import.meta.dirname, '../../..')
const appId = 'com.deepseek.harness'

function capture(command, args, cwd = repository) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim()
}

/**
 * Copy tracked files and non-ignored additions, including local edits and deletions, into an empty checkout.
 * @param {string} source - Original Git working tree; never modified.
 * @param {string} destination - Absent directory for an independent checkout and dependency installation.
 * @returns {void} After the source snapshot is complete.
 */
export function snapshotUpdateSource(source, destination) {
  capture('git', ['clone', '--quiet', '--shared', '--no-checkout', '--', source, destination], source)
  capture('git', ['read-tree', 'HEAD'], destination)
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: source, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }).split('\0').filter(Boolean)
  for (const file of new Set(files)) {
    const input = join(source, file)
    const entry = lstatSync(input, { throwIfNoEntry: false })
    if (entry === undefined) continue
    const output = join(destination, file)
    mkdirSync(dirname(output), { recursive: true })
    if (entry.isSymbolicLink()) symlinkSync(readlinkSync(input), output)
    else copyFileSync(input, output)
  }
}

/**
 * Promote an already verified app on the same filesystem, restoring the old app if promotion fails.
 * @param {string} installed - Existing application directory.
 * @param {string} prepared - Verified replacement directory on the same filesystem.
 * @param {string} backup - Absent destination for the old application.
 * @returns {void} After replacement or restoration; restoration failures retain both errors.
 */
export function swapUpdateBundles(installed, prepared, backup) {
  if (existsSync(backup)) throw new Error(`备份路径已存在：${backup}`)
  renameSync(installed, backup)
  try {
    renameSync(prepared, installed)
  } catch (error) {
    try { renameSync(backup, installed) } catch (restoreError) {
      throw new AggregateError([error, restoreError], `替换和恢复均失败。旧应用保留在 ${backup}；请用 Finder 恢复。`)
    }
    throw new Error('替换失败，已恢复旧应用。', { cause: error })
  }
}

function appInfo(path) {
  if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory() || !path.endsWith('.app')) {
    throw new Error(`应用路径必须为真实的 .app 目录：${path}`)
  }
  const plist = join(path, 'Contents/Info.plist')
  const info = JSON.parse(capture('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist]))
  if (info.CFBundleIdentifier !== appId || typeof info.CFBundleExecutable !== 'string'
    || basename(info.CFBundleExecutable) !== info.CFBundleExecutable
    || typeof info.CFBundleShortVersionString !== 'string') throw new Error(`不是 Neurix Harness 应用：${path}`)
  const executable = join(path, 'Contents/MacOS', info.CFBundleExecutable)
  const architectures = capture('/usr/bin/lipo', ['-archs', executable]).split(/\s+/u)
  return { version: info.CFBundleShortVersionString, executable, architectures }
}

function runNode(node, args, cwd, environment) {
  execFileSync(node, args, { cwd, env: environment, stdio: 'inherit' })
}

function shellQuote(text) { return `'${text.replaceAll("'", "'\\''")}'` }

async function prepareBuildNode(source, run, targetArch) {
  if (existsSync(resolve(dirname(process.execPath), '../include/node/node_api.h'))) return process.execPath
  const lock = JSON.parse(readFileSync(join(source, 'scripts/primary-runtime/lock.json'), 'utf8'))
  const artifact = lock.targets[`mac-${targetArch}`]
  if (!/^\d+\.\d+\.\d+$/u.test(lock.nodeVersion) || !/^[a-f0-9]{64}$/u.test(artifact.nodeSha256)
    || artifact.nodeArchive !== `darwin-${targetArch}.tar.gz`) throw new Error('Node 工具链锁定信息无效。')
  const cache = join(repository, 'apps/desktop/.desktop-build/downloads')
  mkdirSync(cache, { recursive: true })
  const archive = join(cache, artifact.nodeSha256)
  if (!existsSync(archive)) {
    console.log(`下载 Node ${lock.nodeVersion} 完整开发工具链…`)
    const url = `https://nodejs.org/dist/v${lock.nodeVersion}/node-v${lock.nodeVersion}-${artifact.nodeArchive}`
    const response = await fetch(url, { signal: AbortSignal.timeout(300_000) })
    if (!response.ok) throw new Error(`Node 下载失败：HTTP ${response.status}`)
    const temporary = join(cache, `.local-update-${randomUUID()}`)
    try {
      writeFileSync(temporary, Buffer.from(await response.arrayBuffer()))
      if (createHash('sha256').update(readFileSync(temporary)).digest('hex') !== artifact.nodeSha256) {
        throw new Error('Node 下载校验失败，已停止更新。')
      }
      renameSync(temporary, archive)
    } finally { rmSync(temporary, { force: true }) }
  }
  if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== artifact.nodeSha256) {
    throw new Error(`Node 缓存校验失败。请删除 ${archive} 后重试。`)
  }
  const directory = join(run, 'node')
  mkdirSync(directory)
  capture('/usr/bin/tar', ['-xzf', archive, '--strip-components=1', '-C', directory])
  const node = join(directory, 'bin/node')
  if (capture(node, ['-p', 'process.arch']) !== targetArch || !existsSync(join(directory, 'include/node/node_api.h'))) {
    throw new Error('Node 开发工具链缺少对应架构或头文件。')
  }
  return node
}

function runningPid(path) {
  const processes = capture('/bin/ps', ['-axo', 'pid=,comm='])
  const executable = appInfo(path).executable
  return processes.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(.+)$/u.exec(line)
    return match?.[2] === executable ? [Number(match[1])] : []
  })
}

async function quitInstalledApp(path) {
  if (runningPid(path).length === 0) return
  console.log('请保存正在进行的工作；正在请求 Neurix Harness 正常退出…')
  capture('/usr/bin/osascript', ['-e', 'on run argv\ntell application (item 1 of argv) to quit\nend run', path])
  const deadline = Date.now() + 60_000
  while (runningPid(path).length !== 0) {
    if (Date.now() >= deadline) throw new Error('应用仍在运行，尚未替换。请退出 Neurix Harness 后重试。')
    await new Promise(resolveWait => setTimeout(resolveWait, 250))
  }
}

async function installApp(installed, replacement) {
  const current = appInfo(installed)
  const next = appInfo(replacement)
  if (!next.architectures.some(arch => current.architectures.includes(arch))) throw new Error('新旧应用架构不匹配，尚未替换。')
  const parent = dirname(installed)
  accessSync(parent, constants.W_OK)
  const lock = join(parent, '.neurix-local-update-lock')
  try { mkdirSync(lock) } catch (error) {
    throw new Error(`无法取得更新锁 ${lock}。确认没有其他更新程序运行后再重试。`, { cause: error })
  }
  let transaction
  try {
    transaction = mkdtempSync(join(parent, '.neurix-local-backup-'))
    const prepared = join(transaction, 'incoming.app')
    const backup = join(transaction, 'Neurix Harness.app')
    console.log(`准备 ${current.version} → ${next.version}；旧版备份：${backup}`)
    capture('/usr/bin/ditto', [replacement, prepared])
    capture('/usr/bin/codesign', ['--verify', '--deep', '--strict', prepared])
    await quitInstalledApp(installed)
    const rollbackScript = join(transaction, 'rollback.command')
    const launcher = join(repository, 'update-neurix.command')
    writeFileSync(rollbackScript, `#!/bin/bash\nset -euo pipefail\nexec ${shellQuote(launcher)} --app ${shellQuote(installed)} --install-from ${shellQuote(backup)}\n`, { mode: 0o755 })
    swapUpdateBundles(installed, prepared, backup)
    console.log(`已更新。回滚入口：${rollbackScript}`)
    capture('/usr/bin/open', [installed])
    console.log('已请求启动新版本。备份只还原应用，不回退账号、会话或数据格式。')
  } finally {
    rmSync(lock, { recursive: true })
    if (transaction !== undefined) console.log(`备份与恢复记录：${transaction}`)
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    app: { type: 'string' }, check: { type: 'boolean', default: false },
    'prepare-only': { type: 'boolean', default: false },
    'install-from': { type: 'string' }, help: { type: 'boolean', default: false },
  } })
  if (values.help) {
    console.log('用法：./update-neurix.command [--check | --prepare-only | --install-from <app>] [--app <已安装 app>]\n默认：打包当前源码、正常退出已安装应用、备份并替换，然后启动。--check 只检查环境；--prepare-only 只生成安装入口。')
    return
  }
  if (process.platform !== 'darwin') throw new Error('此脚本仅用于更新 macOS 应用。')
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 24 || major === 24 && minor < 9) throw new Error('需要 Node 24.9 或更高版本。')
  if ([values.check, values['prepare-only'], values['install-from'] !== undefined].filter(Boolean).length > 1) {
    throw new Error('--check、--prepare-only 和 --install-from 只能选择一个。')
  }
  const installed = resolve(values.app ?? ['/Applications/Neurix Harness.app', join(homedir(), 'Applications/Neurix Harness.app')]
    .find(path => existsSync(path)) ?? '/Applications/Neurix Harness.app')
  const info = appInfo(installed)
  if (values['install-from'] !== undefined) {
    await installApp(installed, resolve(values['install-from']))
    return
  }
  const targetArch = info.architectures.includes('arm64') ? 'arm64' : info.architectures.includes('x86_64') ? 'x64' : undefined
  if (targetArch === undefined || targetArch === 'arm64' && process.arch !== 'arm64') {
    throw new Error('请使用 arm64 Node 运行 arm64 应用更新；可通过 NEURIX_UPDATE_NODE 指定。')
  }
  accessSync(dirname(installed), constants.W_OK)
  const pnpm = [join(installed, 'Contents/Resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs'),
    join(repository, 'apps/desktop/node_modules/pnpm/bin/pnpm.mjs')].find(path => existsSync(path))
  if (pnpm === undefined) throw new Error('找不到内置 pnpm；请先准备桌面开发依赖。')
  capture('git', ['rev-parse', '--verify', 'HEAD'])
  const version = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')).version
  console.log(`安装位置：${installed}\n当前版本：${info.version}\n源码版本：${version}\n目标：mac-${targetArch}；Node ${process.version} (${process.arch})\n更新为本地开发构建（ad-hoc 签名）。配置和会话继续保存在现有数据目录。`)
  capture('/usr/bin/xcrun', ['--find', 'clang'])
  capture('/usr/bin/xcrun', ['--find', 'swiftc'])
  if (values.check) {
    console.log('环境检查通过。运行脚本时会在独立目录安装依赖并完整打包，成功后才退出和替换应用。')
    return
  }
  const runs = join(repository, 'apps/desktop/.desktop-build/local-updates')
  mkdirSync(runs, { recursive: true })
  const run = mkdtempSync(join(runs, 'update-'))
  const source = join(run, 'source')
  console.log(`独立构建目录：${run}`)
  snapshotUpdateSource(repository, source)
  const node = await prepareBuildNode(source, run, targetArch)
  const environment = { ...process.env, PATH: `${dirname(node)}:${process.env.PATH ?? ''}`,
    DSH_DESKTOP_PACKAGE_CACHE_DIR: join(repository, 'apps/desktop/.desktop-build') }
  console.log('安装独立构建依赖…')
  runNode(node, [pnpm, 'install', '--frozen-lockfile'], source, environment)
  console.log('构建、打包并验证完整应用…')
  runNode(node, [pnpm, '--dir', 'apps/desktop', 'run', 'package:dir', `mac-${targetArch}`, '--unsigned'], source, environment)
  const paths = desktopTargetBuildPaths(`mac-${targetArch}`)
  const replacement = join(source, 'apps/desktop/.desktop-build/targets', `mac-${targetArch}`,
    'unsigned-artifacts', targetArch === 'arm64' ? 'mac-arm64' : 'mac', 'Neurix Harness.app')
  if (appInfo(replacement).version !== version) throw new Error('打包版本与本次源码版本不一致，尚未替换。')
  capture('/usr/bin/codesign', ['--verify', '--deep', '--strict', replacement])
  const installer = join(run, 'install.command')
  writeFileSync(installer, `#!/bin/bash\nset -euo pipefail\nexec ${shellQuote(join(repository, 'update-neurix.command'))} --app ${shellQuote(installed)} --install-from ${shellQuote(replacement)}\n`, { mode: 0o755 })
  console.log(`安装入口：${installer}\n构建缓存：${paths.downloads}`)
  if (!values['prepare-only']) await installApp(installed, replacement)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`更新失败：${error instanceof Error ? error.message : String(error)}`)
    if (error instanceof Error && error.cause instanceof Error) console.error(error.cause.message)
    process.exitCode = 1
  })
}
