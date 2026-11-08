/** Repository facts displayed by the Session's Git branch selector. */

/** A local branch and whether another worktree has checked it out. */
export interface GitBranch {
  readonly name: string
  readonly occupied: boolean
}

/** A non-repository directory, or the current checkout and all local branches. */
export type GitBranchState =
  | { readonly kind: 'unavailable' }
  | ({
    readonly kind: 'repository'
    readonly root: string
    readonly branches: readonly GitBranch[]
  } & (
    | {
      /** Symbolic branch name, including an unborn branch. */
      readonly current: string
      /** Abbreviated commit id, or null before the first commit. */
      readonly commit: string | null
    }
    | {
      /** A detached HEAD always identifies a committed revision. */
      readonly current: null
      readonly commit: string
    }
  ))

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Git could not inspect the Session directory. */
    'git-branch/read-failed': {}
    /** A running Agent is using this working tree. */
    'git-branch/busy': {}
    /** The displayed checkout changed before the switch was admitted. */
    'git-branch/stale': {}
    /** Git refused a switch; inspect local changes and worktree occupancy. */
    'git-branch/rejected': {}
  }
}
