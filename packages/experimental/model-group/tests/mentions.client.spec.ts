/** Exact model recipients stay separate from file references and code literals. */
import { describe, expect, it } from 'vitest'
import { resolveModelRecipients } from '../../client-ui-model-group/src/client/mentions.ts'

const members = ['model-a', 'model-b'].map(name => ({ name, label: name, provider: 'mock', model: name, strengths: '' }))

describe('group model mentions', () => {
  it('recognizes aliases in Chinese messages with or without surrounding spaces', () => {
    expect(resolveModelRecipients('@model-a 检查这个函数', members)).toEqual(['model-a'])
    expect(resolveModelRecipients('请 @model-b 单独说明结论', members)).toEqual(['model-b'])
    expect(resolveModelRecipients('请@model-b单独说明结论', members)).toEqual(['model-b'])
    expect(resolveModelRecipients('@model-a，检查这个函数', members)).toEqual(['model-a'])
  })
  it('keeps distinct recipients in their first-mentioned order', () => {
    expect(resolveModelRecipients('@model-b @model-a @model-b\n比较结果', members)).toEqual(['model-b', 'model-a'])
  })
  it('does not interpret email, file paths, unknown aliases, or alias prefixes as recipients', () => {
    expect(resolveModelRecipients('mail@model-a @model-a-extra @model-a/file.ts @unknown', members)).toEqual([])
    expect(resolveModelRecipients('@model-b 检查 @src/app.ts', members)).toEqual(['model-b'])
  })
  it('ignores references and quotes masked by the editor', () => {
    expect(resolveModelRecipients('请 \uFFFC @model-b 检查 \uFFFC', members)).toEqual(['model-b'])
    expect(resolveModelRecipients('请 \uFFFC 检查', members)).toEqual([])
  })
  it('ignores inline and fenced code literals', () => {
    expect(resolveModelRecipients('检查 `@model-a`，请 @model-b 回答', members)).toEqual(['model-b'])
    expect(resolveModelRecipients('```python\n@model-a\n```\n@model-b 回答', members)).toEqual(['model-b'])
  })
})
