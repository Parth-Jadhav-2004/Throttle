const test = require('node:test');
const assert = require('node:assert/strict');
const { DockTransitionTracker, createDismissalController } = require('../src/dock-state');

test('ignores stale and mismatched transition acknowledgements', () => {
  const tracker = new DockTransitionTracker();
  const showing = tracker.begin('showing');
  const hiding = tracker.begin('hiding');
  assert.equal(tracker.complete('visible', showing), false);
  assert.equal(tracker.complete('visible', hiding), false);
  assert.equal(tracker.complete('hidden', hiding), true);
  assert.equal(tracker.state, 'hidden');
});

test('schedules dismissal once and cancels it when the pointer returns', () => {
  let callback;
  let scheduled = 0;
  let cleared = 0;
  let dismissed = 0;
  const controller = createDismissalController({
    delay: 250,
    onDismiss: () => { dismissed += 1; },
    setTimer: next => {
      scheduled += 1;
      callback = next;
      return { id: scheduled };
    },
    clearTimer: () => { cleared += 1; }
  });

  controller.schedule();
  controller.schedule();
  assert.equal(scheduled, 1);
  assert.equal(controller.isScheduled(), true);
  controller.cancel();
  assert.equal(cleared, 1);
  assert.equal(controller.isScheduled(), false);

  controller.schedule();
  callback();
  assert.equal(dismissed, 1);
  assert.equal(controller.isScheduled(), false);
});
