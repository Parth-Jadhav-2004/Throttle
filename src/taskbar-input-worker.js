const { parentPort, workerData } = require('node:worker_threads');
const koffi = require('koffi');

const WH_MOUSE_LL = 14;
const WM_MOUSEMOVE = 0x200;
const DOWN = { 0x201: 'left', 0x204: 'right' };
const UP = { 0x202: 'left', 0x205: 'right' };

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const POINT = koffi.struct('InputPoint', { x: 'long', y: 'long' });
const RECT = koffi.struct('InputRect', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const MSLL = koffi.struct('InputMsll', { pt: POINT, mouseData: 'uint32', flags: 'uint32', time: 'uint32', extra: 'uintptr_t' });
const HookProc = koffi.proto('intptr_t __stdcall ThrottleHookProc(int code, uintptr_t wParam, void *lParam)');
const SetWindowsHookExW = user32.func('void* __stdcall SetWindowsHookExW(int, ThrottleHookProc *, void *, uint32)');
const CallNextHookEx = user32.func('intptr_t __stdcall CallNextHookEx(void *, int, uintptr_t, void *)');
const UnhookWindowsHookEx = user32.func('bool __stdcall UnhookWindowsHookEx(void *)');
const GetMessageW = user32.func('int __stdcall GetMessageW(void *, void *, uint32, uint32)');
const FindWindowW = user32.func('void* __stdcall FindWindowW(str16, str16)');
const FindWindowExW = user32.func('void* __stdcall FindWindowExW(void *, void *, str16, str16)');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void *, _Out_ InputRect *)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *)');
const IsWindow = user32.func('bool __stdcall IsWindow(void *)');
const GetModuleHandleW = kernel32.func('void* __stdcall GetModuleHandleW(str16)');
const GetCurrentThreadId = kernel32.func('uint32 __stdcall GetCurrentThreadId()');

const shared = new Int32Array(workerData.buffer);
Atomics.store(shared, 0, GetCurrentThreadId());

let strip = null;
let hovering = false;
let pressed = null;

function stripRect() {
  if (!strip || !IsWindow(strip)) {
    const tray = FindWindowW('Shell_TrayWnd', null);
    strip = tray ? FindWindowExW(tray, null, null, workerData.title) : null;
  }
  if (!strip || !IsWindowVisible(strip)) return null;
  const rect = {};
  return GetWindowRect(strip, rect) ? rect : null;
}

// Runs for every mouse event on the system, so it does as little as possible.
const proc = koffi.register((code, wParam, lParam) => {
  if (code >= 0) {
    const message = Number(wParam);
    if (message === WM_MOUSEMOVE || DOWN[message] || UP[message]) {
      const { pt } = koffi.decode(lParam, MSLL);
      const rect = stripRect();
      const inside = Boolean(rect && pt.x >= rect.left && pt.x < rect.right && pt.y >= rect.top && pt.y < rect.bottom);
      if (message === WM_MOUSEMOVE) {
        if (inside !== hovering) {
          hovering = inside;
          parentPort.postMessage({ type: 'hover', inside });
        }
      } else if (DOWN[message] && inside) {
        pressed = DOWN[message];
        return 1;
      } else if (UP[message] && pressed === UP[message]) {
        pressed = null;
        if (inside) parentPort.postMessage({ type: 'click', button: UP[message], x: pt.x, y: pt.y });
        return 1;
      }
    }
  }
  return CallNextHookEx(null, code, wParam, lParam);
}, koffi.pointer(HookProc));

const hook = SetWindowsHookExW(WH_MOUSE_LL, proc, GetModuleHandleW(null), 0);
parentPort.postMessage({ type: 'ready', ok: Boolean(hook) });
const msg = Buffer.alloc(64);
while (GetMessageW(msg, null, 0, 0) > 0) { /* pump until WM_QUIT */ }
if (hook) UnhookWindowsHookEx(hook);
koffi.unregister(proc);
