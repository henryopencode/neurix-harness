/** Source snapshots and same-filesystem application replacement for the local macOS updater. */

/**
 * Copy local source files, preserving uncommitted changes and excluding ignored files.
 * @param source - Original Git working tree.
 * @param destination - Absent directory for the isolated build.
 * @returns After copying the source snapshot.
 */
export declare function snapshotUpdateSource(source: string, destination: string): void

/**
 * Replace an application and restore it if promoting the prepared directory fails.
 * @param installed - Existing application directory.
 * @param prepared - Verified replacement on the same filesystem.
 * @param backup - Absent destination for the old application.
 * @returns After replacement or restoration; restoration failures retain both errors.
 */
export declare function swapUpdateBundles(installed: string, prepared: string, backup: string): void
