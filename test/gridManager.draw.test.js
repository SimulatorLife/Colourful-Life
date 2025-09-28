import { test } from 'uvu';
import * as assert from 'uvu/assert';

const gridManagerModulePromise = import('../src/gridManager.js');

function createMockContext() {
  return {
    clearRectCalls: [],
    fillRectCalls: [],
    strokeRectCalls: [],
    clearRect(...args) {
      this.clearRectCalls.push(args);
    },
    fillRect(...args) {
      this.fillRectCalls.push(args);
    },
    strokeRect(...args) {
      this.strokeRectCalls.push(args);
    },
  };
}

test('draw hides obstacles when requested', async () => {
  const { default: GridManager } = await gridManagerModulePromise;
  const ctx = createMockContext();
  const grid = new GridManager(4, 4, {
    ctx,
    cellSize: 1,
    eventManager: { activeEvents: [] },
    stats: { onBirth() {}, onDeath() {}, resetTick() {} },
  });

  let drawCalls = 0;

  grid.obstacles.draw = () => {
    drawCalls += 1;
  };

  grid.draw(false);
  assert.is(drawCalls, 0);

  grid.draw({ showObstacles: false });
  assert.is(drawCalls, 0);

  grid.draw();
  assert.is(drawCalls, 1);

  grid.draw({ showObstacles: true });
  assert.is(drawCalls, 2);
});

test.run();
