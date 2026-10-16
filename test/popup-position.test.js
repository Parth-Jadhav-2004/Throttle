const test = require('node:test');
const assert = require('node:assert/strict');
const { getPopupBounds, taskbarEdge, POPUP_GAP } = require('../src/popup-position');

const bottomTaskbar = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1032 }
};

const autoHideBottom = {
  bounds: { x: 0, y: 0, width: 1536, height: 960 },
  workArea: { x: 0, y: 0, width: 1536, height: 960 }
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

test('sits completely above the taskbar when auto-hide taskbar is active', () => {
  // Strip clicked at bottom of screen
  const stripAnchor = { x: 1200, y: 912, width: 120, height: 48 };
  const stripBounds = getPopupBounds({ display: autoHideBottom, anchor: stripAnchor, width: 380, height: 520 });
  assert.equal(stripBounds.edge, 'bottom');
  assert.equal(stripBounds.y + stripBounds.height, stripAnchor.y - POPUP_GAP);
  assert.equal(stripBounds.y, 386);

  // Tray icon clicked at bottom of screen (vertically centered inside taskbar)
  const trayAnchor = { x: 1300, y: 924, width: 24, height: 24 };
  const trayBounds = getPopupBounds({ display: autoHideBottom, anchor: trayAnchor, width: 380, height: 520 });
  assert.equal(trayBounds.edge, 'bottom');
  assert.equal(trayBounds.y + trayBounds.height, 912 - POPUP_GAP);

  // Explicit taskbar rectangle provided
  const taskbar = { x: 0, y: 912, width: 1536, height: 48 };
  const taskbarBounds = getPopupBounds({ display: autoHideBottom, anchor: trayAnchor, width: 380, height: 520, taskbar });
  assert.equal(taskbarBounds.edge, 'bottom');
  assert.equal(taskbarBounds.y + taskbarBounds.height, taskbar.y - POPUP_GAP);
});

test('handles top, left and right taskbar positioning with auto-hide', () => {
  const topAnchor = { x: 500, y: 0, width: 100, height: 48 };
  const topBounds = getPopupBounds({ display: autoHideBottom, anchor: topAnchor, width: 380, height: 500 });
  assert.equal(topBounds.edge, 'top');
  assert.equal(topBounds.y, 48 + POPUP_GAP);

  const leftAnchor = { x: 0, y: 300, width: 60, height: 100 };
  const leftBounds = getPopupBounds({ display: autoHideBottom, anchor: leftAnchor, width: 380, height: 500 });
  assert.equal(leftBounds.edge, 'left');
  assert.equal(leftBounds.x, 60 + POPUP_GAP);

  const rightAnchor = { x: 1476, y: 300, width: 60, height: 100 };
  const rightBounds = getPopupBounds({ display: autoHideBottom, anchor: rightAnchor, width: 380, height: 500 });
  assert.equal(rightBounds.edge, 'right');
  assert.equal(rightBounds.x + rightBounds.width, 1476 - POPUP_GAP);
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
