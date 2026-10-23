/** External browser fixture for logged input and dialog handling through the shipped profile. */
import { launch, browserFixture } from '../../../packages/experimental/computer-use-unified/tests/fixtures/browser.ts'

browserFixture.locatorBounds = {
  '#drag-source': { x: 20, y: 30, width: 40, height: 40 },
  '#drop-target': { x: 500, y: 30, width: 40, height: 40 },
}
browserFixture.dialogOnClick = true
export const chromium = { launch }
