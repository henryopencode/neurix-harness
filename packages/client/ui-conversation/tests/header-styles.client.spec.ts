/** Conversation navigation spacing preserves the right-pane header alignment. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url), 'utf8')

describe('conversation header geometry', () => {
  it('keeps the tab strip flush in narrow Web windows', () => {
    const narrow = /@media \(max-width: 767px\) \{([\s\S]*?)\n\}/.exec(css)?.[1]
    expect(narrow).toContain(':global(html:not([data-platform])) .tabs')
    expect(narrow).toContain('padding-left: 0')
  })

  it('keeps the compact header and small control row heights', () => {
    expect(css.match(/\.header\s*\{([^}]*)\}/)?.[1]).toContain('min-height: 84px')
    expect(css.match(/\.viewTabs\s*\{([^}]*)\}/)?.[1]).toContain('min-height: 28px')
    expect(css.match(/\.tab\s*\{([^}]*)\}/)?.[1]).toContain('padding: 0 8px')
    expect(css.match(/\.tab\s*\{([^}]*)\}/)?.[1]).toContain('line-height: 20px')
  })

  it('clips overflowing title actions and fades them inside the gap before the next control', () => {
    const cluster = css.match(/\.titleCluster\s*\{([^}]*)\}/)?.[1]
    expect(cluster).toContain('overflow: clip')
    expect(cluster).toContain('--title-cluster-fade: 20px')
    expect(cluster).toContain('margin: -4px calc(-1 * var(--title-cluster-fade)) -4px -4px')
    expect(cluster).toContain('padding: 4px var(--title-cluster-fade) 4px 4px')
    expect(cluster).toContain('mask-image: linear-gradient(to left, transparent calc(0.3 * var(--title-cluster-fade)), #000 var(--title-cluster-fade))')
    expect(css.match(/^\.headerUtilities\s*\{([^}]*)\}/m)?.[1]).toContain('margin-left: 20px')
    expect(css.match(/\.titleCluster:has\(\+ \.headerUtilities:empty\)\s*\{([^}]*)\}/)?.[1]).toContain('--title-cluster-fade: 8px')
    expect(css.match(/^\.headerCorner\s*\{([^}]*)\}/m)?.[1]).toContain('margin-left: 8px')
  })

  it('keeps view controls and their overflow action on the compact spacing', () => {
    expect(css.match(/\.viewTabs\s*\{([^}]*)\}/)?.[1]).toContain('gap: 4px')
    expect(css.match(/\.tabs\s*\{([^}]*)\}/)?.[1]).toContain('gap: 4px')
  })
})
