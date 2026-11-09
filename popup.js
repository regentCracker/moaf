const idsField = document.getElementById('studentIds');
const weekField = document.getElementById('weekIndex');
const previewButton = document.getElementById('previewButton');
const fillButton = document.getElementById('fillButton');
const resultsSection = document.getElementById('results');
const resultsTitle = document.getElementById('resultsTitle');
const summary = document.getElementById('summary');
const resultList = document.getElementById('resultList');

let lastPreview = null;

function parseIds(raw) {
  return [...new Set(raw.split(/[\s,;]+/).map(value => value.trim()).filter(Boolean))];
}

function showResults(title, data) {
  resultsTitle.textContent = title;
  summary.textContent = data.summary;
  resultList.replaceChildren();

  for (const item of data.items) {
    const li = document.createElement('li');
    li.className = item.status === 'ready' || item.status === 'filled' || item.status === 'already-one'
      ? 'ok'
      : (item.status === 'missing-id-cell' ? 'bad' : 'warn');
    li.textContent = `${item.id}: ${item.message}`;
    resultList.appendChild(li);
  }
  resultsSection.hidden = false;
}

async function runOnActiveTab(mode) {
  const ids = parseIds(idsField.value);
  const weekIndex = Number(weekField.value);

  if (ids.length === 0) {
    showResults('Nothing to do', { summary: 'Paste at least one student ID.', items: [] });
    fillButton.disabled = true;
    lastPreview = null;
    return;
  }
  if (!Number.isInteger(weekIndex) || weekIndex < 0) {
    showResults('Invalid week index', { summary: 'Week index must be a non-negative integer.', items: [] });
    fillButton.disabled = true;
    lastPreview = null;
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || '')) {
    showResults('Cannot access this tab', { summary: 'Open the Moodle page in a normal browser tab, then try again.', items: [] });
    fillButton.disabled = true;
    lastPreview = null;
    return;
  }

  try {
    const execution = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: inspectOrFillAttendance,
      args: [ids, weekIndex, mode]
    });
    const data = execution?.[0]?.result;
    if (!data) throw new Error('The page did not return a result.');
    showResults(mode === 'preview' ? 'Preview' : 'Fill results', data);

    if (mode === 'preview') {
      lastPreview = { tabId: tab.id, ids, weekIndex };
      fillButton.disabled = !data.items.some(item => item.status === 'ready');
    } else {
      lastPreview = null;
      fillButton.disabled = true;
    }
  } catch (error) {
    showResults('Could not run on this page', {
      summary: error?.message || String(error),
      items: []
    });
    fillButton.disabled = true;
    lastPreview = null;
  }
}

// This function is injected into the active Moodle tab. Keep it self-contained:
// Chrome serializes it before executing it in the page.
function inspectOrFillAttendance(ids, weekIndex, mode) {
  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const allTds = Array.from(document.querySelectorAll('td'));

  function findIdCell(id) {
    const matching = allTds.filter(td => normalize(td.textContent).includes(id));
    if (matching.length === 0) return { cell: null, reason: 'No table cell contains this ID.' };

    // If a cell contains a nested table, prefer the deepest matching cell.
    const deepest = matching.filter(td => {
      return !Array.from(td.querySelectorAll('td')).some(child => normalize(child.textContent).includes(id));
    });
    const candidates = deepest.length ? deepest : matching;
    if (candidates.length !== 1) {
      return { cell: null, reason: `Found ${candidates.length} matching table cells; not changing anything for this ID.` };
    }
    return { cell: candidates[0], reason: '' };
  }

  function findInput(cell) {
    const excludedTypes = new Set(['hidden', 'button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file']);
    const candidates = Array.from(cell.querySelectorAll('input')).filter(input => {
      return !excludedTypes.has((input.type || 'text').toLowerCase()) &&
        !input.disabled && !input.readOnly && input.getClientRects().length > 0;
    });
    if (candidates.length === 0) return { input: null, reason: 'No visible, editable input found in the target cell.' };
    if (candidates.length > 1) return { input: null, reason: `Found ${candidates.length} editable inputs in the target cell; not guessing.` };
    return { input: candidates[0], reason: '' };
  }

  const items = ids.map(id => {
    const found = findIdCell(id);
    if (!found.cell) return { id, status: 'missing-id-cell', message: found.reason };

    const row = found.cell.closest('tr');
    if (!row) return { id, status: 'no-row', message: 'The matching cell is not inside a table row.' };

    // Count TD elements in this row only. Divs/spans inside a TD do not affect the count.
    const rowTds = Array.from(row.children).filter(element => element.tagName === 'TD');
    const sourceIndex = rowTds.indexOf(found.cell);
    if (sourceIndex < 0) return { id, status: 'no-row-cell', message: 'Could not identify the ID cell among its row cells.' };

    const targetIndex = sourceIndex + weekIndex + 1;
    const targetCell = rowTds[targetIndex];
    if (!targetCell) {
      return { id, status: 'out-of-range', message: `The requested cell (offset ${weekIndex + 1}) is outside this row.` };
    }

    const locatedInput = findInput(targetCell);
    if (!locatedInput.input) return { id, status: 'no-input', message: locatedInput.reason };

    const input = locatedInput.input;
    const currentValue = input.value;
    const cellNumber = targetIndex + 1;
    if (mode === 'preview') {
      return {
        id,
        status: currentValue === '1' ? 'already-one' : 'ready',
        message: `row cell ${cellNumber}; current value: ${JSON.stringify(currentValue)}${currentValue === '1' ? ' (already 1)' : ''}.`
      };
    }

    if (currentValue !== '1') {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(input, '1');
      else input.value = '1';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.blur();
    }
    return {
      id,
      status: currentValue === '1' ? 'already-one' : 'filled',
      message: currentValue === '1' ? `row cell ${cellNumber} was already 1.` : `set input in row cell ${cellNumber} to 1.`
    };
  });

  const counts = items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  const changed = counts.filled || 0;
  const ready = counts.ready || 0;
  const already = counts['already-one'] || 0;
  const problems = items.length - changed - ready - already;
  const summary = mode === 'preview'
    ? `${ready} ready to fill, ${already} already set to 1, ${problems} issue(s). No values changed.`
    : `${changed} input(s) changed to 1, ${already} already set to 1, ${problems} issue(s). The page was not submitted.`;

  return { summary, items };
}

previewButton.addEventListener('click', () => runOnActiveTab('preview'));
fillButton.addEventListener('click', async () => {
  if (!lastPreview) return;
  const currentIds = parseIds(idsField.value);
  const currentWeek = Number(weekField.value);
  if (lastPreview.weekIndex !== currentWeek || JSON.stringify(lastPreview.ids) !== JSON.stringify(currentIds)) {
    showResults('Preview is out of date', { summary: 'Run Preview again after changing the IDs or week index.', items: [] });
    fillButton.disabled = true;
    lastPreview = null;
    return;
  }
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab?.id !== lastPreview.tabId) {
    showResults('Active tab changed', { summary: 'Return to the Moodle tab where you ran Preview, then preview again.', items: [] });
    fillButton.disabled = true;
    lastPreview = null;
    return;
  }
  await runOnActiveTab('fill');
});

idsField.addEventListener('input', () => { fillButton.disabled = true; lastPreview = null; });
weekField.addEventListener('input', () => { fillButton.disabled = true; lastPreview = null; });
