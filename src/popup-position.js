const POPUP_WIDTH = 380;
const POPUP_GAP = 6;

function taskbarEdge(display, anchor, taskbar) {
  const { bounds, workArea } = display;
  if (workArea.y > bounds.y) return 'top';
  if (workArea.x > bounds.x) return 'left';
  if (workArea.width < bounds.width && workArea.x === bounds.x) return 'right';
  if (workArea.height < bounds.height && workArea.y === bounds.y) return 'bottom';

  const ref = taskbar || anchor;
  if (ref) {
    const distBottom = Math.abs((bounds.y + bounds.height) - (ref.y + (ref.height || 0)));
    const distTop = Math.abs(ref.y - bounds.y);
    const distLeft = Math.abs(ref.x - bounds.x);
    const distRight = Math.abs((bounds.x + bounds.width) - (ref.x + (ref.width || 0)));
    const isHorizontal = (ref.width || 0) >= (ref.height || 0);

    if (isHorizontal) {
      return distTop < distBottom ? 'top' : 'bottom';
    } else {
      return distLeft < distRight ? 'left' : 'right';
    }
  }

  return 'bottom';
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function getPopupBounds({ display, anchor, width = POPUP_WIDTH, height, taskbar }) {
  const { bounds, workArea } = display;
  const edge = taskbarEdge(display, anchor, taskbar);

  let availLeft = workArea.x + POPUP_GAP;
  let availRight = workArea.x + workArea.width - POPUP_GAP;
  let availTop = workArea.y + POPUP_GAP;
  let availBottom = workArea.y + workArea.height - POPUP_GAP;

  if (edge === 'bottom') {
    let taskbarTop = workArea.y + workArea.height;
    if (taskbar && Number.isFinite(taskbar.y)) {
      taskbarTop = Math.min(taskbarTop, taskbar.y);
    } else if (anchor && Number.isFinite(anchor.y)) {
      const bottomPad = Math.max(0, (bounds.y + bounds.height) - (anchor.y + (anchor.height || 0)));
      taskbarTop = Math.min(taskbarTop, anchor.y - bottomPad);
    }
    availBottom = Math.min(availBottom, taskbarTop - POPUP_GAP);
  } else if (edge === 'top') {
    let taskbarBottom = workArea.y;
    if (taskbar && Number.isFinite(taskbar.y) && Number.isFinite(taskbar.height)) {
      taskbarBottom = Math.max(taskbarBottom, taskbar.y + taskbar.height);
    } else if (anchor && Number.isFinite(anchor.y)) {
      const topPad = Math.max(0, anchor.y - bounds.y);
      taskbarBottom = Math.max(taskbarBottom, anchor.y + (anchor.height || 0) + topPad);
    }
    availTop = Math.max(availTop, taskbarBottom + POPUP_GAP);
  } else if (edge === 'left') {
    let taskbarRight = workArea.x;
    if (taskbar && Number.isFinite(taskbar.x) && Number.isFinite(taskbar.width)) {
      taskbarRight = Math.max(taskbarRight, taskbar.x + taskbar.width);
    } else if (anchor && Number.isFinite(anchor.x)) {
      const leftPad = Math.max(0, anchor.x - bounds.x);
      taskbarRight = Math.max(taskbarRight, anchor.x + (anchor.width || 0) + leftPad);
    }
    availLeft = Math.max(availLeft, taskbarRight + POPUP_GAP);
  } else if (edge === 'right') {
    let taskbarLeft = workArea.x + workArea.width;
    if (taskbar && Number.isFinite(taskbar.x)) {
      taskbarLeft = Math.min(taskbarLeft, taskbar.x);
    } else if (anchor && Number.isFinite(anchor.x)) {
      const rightPad = Math.max(0, (bounds.x + bounds.width) - (anchor.x + (anchor.width || 0)));
      taskbarLeft = Math.min(taskbarLeft, anchor.x - rightPad);
    }
    availRight = Math.min(availRight, taskbarLeft - POPUP_GAP);
  }

  const maxH = Math.max(120, availBottom - availTop);
  const h = Math.min(height, maxH);

  const minX = availLeft;
  const maxX = availRight - width;
  const minY = availTop;
  const maxY = availBottom - h;

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
