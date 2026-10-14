const POPUP_WIDTH = 380;
const POPUP_GAP = 6;

function taskbarEdge(display) {
  const { bounds, workArea } = display;
  if (workArea.y > bounds.y) return 'top';
  if (workArea.x > bounds.x) return 'left';
  if (workArea.width < bounds.width && workArea.x === bounds.x) return 'right';
  return 'bottom';
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function getPopupBounds({ display, anchor, width = POPUP_WIDTH, height }) {
  const { workArea } = display;
  const h = Math.min(height, workArea.height - POPUP_GAP * 2);
  const edge = taskbarEdge(display);
  const minX = workArea.x + POPUP_GAP;
  const maxX = workArea.x + workArea.width - width - POPUP_GAP;
  const minY = workArea.y + POPUP_GAP;
  const maxY = workArea.y + workArea.height - h - POPUP_GAP;
  const centerX = anchor ? anchor.x + anchor.width / 2 : maxX + width / 2;
  const centerY = anchor ? anchor.y + anchor.height / 2 : maxY + h / 2;

  let x;
  let y;
  if (edge === 'top') {
    x = clamp(centerX - width / 2, minX, maxX);
    y = minY;
  } else if (edge === 'left') {
    x = minX;
    y = clamp(centerY - h / 2, minY, maxY);
  } else if (edge === 'right') {
    x = maxX;
    y = clamp(centerY - h / 2, minY, maxY);
  } else {
    x = clamp(centerX - width / 2, minX, maxX);
    y = maxY;
  }
  return { x: Math.round(x), y: Math.round(y), width, height: Math.round(h), edge };
}

module.exports = { POPUP_WIDTH, POPUP_GAP, taskbarEdge, getPopupBounds };
