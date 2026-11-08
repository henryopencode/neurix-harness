/** Live Git HEAD metadata; no repository contents or persistent Session state. */
export type GitHead =
  | { readonly kind: 'branch'; readonly name: string }
  | { readonly kind: 'detached'; readonly commit: string }
  | { readonly kind: 'not-repository' }
  | { readonly kind: 'unavailable' }

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Git could not read the selected Session's repository metadata. */
    'git-branch/read-failed': Record<string, never>
    /** A resource address does not identify a Session. */
    'git-branch/invalid-address': Record<string, never>
  }
}
