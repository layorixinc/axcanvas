const TOOL_LABELS = {
  select: 'Select objects · Shift+click to add to selection',
  hand: 'Drag to pan the canvas',
  node: 'Click the canvas to place a node',
  connect: 'Choose a source, then a target',
  draw: 'Draw an instruction in this scope',
  erase: 'Drag over drawing strokes to erase them',
};
const COMMAND_ICONS = {
  'align-left': 'M4 3v18M8 6h12v4H8zm0 8h8v4H8z',
  'align-top': 'M3 4h18M6 8h4v12H6zm8 0h4v8h-4z',
  'distribute-horizontal': 'M3 3v18M21 3v18M9 6h6v12H9zM3 12h6m6 0h6',
  'distribute-vertical': 'M3 3h18M3 21h18M6 9h12v6H6zM12 3v6m0 6v6',
  'duplicate-selection': 'M8 8h13v13H8zM16 8V3H3v13h5',
  'copy-selection': 'M8 8h12v13H8zM15 8V3H3v13h5',
  'paste-selection': 'M8 5H4v16h16V5h-4M8 3h8v5H8z',
  'retire-selection': 'M3 5h18v4H3zm2 4v12h14V9M9 13h6',
};

/** UI-only shell. The editor owns graph state, tool acceptance and canvas shortcuts. */
export function initWorkspace(callbacks = {}) {
  const byId = id => document.getElementById(id);
  const main = byId('workspace-main');
  const drawer = byId('inspector-drawer');
  const inspectorToggle = byId('inspector-toggle');
  const toolbox = byId('toolbox');
  const toolButtons = [...toolbox.querySelectorAll('[data-tool]')];
  const tabs = ['properties', 'agent', 'history'];
  const narrow = window.matchMedia('(max-width: 850px)');
  let tool = 'select';
  let placementKind = 'concept';
  const clearInk = byId('clear-ink'), clearInkHome = clearInk.parentElement;
  let activeTab = 'properties';
  let openMenu = null;
  let saveError = '';
  let saveState = 'No draft';
  let selectionCount = 0;
  const menus = [
    ['file-toggle', 'file-menu'], ['scope-menu-toggle', 'scope-menu'],
    ['arrange-toggle', 'arrange-menu'], ['view-toggle', 'view-menu'],
    ['draw-menu-toggle', 'draw-menu'], ['details-toggle', 'details-menu'],
    ['connection-toggle', 'connection-menu'],
  ].map(([button, panel]) => ({ button: byId(button), panel: byId(panel) }));

  byId('copy-link').addEventListener('click', async () => {
    const status = byId('copy-link-status');
    try {
      await navigator.clipboard.writeText(window.location.href);
      status.textContent = 'Canvas link copied.';
    } catch {
      status.textContent = 'Could not copy. Copy the link from your address bar.';
    }
  });

  function closeMenu(restoreFocus = false) {
    if (!openMenu) return;
    const previous = openMenu;
    openMenu = null;
    previous.panel.hidden = true;
    previous.button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) previous.button.focus();
  }

  function positionMenu(menu) {
    const anchor = menu.button.getBoundingClientRect();
    const panel = menu.panel;
    const width = panel.getBoundingClientRect().width;
    panel.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`;
    if (menu.button.closest('#workspace-status')) {
      panel.style.top = 'auto';
      panel.style.bottom = `${window.innerHeight - anchor.top + 6}px`;
    } else {
      panel.style.bottom = 'auto';
      panel.style.top = `${anchor.bottom + 6}px`;
    }
  }

  for (const menu of menus) {
    menu.button.addEventListener('click', () => {
      const wasOpen = openMenu === menu;
      closeMenu();
      if (wasOpen) return;
      openMenu = menu;
      menu.panel.hidden = false;
      menu.button.setAttribute('aria-expanded', 'true');
      positionMenu(menu);
    });
    menu.panel.addEventListener('click', event => {
      if (event.target.closest('#copy-link')) return;
      if (event.target.closest('button, a')) closeMenu();
    });
    menu.button.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.isComposing && openMenu === menu) {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
        return;
      }
      if (event.key !== 'ArrowDown' || event.isComposing) return;
      event.preventDefault();
      closeMenu();
      openMenu = menu;
      menu.panel.hidden = false;
      menu.button.setAttribute('aria-expanded', 'true');
      positionMenu(menu);
      menu.panel.querySelector('button:not(:disabled), input, select, a, summary')?.focus();
    });
    menu.panel.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    });
  }
  document.addEventListener('pointerdown', event => {
    if (openMenu && !openMenu.panel.contains(event.target) && !openMenu.button.contains(event.target)) closeMenu();
  });
  document.addEventListener('focusin', event => {
    if (openMenu && !openMenu.panel.contains(event.target) && !openMenu.button.contains(event.target)) closeMenu();
  });
  window.addEventListener('resize', () => { if (openMenu) positionMenu(openMenu); });

  function setInspector(open, restoreFocus = false) {
    drawer.hidden = !open;
    main.classList.toggle('inspector-collapsed', !open);
    inspectorToggle.setAttribute('aria-expanded', String(open));
    if (!open && (restoreFocus || drawer.contains(document.activeElement))) inspectorToggle.focus();
  }
  function showPanel(tab = 'properties') {
    if (!tabs.includes(tab)) return;
    activeTab = tab;
    for (const name of tabs) {
      const selected = name === tab;
      byId(`tab-${name}`).setAttribute('aria-selected', String(selected));
      byId(`tab-${name}`).tabIndex = selected ? 0 : -1;
      byId(`panel-${name}`).hidden = !selected;
    }
    setInspector(true);
  }
  function selectPanel(tab) {
    showPanel(tab);
    callbacks.onPanel?.(tab);
  }
  inspectorToggle.addEventListener('click', () => {
    if (drawer.hidden) selectPanel(activeTab);
    else setInspector(false, true);
  });
  byId('inspector-close').addEventListener('click', () => setInspector(false, true));
  for (const [index, tab] of tabs.entries()) {
    const button = byId(`tab-${tab}`);
    button.addEventListener('click', () => selectPanel(tab));
    button.addEventListener('keydown', event => {
      if (event.isComposing) return;
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      event.stopPropagation();
      selectPanel(tabs[next]);
      byId(`tab-${tabs[next]}`).focus();
    });
  }
  function updateResponsiveChrome() {
    toolbox.setAttribute('aria-orientation', narrow.matches ? 'horizontal' : 'vertical');
    if (narrow.matches) setInspector(false);
  }
  narrow.addEventListener('change', updateResponsiveChrome);
  updateResponsiveChrome();

  function renderToolOptions() {
    closeMenu(); byId('draw-menu-toggle').hidden = tool === 'draw' || tool === 'erase';
    if (clearInk.parentElement !== clearInkHome) clearInkHome.append(clearInk);
    const host = byId('tool-options'); host.replaceChildren();
    if (tool === 'node') {
      const label = document.createElement('label'); label.textContent = 'Type ';
      const select = document.createElement('select'); select.id = 'placement-kind'; select.setAttribute('aria-label', 'New node type');
      for (const kind of ['concept','claim','decision','question','task']) {
        const option = document.createElement('option'); option.value = kind; option.textContent = kind[0].toUpperCase() + kind.slice(1); select.append(option);
      }
      select.value = placementKind;
      select.addEventListener('change', () => { placementKind = select.value; callbacks.onCommand?.(`node-kind:${placementKind}`); });
      label.append(select); host.append(label);
    } else if (tool === 'connect') {
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel connection'; cancel.addEventListener('click', () => callbacks.onCommand?.('cancel-tool')); host.append(cancel);
    } else if (tool === 'draw' || tool === 'erase') host.append(clearInk);
  }
  function setTool(nextTool) {
    if (!Object.hasOwn(TOOL_LABELS, nextTool)) return;
    tool = nextTool;
    main.dataset.tool = tool;
    for (const button of toolButtons) {
      const selected = button.dataset.tool === tool;
      button.setAttribute('aria-pressed', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    renderToolOptions();
    byId('tool-hint').textContent = TOOL_LABELS[tool];
  }
  for (const [index, button] of toolButtons.entries()) {
    button.addEventListener('click', () => {
      if (callbacks.onTool) callbacks.onTool(button.dataset.tool);
      else setTool(button.dataset.tool);
    });
    button.addEventListener('keydown', event => {
      if (event.isComposing) return;
      let next;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % toolButtons.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + toolButtons.length - 1) % toolButtons.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = toolButtons.length - 1;
      else return;
      event.preventDefault();
      event.stopPropagation();
      toolButtons[next].focus();
    });
  }
  for (const [command, pathData] of Object.entries(COMMAND_ICONS)) {
    const button = byId(command);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    svg.append(path);
    button.prepend(svg);
    button.title = button.textContent.trim();
    button.addEventListener('click', () => callbacks.onCommand?.(command));
  }

  function refresh(state = {}) {
    if (state.selectionCount !== undefined || state.hasSelection !== undefined) {
      selectionCount = state.selectionCount ?? (state.hasSelection ? 1 : 0);
      byId('selection-summary').textContent = selectionCount ? `${selectionCount} selected` : 'No selection';
      byId('selection-tools').classList.toggle('no-selection', !selectionCount);
      for (const command of Object.keys(COMMAND_ICONS)) {
        if (command === 'paste-selection') continue;
        const minimum = command.startsWith('distribute-') ? 3 : command.startsWith('align-') ? 2 : 1;
        byId(command).disabled = selectionCount < minimum;
      }
    }
    if (state.toolHint !== undefined) byId('tool-hint').textContent = state.toolHint;
    if (state.saveState !== undefined) saveState = state.saveState || 'No draft';
    if (state.saveError !== undefined) saveError = state.saveError ? String(state.saveError) : '';
    if (state.saveState !== undefined || state.saveError !== undefined) {
      const status = byId('save-state');
      status.textContent = saveError || saveState;
      status.title = saveError || saveState;
      status.dataset.error = String(Boolean(saveError));
    }
    if (state.connectionState !== undefined) {
      byId('agent-state').textContent = state.connectionState;
      byId('connection-toggle').title = state.connectionState;
    }
    if (Number.isFinite(state.zoomPercent)) byId('zoom-value').textContent = `${Math.round(state.zoomPercent)}%`;
    if (state.conflict !== undefined) {
      byId('workspace-conflict').hidden = !state.conflict;
      byId('conflict-message').textContent = typeof state.conflict === 'string' ? state.conflict : 'The canonical graph changed. Inspect latest to merge your draft.';
    }
  }
  setTool('select');
  refresh({ selectionCount: 0 });
  return { setTool, getTool: () => tool, showPanel, refresh };
}
