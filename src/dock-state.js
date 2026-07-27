class DockTransitionTracker {
  constructor() {
    this.state = 'hidden';
    this.generation = 0;
  }

  begin(state) {
    this.state = state;
    this.generation += 1;
    return this.generation;
  }

  complete(finalState, generation) {
    if (generation !== this.generation) return false;
    const expected = this.state === 'showing' ? 'visible' :
      this.state === 'hiding' ? 'hidden' : null;
    if (finalState !== expected) return false;
    this.state = finalState;
    return true;
  }
}

function createDismissalController({
  delay = 250,
  onDismiss,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  let timer = null;
  return {
    schedule() {
      if (timer) return;
      timer = setTimer(() => {
        timer = null;
        onDismiss();
      }, delay);
    },
    cancel() {
      if (!timer) return;
      clearTimer(timer);
      timer = null;
    },
    isScheduled() {
      return timer !== null;
    }
  };
}

module.exports = { DockTransitionTracker, createDismissalController };
