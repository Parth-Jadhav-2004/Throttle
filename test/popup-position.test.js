const test = require('node:test');
const assert = require('node:assert/strict');
const { getPopupBounds, taskbarEdge } = require('../src/popup-position');

const bottomTaskbar = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1032 }
};

test('detects the taskbar edge from the work area', () => {
  assert.equal(taskbarEdge(bottomTaskbar), 'bottom');
  assert.equal(taskbarEdge({ bounds: bottomTaskbar.bounds, workArea: { x: 0, y: 48, width: 1920, height: 1032 } }), 'top');
  assert.equal(taskbarEdge({ bounds: bottomTaskbar.bounds, workArea: { x: 60, y: 0, width: 1860, height: 1080 } }), 'left');
  assert.equal(taskbarEdge({ bounds: bottomTaskbar.bounds, workArea: { x: 0, y: 0, width: 1860, height: 1080 } }), 'right');
});

test('sits above a bottom taskbar, centered on the tray icon but kept on screen', () => {
  const anchor = { x: 1800, y: 1040, width: 24, height: 40 };
  assert.deepEqual(
    getPopupBounds({ display: bottomTaskbar, anchor, width: 380, height: 500 }),
    { x: 1534, y: 526, width: 380, height: 500, edge: 'bottom' }
  );
  const middle = getPopupBounds({ display: bottomTaskbar, anchor: { x: 900, y: 1040, width: 24, height: 40 }, width: 380, height: 500 });
  assert.equal(middle.x, 722);
});

test('drops below a top taskbar', () => {
  const display = { bounds: bottomTaskbar.bounds, workArea: { x: 0, y: 48, width: 1920, height: 1032 } };
  const bounds = getPopupBounds({ display, anchor: { x: 1800, y: 4, width: 24, height: 40 }, width: 380, height: 500 });
  assert.equal(bounds.y, 54);
  assert.equal(bounds.edge, 'top');
});

test('never grows taller than the work area', () => {
  const bounds = getPopupBounds({ display: bottomTaskbar, anchor: null, width: 380, height: 4000 });
  assert.equal(bounds.height, 1020);
  assert.equal(bounds.y, 6);
});
