/** Native LanceDB has no darwin-x64 build; unsupported-platform.spec.ts verifies that runtime's refusal. */

/** Whether indexing cases can load the native provider in this process. */
export const nativeKnowledgeAvailable = process.platform !== 'darwin' || process.arch !== 'x64'
