/** Private SDK host; cancellation terminates this process instead of entering Rust from the Web thread. @module */

/** Plain Node program receiving SDK calls over the inherited private IPC channel. */
export const nativeDriverWorker = `
const { CuaDriver } = await import(process.argv[1]);
const driver = CuaDriver.create({ embedded: true, claudeCodeCompatibility: false });
process.on('message', async request => {
  if (!request || !Number.isSafeInteger(request.id) || typeof request.name !== 'string' || typeof request.argumentsJson !== 'string') {
    process.exit(1);
  }
  try {
    const result = await driver.callTool(request.name, request.argumentsJson);
    process.send?.({ id: request.id, rawJson: result.rawJson });
  } catch (error) {
    process.send?.({ id: request.id, error: error instanceof Error ? error.message : String(error) });
  }
});
process.on('disconnect', () => process.exit(0));
`
