import assert from 'node:assert/strict';
export async function verifyFitCenter(page) {
  await page.waitForSelector('.graph-node'); await page.click('#fit');
  const delta = await page.evaluate(() => {
    const canvas = document.getElementById('canvas').getBoundingClientRect();
    const scene = document.getElementById('scene').getBoundingClientRect();
    return { x: scene.x + scene.width / 2 - canvas.x - canvas.width / 2, y: scene.y + scene.height / 2 - canvas.y - canvas.height / 2 };
  });
  assert.ok(Math.abs(delta.x) < 12 && Math.abs(delta.y) < 12, `Fit must center the complete graph, not leave all extra space at the bottom/right: ${JSON.stringify(delta)}`);
  return delta;
}
