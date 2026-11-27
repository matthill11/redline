'use strict';

const globalToggle = document.querySelector('#global-toggle');
const globalState = document.querySelector('#global-state');
const siteToggle = document.querySelector('#site-toggle');
const siteHost = document.querySelector('#site-host');
const language = document.querySelector('#language');
const notice = document.querySelector('#notice');
const statPage = document.querySelector('#stat-page');
const statFixes = document.querySelector('#stat-fixes');
const statChecks = document.querySelector('#stat-checks');

let currentHost = '';
let siteControllable = false;

function formatCount(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function messageTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      resolve(error ? null : response);
    });
  });
}

function runtimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      resolve(error ? null : response);
    });
  });
}

function fillLanguages(selected) {
  language.replaceChildren();
  const codes = new Set(Redline.LANGUAGES.map(([code]) => code));
  const list = Redline.LANGUAGES.slice();
  if (selected && !codes.has(selected)) list.push([selected, selected]);
  for (const [code, label] of list) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = label;
    option.selected = code === selected;
    language.append(option);
  }
}

function setSwitch(button, on) {
  button.setAttribute('aria-checked', on ? 'true' : 'false');
}

function showNotice(text) {
  if (!text) {
    notice.hidden = true;
    notice.textContent = '';
    return;
  }
  notice.hidden = false;
  notice.textContent = text;
}

async function pageIssueCount(tab) {
  if (!tab || !tab.id) return null;
  await runtimeMessage({ type: 'resetPageStats', tabId: tab.id });
  await messageTab(tab.id, { type: 'reportStats' });
  await new Promise((resolve) => setTimeout(resolve, 220));
  const stats = await runtimeMessage({ type: 'pageStats', tabId: tab.id });
  return stats && typeof stats.issues === 'number' ? stats.issues : null;
}

function isWebUrl(url) {
  return /^https?:|^file:/.test(url || '');
}

async function currentTab() {
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (current && isWebUrl(current.url)) return current;
  // Headless and some popup windows report the popup document as the current tab.
  const popupWindow = !current || !current.url || current.url === 'about:blank' || current.url.startsWith('chrome-extension:');
  if (popupWindow) {
    const tabs = await chrome.tabs.query({});
    const webs = tabs.filter((tab) => isWebUrl(tab.url));
    webs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    const web = webs.find((tab) => tab.active) || webs[0];
    if (web) return web;
  }
  return current || null;
}

async function render() {
  const settings = await Redline.getSettings();
  setSwitch(globalToggle, settings.enabled);
  globalState.textContent = settings.enabled ? 'On' : 'Off';
  fillLanguages(settings.language);
  statFixes.textContent = formatCount(settings.stats.fixes);
  statChecks.textContent = formatCount(settings.stats.checks);

  const tab = await currentTab();
  const url = tab && tab.url ? tab.url : '';
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch (error) {
    host = '';
  }
  currentHost = host;
  const webPage = /^https?:$/.test((() => { try { return new URL(url).protocol; } catch (e) { return ''; } })());
  siteControllable = webPage && !!host;
  if (!siteControllable) {
    siteHost.textContent = 'This page can’t be checked';
    siteToggle.disabled = true;
    setSwitch(siteToggle, false);
  } else {
    const disabled = settings.disabledSites.includes(host);
    siteHost.textContent = host;
    siteHost.title = host;
    siteToggle.disabled = !settings.enabled;
    setSwitch(siteToggle, settings.enabled && !disabled);
  }

  if (host === 'docs.google.com') {
    showNotice('Google Docs paints the document on a canvas, so Redline can’t underline it. Gmail compose and normal text fields still work.');
  } else if (url.startsWith('file:')) {
    showNotice('For a local file, open Redline’s details on chrome://extensions and turn on “Allow access to file URLs”, then reload the file.');
  } else if (webPage) {
    const ping = await messageTab(tab.id, { type: 'ping' });
    showNotice(ping ? '' : 'Reload this page to start checking. It was opened before Redline was installed.');
  } else {
    showNotice('');
  }

  if (webPage && tab) {
    statPage.textContent = '…';
    const issues = await pageIssueCount(tab);
    statPage.textContent = issues == null ? '—' : formatCount(issues);
  } else {
    statPage.textContent = '—';
  }
}

globalToggle.addEventListener('click', async () => {
  const settings = await Redline.getSettings();
  await chrome.storage.local.set({ enabled: !settings.enabled });
  render();
});

siteToggle.addEventListener('click', async () => {
  if (!siteControllable || siteToggle.disabled) return;
  const settings = await Redline.getSettings();
  const disabled = new Set(settings.disabledSites);
  if (disabled.has(currentHost)) disabled.delete(currentHost);
  else disabled.add(currentHost);
  await chrome.storage.local.set({ disabledSites: [...disabled] });
  render();
});

language.addEventListener('change', async () => {
  await chrome.storage.local.set({ language: language.value });
});

document.querySelector('#options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.stats || changes.dictionary)) {
    Redline.getSettings().then((settings) => {
      statFixes.textContent = formatCount(settings.stats.fixes);
      statChecks.textContent = formatCount(settings.stats.checks);
    });
  }
});

render();
