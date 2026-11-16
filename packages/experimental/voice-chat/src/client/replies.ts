/** Incremental speech segments derived exclusively from visible assistant text. */

/** One cumulative assistant answer; identity stays stable when a stream settles. */
export interface VoiceReply { readonly key: string; readonly turn: number; readonly text: string; readonly final: boolean }

function spokenText(markdown: string): string {
  return markdown.replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/`[^`]*(?:`|$)/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/<[^>]*(?:>|$)/g, '')
    .replace(/^[ \t]*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/[*_~]/g, '')
}

/** Sentence buffering with a monotonic cursor; history and repeated snapshots cannot replay speech. */
export class ReplySentences {
  private readonly positions = new Map<string, number>()

  constructor(private readonly maximum: number) {}

  /**
   * Consume newly available plain-text sentences, preserving a short unfinished tail.
   * @param reply - cumulative visible answer, with reasoning and tools already excluded.
   * @param skip - remember existing text without speaking it, such as initial history.
   * @returns newly completed bounded segments, in display order.
   */
  take(reply: VoiceReply, skip = false): string[] {
    const text = spokenText(reply.text)
    let offset = this.positions.get(reply.key) ?? 0
    if (skip) { this.positions.set(reply.key, text.length); return [] }
    if (offset > text.length) { this.positions.set(reply.key, text.length); return [] }
    const segments: string[] = []
    while (offset < text.length) {
      const tail = text.slice(offset)
      const punctuation = /[。！？；\n]|[.!?;](?=\s|$)/.exec(tail)
      let end = punctuation ? punctuation.index + punctuation[0].length : reply.final ? tail.length : 0
      if (end === 0 && tail.length < this.maximum) break
      end = Math.min(end || this.maximum, this.maximum)
      const sentence = tail.slice(0, end).trim()
      if (sentence !== '') segments.push(sentence)
      offset += end
    }
    this.positions.set(reply.key, offset)
    return segments
  }
}
