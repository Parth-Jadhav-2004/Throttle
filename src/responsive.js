function getWidgetViewMode(width, height) {
  if (width <= 250 || height <= 340) return 'compact';
  if (width < 340 || height < 540) return 'condensed';
  return 'full';
}

if (typeof globalThis !== 'undefined') globalThis.getWidgetViewMode = getWidgetViewMode;
if (typeof module !== 'undefined' && module.exports) module.exports = { getWidgetViewMode };
