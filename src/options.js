'use strict';

const serverInput = document.querySelector('#server');
const pickyInput = document.querySelector('#picky');
const serverResult = document.querySelector('#server-result');
const dictWord = document.querySelector('#dict-word');
const dictError = document.querySelector('#dict-error');
const dictList = document.querySelector('#dict-list');
const ignoredList = document.querySelector('#ignored-list');
const statChecks = document.querySelector('#stat-checks');
const statFixes = document.querySelector('#stat-fixes');
const statWords = document.querySelector('#stat-words');

function setResult(text, kind) {
  serverResult.textContent = text || '';
  serverResult.className = 'result' + (kind ? ' ' + kind : '');
}

function renderDictionary(words) {
  dictList.replaceChildren();
  if (!words.length) {
    dictList.append(Object.assign(document.createElement('p'), {
      className: 'help',
      textContent: 'No saved words yet.',
    }));
    return;
  }
  for (const word of words) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.append(document.createTextNode(word));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Remove ' + word);
    remove.addEventListener('click', async () => {
      const settings = await Redline.getSettings();
      await chrome.storage.local.set({
        dictionary: settings.dictionary.filter((item) => item !== word),
      });
    });
    chip.append(remove);
    dictList.append(chip);
  }
}

function renderIgnored(items) {
  ignoredList.replaceChildren();
  if (!items.length) {
    ignoredList.append(Object.assign(document.createElement('p'), {
      className: 'help',
      textContent: 'Nothing ignored yet. Use Ignore on an underline to hide that suggestion.',
    }));
    return;
  }
  items.forEach((item, index) => {
    const row = document.createElement('span');
    row.className = 'ignored-item';
    const label = document.createElement('span');
    label.append(document.createTextNode(item.text || 'issue'));
    const small = document.createElement('small');
    small.textContent = item.ruleId || 'rule';
    label.append(small);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Stop ignoring ' + (item.text || 'issue'));
    remove.addEventListener('click', async () => {
      const settings = await Redline.getSettings();
      const next = settings.ignored.filter((_, itemIndex) => itemIndex !== index);
      await chrome.storage.local.set({ ignored: next });
    });
    row.append(label, remove);
    ignoredList.append(row);
  });
}

async function render() {
  const settings = await Redline.getSettings();
  serverInput.value = settings.serverUrl;
  pickyInput.checked = settings.picky;
  renderDictionary(settings.dictionary);
  renderIgnored(settings.ignored);
  statChecks.textContent = String(settings.stats.checks);
  statFixes.textContent = String(settings.stats.fixes);
  statWords.textContent = String(settings.dictionary.length);
}

document.querySelector('#save-server').addEventListener('click', async () => {
  const serverUrl = serverInput.value.trim();
  try {
    if (serverUrl) Redline.endpointFor(serverUrl);
  } catch (error) {
    setResult(error.message, 'bad');
    return;
  }
  await chrome.storage.local.set({ serverUrl, picky: pickyInput.checked });
  setResult(serverUrl ? 'Saved. Checks will use your server.' : 'Saved. Checks will use the public LanguageTool server.', 'ok');
});

pickyInput.addEventListener('change', async () => {
  await chrome.storage.local.set({ picky: pickyInput.checked });
});

document.querySelector('#clear-server').addEventListener('click', async () => {
  serverInput.value = '';
  await chrome.storage.local.set({ serverUrl: '' });
  setResult('Using the public LanguageTool server.', 'ok');
});

document.querySelector('#test-server').addEventListener('click', async () => {
  const button = document.querySelector('#test-server');
  button.disabled = true;
  setResult('Contacting the server…', '');
  const response = await new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'check',
      text: 'This is an test.',
      language: 'en-US',
      serverUrl: serverInput.value.trim(),
      picky: false,
    }, (result) => {
      const error = chrome.runtime.lastError;
      resolve(error ? { ok: false, error: error.message } : result);
    });
  });
  button.disabled = false;
  if (!response || !response.ok) {
    setResult((response && response.error) || 'No response.', 'bad');
    return;
  }
  const count = (response.matches || []).length;
  setResult('Server responded and found ' + count + (count === 1 ? ' issue' : ' issues') + ' in the sample sentence.', 'ok');
});

document.querySelector('#dict-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const settings = await Redline.getSettings();
  const result = Redline.addDictionaryWord(settings.dictionary, dictWord.value);
  dictError.textContent = result.added ? '' : (result.error || '');
  if (!result.added) return;
  await chrome.storage.local.set({ dictionary: result.list });
  dictWord.value = '';
});

document.querySelector('#clear-ignored').addEventListener('click', async () => {
  await chrome.storage.local.set({ ignored: [] });
});

document.querySelector('#reset-stats').addEventListener('click', async () => {
  await chrome.storage.local.set({ stats: { checks: 0, fixes: 0 } });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') render();
});

render();
