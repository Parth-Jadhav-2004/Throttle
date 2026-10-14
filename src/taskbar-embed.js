const GWL_STYLE = -16;
const WS_CHILD = 0x40000000;
const WS_POPUP = 0x80000000;
const WS_CAPTION = 0x00c00000;

let api;

function loadApi() {
  if (api !== undefined) return api;
  api = null;
  if (process.platform !== 'win32') return api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const RECT = koffi.struct('ThrottleRect', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    api = {
      koffi,
      RECT,
      FindWindowW: user32.func('void* __stdcall FindWindowW(str16, str16)'),
      FindWindowExW: user32.func('void* __stdcall FindWindowExW(void*, void*, str16, str16)'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(void*, _Out_ ThrottleRect*)'),
      SetParent: user32.func('void* __stdcall SetParent(void*, void*)'),
      GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(void*, int)'),
      SetWindowLongPtrW: user32.func('intptr_t __stdcall SetWindowLongPtrW(void*, int, intptr_t)'),
      MoveWindow: user32.func('bool __stdcall MoveWindow(void*, int, int, int, int, bool)'),
      IsWindow: user32.func('bool __stdcall IsWindow(void*)'),
      PostThreadMessageW: user32.func('bool __stdcall PostThreadMessageW(uint32, uint32, uintptr_t, intptr_t)')
    };
  } catch (error) {
    console.warn('Taskbar embedding unavailable:', error.message);
  }
  return api;
}

function rectOf(handle) {
  const rect = {};
  if (!handle || !api.GetWindowRect(handle, rect)) return null;
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

function address(handle) {
  return handle ? String(api.koffi.address(handle)) : null;
}

// Rects are physical pixels. The strip is placed just left of the notification area,
// in coordinates relative to the taskbar it is parented to.
function findTaskbar() {
  if (!loadApi()) return null;
  const tray = api.FindWindowW('Shell_TrayWnd', null);
  if (!tray) return null;
  const notify = api.FindWindowExW(tray, null, 'TrayNotifyWnd', null);
  const taskbar = rectOf(tray);
  const notifyRect = rectOf(notify);
  if (!taskbar || !notifyRect) return null;
  return {
    handle: tray,
    id: address(tray),
    taskbar,
    notify: notifyRect,
    horizontal: taskbar.right - taskbar.left > taskbar.bottom - taskbar.top
  };
}

function stripPlacement(found, widthPx, gapPx) {
  const height = found.taskbar.bottom - found.taskbar.top;
  const x = found.notify.left - found.taskbar.left - widthPx - gapPx;
  return { x: Math.max(0, x), y: 0, width: widthPx, height };
}

function embed(nativeHandle, parentHandle) {
  if (!loadApi()) return false;
  const hwnd = api.koffi.decode(nativeHandle, 'void*');
  const style = Number(api.GetWindowLongPtrW(hwnd, GWL_STYLE));
  api.SetWindowLongPtrW(hwnd, GWL_STYLE, (style & ~WS_POPUP & ~WS_CAPTION) | WS_CHILD);
  return Boolean(api.SetParent(hwnd, parentHandle));
}

function move(nativeHandle, { x, y, width, height }) {
  if (!loadApi()) return false;
  const hwnd = api.koffi.decode(nativeHandle, 'void*');
  return api.MoveWindow(hwnd, Math.round(x), Math.round(y), Math.round(width), Math.round(height), true);
}

function screenRect(nativeHandle) {
  if (!loadApi()) return null;
  return rectOf(api.koffi.decode(nativeHandle, 'void*'));
}

function quitThread(threadId) {
  return Boolean(loadApi() && threadId && api.PostThreadMessageW(threadId, 0x0012, 0, 0));
}

module.exports = {
  available: () => Boolean(loadApi()),
  findTaskbar,
  stripPlacement,
  embed,
  move,
  screenRect,
  quitThread
};
