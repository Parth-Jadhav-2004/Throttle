// ==========================================================================
// THROTTLE DESIGN SPECIMEN - CLIENT APP
// Pure Black & White Interactive Engine
// ==========================================================================

const PROVIDER_DATA = {
  claude: {
    id: 'claude',
    name: 'Claude',
    tag: 'CLD',
    roman: 'I. CLAUDE',
    pct: 78,
    reset: 'Resets in 4h 58m',
    submodels: [
      { name: 'Claude 3.7 Sonnet', pct: 78, reset: 'Resets in 4h 58m' },
      { name: 'Claude 3.5 Haiku', pct: 14, reset: 'Resets in 4h 58m' }
    ]
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    tag: 'CRS',
    roman: 'II. CURSOR',
    pct: 13,
    reset: 'Resets on Oct 1',
    submodels: [
      { name: 'Fast Requests (65/500)', pct: 13, reset: 'Resets on Oct 1' },
      { name: 'Composer Requests', pct: 40, reset: 'Resets on Oct 1' }
    ]
  },
  codex: {
    id: 'codex',
    name: 'Codex / OpenAI',
    tag: 'CDX',
    roman: 'III. CODEX',
    pct: 42,
    reset: 'Resets in 2h 15m',
    submodels: [
      { name: 'GPT-4o Quota', pct: 42, reset: 'Resets in 2h 15m' },
      { name: 'o3-mini Reasoning', pct: 18, reset: 'Resets in 2h 15m' }
    ]
  },
  antigravity: {
    id: 'antigravity',
    name: 'Antigravity',
    tag: 'AGV',
    roman: 'IV. ANTIGRAVITY',
    pct: 0,
    reset: 'Resets in 4h 58m',
    submodels: [
      { name: 'Gemini 2.5 Pro', pct: 0, reset: 'Resets in 4h 58m' },
      { name: 'Claude Opus 4.6 (Thinking)', pct: 0, reset: 'Resets in 4h 58m' }
    ]
  }
};

document.addEventListener('DOMContentLoaded', () => {
  initCardInteractions();
  initGlobalProviderSwitcher();
  initViewSwitcher();
  initThemeToggle();
  initModals();
});

// --------------------------------------------------------------------------
// CARD INTERACTIONS: SLOT SELECTION & FLYOUT TOGGLE
// --------------------------------------------------------------------------
function initCardInteractions() {
  document.querySelectorAll('.design-card').forEach((card) => {
    const cardId = card.dataset.designId;
    const flyout = card.querySelector('.mock-flyout');
    const toggleFlyoutBtn = card.querySelector('.btn-toggle-flyout');
    
    if (toggleFlyoutBtn && flyout) {
      toggleFlyoutBtn.addEventListener('click', () => {
        flyout.classList.toggle('hidden');
        toggleFlyoutBtn.textContent = flyout.classList.contains('hidden') ? 'Show Flyout' : 'Hide Flyout';
      });
    }

    // Provider slots within this dock
    const slots = card.querySelectorAll('[data-provider-target]');
    slots.forEach((slot) => {
      slot.addEventListener('click', () => {
        const providerKey = slot.dataset.providerTarget;
        slots.forEach(s => s.classList.remove('active'));
        slot.classList.add('active');

        // Update flyout contents if available
        if (flyout) {
          updateFlyoutContent(flyout, providerKey);
          flyout.classList.remove('hidden');
          if (toggleFlyoutBtn) toggleFlyoutBtn.textContent = 'Hide Flyout';
        }
      });
    });

    // For Design 09 (Accordion), handle expanding rows
    const accordionPanes = card.querySelectorAll('.accordion-pane');
    if (accordionPanes.length > 0) {
      accordionPanes.forEach((pane) => {
        pane.addEventListener('click', () => {
          const isExpanded = pane.classList.contains('expanded');
          accordionPanes.forEach(p => p.classList.remove('expanded'));
          if (!isExpanded) {
            pane.classList.add('expanded');
          }
        });
      });
    }
  });
}

function updateFlyoutContent(flyoutEl, providerKey) {
  const data = PROVIDER_DATA[providerKey] || PROVIDER_DATA.claude;
  const titleText = flyoutEl.querySelector('.flyout-title-text');
  const bodyEl = flyoutEl.querySelector('.flyout-body');

  if (titleText) {
    titleText.textContent = `${data.name} Usage`;
  }

  if (bodyEl) {
    let rowsHtml = '';
    data.submodels.forEach((sub) => {
      rowsHtml += `
        <div class="flyout-row">
          <div class="flyout-row-header">
            <span>${sub.name}</span>
            <span class="flyout-reset-timer">${sub.reset}</span>
          </div>
          <div class="flyout-bar-track">
            <div class="flyout-bar-fill" style="width: ${sub.pct}%;"></div>
          </div>
          <div class="flyout-pct-text">${sub.pct}% Used</div>
        </div>
      `;
    });
    bodyEl.innerHTML = rowsHtml;
  }
}

// --------------------------------------------------------------------------
// GLOBAL PROVIDER SWITCHER
// --------------------------------------------------------------------------
function initGlobalProviderSwitcher() {
  const btns = document.querySelectorAll('.provider-btn-group .btn');
  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const targetProvider = btn.dataset.provider;

      document.querySelectorAll('.design-card').forEach((card) => {
        const slot = card.querySelector(`[data-provider-target="${targetProvider}"]`);
        if (slot) {
          slot.click();
        }
      });
    });
  });
}

// --------------------------------------------------------------------------
// VIEW SWITCHER (Sheet vs Stack vs Compare vs Simulator)
// --------------------------------------------------------------------------
function initViewSwitcher() {
  const viewBtns = document.querySelectorAll('.view-btn-group .btn');
  const sheetContainer = document.getElementById('sheets-view');

  viewBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.view;
      viewBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (mode === 'sheet') {
        sheetContainer.classList.remove('stack-mode');
      } else if (mode === 'stack') {
        sheetContainer.classList.add('stack-mode');
      } else if (mode === 'simulator') {
        openSimulatorModal('01');
      } else if (mode === 'compare') {
        openCompareModal('01', '02');
      }
    });
  });
}

// --------------------------------------------------------------------------
// THEME TOGGLE (Paper Monochrome vs Inverted Console)
// --------------------------------------------------------------------------
function initThemeToggle() {
  const toggleBtn = document.getElementById('theme-toggle-btn');
  if (!toggleBtn) return;

  toggleBtn.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('theme-inverted');
    toggleBtn.textContent = isDark ? 'Mode: Night' : 'Mode: Paper';
  });
}

// --------------------------------------------------------------------------
// MODALS (QR Mobile Share, Simulator, Compare)
// --------------------------------------------------------------------------
function initModals() {
  // Mobile QR Modal
  const qrBtn = document.getElementById('btn-show-qr');
  const qrModal = document.getElementById('qr-modal');
  const closeQrBtn = document.getElementById('close-qr-modal');
  const copyBtn = document.getElementById('btn-copy-url');

  if (qrBtn && qrModal) {
    qrBtn.addEventListener('click', () => qrModal.classList.add('open'));
  }
  if (closeQrBtn && qrModal) {
    closeQrBtn.addEventListener('click', () => qrModal.classList.remove('open'));
  }

  // Copy button
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const urlText = document.getElementById('qr-target-url').textContent;
      navigator.clipboard.writeText(urlText).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy URL'; }, 2000);
      });
    });
  }

  // Close modals on background click or ESC
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.classList.remove('open');
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
    }
  });

  // Simulator Modal close
  const simModal = document.getElementById('simulator-modal');
  const closeSimBtn = document.getElementById('close-sim-modal');
  if (closeSimBtn && simModal) {
    closeSimBtn.addEventListener('click', () => simModal.classList.remove('open'));
  }

  // Compare Modal close
  const compModal = document.getElementById('compare-modal');
  const closeCompBtn = document.getElementById('close-comp-modal');
  if (closeCompBtn && compModal) {
    closeCompBtn.addEventListener('click', () => compModal.classList.remove('open'));
  }

  // Simulator selector
  const simSelect = document.getElementById('sim-design-select');
  if (simSelect) {
    simSelect.addEventListener('change', (e) => {
      renderSimulator(e.target.value);
    });
  }

  // Compare selectors
  const compA = document.getElementById('comp-design-a');
  const compB = document.getElementById('comp-design-b');
  if (compA && compB) {
    compA.addEventListener('change', renderCompare);
    compB.addEventListener('change', renderCompare);
  }
}

function openSimulatorModal(designId = '01') {
  const modal = document.getElementById('simulator-modal');
  const select = document.getElementById('sim-design-select');
  if (select) select.value = designId;
  renderSimulator(designId);
  if (modal) modal.classList.add('open');
}

function renderSimulator(designId) {
  const container = document.getElementById('sim-dock-container');
  const sourceCard = document.querySelector(`.design-card[data-design-id="${designId}"]`);
  if (!container || !sourceCard) return;

  const stageClone = sourceCard.querySelector('.mock-dock-stage').cloneNode(true);
  container.innerHTML = '';
  container.appendChild(stageClone);

  // Re-bind click handlers for the clone
  const slots = stageClone.querySelectorAll('[data-provider-target]');
  const flyout = stageClone.querySelector('.mock-flyout');
  slots.forEach((s) => {
    s.addEventListener('click', () => {
      slots.forEach(x => x.classList.remove('active'));
      s.classList.add('active');
      if (flyout) {
        updateFlyoutContent(flyout, s.dataset.providerTarget);
        flyout.classList.remove('hidden');
      }
    });
  });
}

function openCompareModal(idA = '01', idB = '02') {
  const modal = document.getElementById('compare-modal');
  const compA = document.getElementById('comp-design-a');
  const compB = document.getElementById('comp-design-b');
  if (compA) compA.value = idA;
  if (compB) compB.value = idB;
  renderCompare();
  if (modal) modal.classList.add('open');
}

function renderCompare() {
  const idA = document.getElementById('comp-design-a').value;
  const idB = document.getElementById('comp-design-b').value;
  const slotA = document.getElementById('compare-slot-a');
  const slotB = document.getElementById('compare-slot-b');

  const cardA = document.querySelector(`.design-card[data-design-id="${idA}"]`);
  const cardB = document.querySelector(`.design-card[data-design-id="${idB}"]`);

  if (slotA && cardA) {
    slotA.innerHTML = '';
    const cloneA = cardA.cloneNode(true);
    cloneA.querySelector('.card-actions').remove();
    slotA.appendChild(cloneA);
  }

  if (slotB && cardB) {
    slotB.innerHTML = '';
    const cloneB = cardB.cloneNode(true);
    cloneB.querySelector('.card-actions').remove();
    slotB.appendChild(cloneB);
  }
}
