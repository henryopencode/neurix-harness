/** Exact model recipients within ordinary message text. @module */
import type { ModelGroupMember } from '../types.ts'

/**
 * Resolve configured model aliases while preserving file and Session references.
 * @param text - Complete composer message, including inline mentions.
 * @param members - Models configured for the current conversation.
 * @returns Unique recipients in message order, excluding code literals.
 */
export function resolveModelRecipients(text: string, members: readonly ModelGroupMember[]): readonly string[] {
  const known = new Set(members.map(member => member.name))
  const searchable = text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`/gu, token => ' '.repeat(token.length))
  const recipients = new Set<string>()
  for (const match of searchable.matchAll(/(?<![a-zA-Z0-9_])@([a-z][a-z0-9-]*)(?![a-zA-Z0-9_./-])/gu)) {
    const name = match[1]
    if (name !== undefined && known.has(name)) recipients.add(name)
  }
  return [...recipients]
}
