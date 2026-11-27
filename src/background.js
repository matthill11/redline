'use strict';

importScripts('common.js');

const CACHE_MS = 60 * 1000;
const PUBLIC_PER_MINUTE = 12;
const cache = new Map();
const publicHits = [];
let statChain = Promise.resolve();

function slimMatch(match) {
  return {
    message: match.message || '',
    shortMessage: match.shortMessage || '',
    offset: match.offset,
    length: match.length,
    replacements: (match.replacements || []).slice(0, 8).map((item) => ({
      value: item.value,
      shortDescription: item.shortDescription || '',
    })),
    ruleId: (match.rule && match.rule.id) || '',
    issueType: (match.rule && match.rule.issueType) || '',
    categoryId: (match.rule && match.rule.category && match.rule.category.id) || '',
    sentence: match.sentence || '',
    ignoreForIncompleteSentence: !!match.ignoreForIncompleteSentence,
    context: match.context
      ? {
          text: match.context.text || '',
          offset: match.context.offset || 0,
          length: match.context.length || 0,
        }
      : null,
  };
}

function remember(key, matches) {
  cache.set(key, { at: Date.now(), matches });
  while (cache.size > 30) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

function publicSlot(endpoint) {
  if (!endpoint.startsWith('https://api.languagetool.org/')) return null;
  const now = Date.now();
  while (publicHits.length && now - publicHits[0] > 60000) publicHits.shift();
  if (publicHits.length >= PUBLIC_PER_MINUTE) {
    return 'The public LanguageTool server is rate-limited. Wait a minute, or set your own server in Options.';
  }
  publicHits.push(now);
  return null;
}

async function checkText(message) {
  if (typeof message.text !== 'string' || !message.text.trim()) return { ok: true, matches: [] };
  if (message.text.length > 20000) {
    return { ok: false, error: 'That field is too long to check in one pass.' };
  }
  const settings = await Redline.getSettings();
  const serverUrl = typeof message.serverUrl === 'string' ? message.serverUrl : settings.serverUrl;
  const language = message.language || settings.language || 'en-US';
  const picky = typeof message.picky === 'boolean' ? message.picky : settings.picky;
  let endpoint;
  try {
    endpoint = Redline.endpointFor(serverUrl);
  } catch (error) {
    return { ok: false, error: error.message };
  }

  const key = [endpoint, language, picky ? 'picky' : 'default', message.text].join('\n');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return { ok: true, matches: hit.matches, cached: true };
  }

  const limited = publicSlot(endpoint);
  if (limited) return { ok: false, error: limited };

  const body = new URLSearchParams();
  body.set('text', message.text);
  body.set('language', language);
  body.set('enabledOnly', 'false');
  body.set('level', picky ? 'picky' : 'default');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    const raw = await response.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      data = null;
    }
    if (!response.ok) {
      if (response.status === 429) {
        return {
          ok: false,
          error: 'LanguageTool rate limit reached. Wait a moment, or use a self-hosted server in Options.',
        };
      }
      const detail = (data && (data.message || data.error)) || 'LanguageTool returned ' + response.status;
      return { ok: false, error: detail };
    }
    if (!data || !Array.isArray(data.matches)) {
      return { ok: false, error: 'Unexpected response from LanguageTool.' };
    }
    const matches = data.matches.map(slimMatch);
    remember(key, matches);
    return { ok: true, matches };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return { ok: false, error: 'LanguageTool took too long to respond.' };
    }
    return {
      ok: false,
      error: 'Could not reach LanguageTool. Check the connection, or set a self-hosted server in Options.',
    };
  } finally {
    clearTimeout(timer);
  }
}

function bumpStats(message) {
  statChain = statChain.then(async () => {
    const settings = await Redline.getSettings();
    const stats = {
      checks: settings.stats.checks + (message.checks || 0),
      fixes: settings.stats.fixes + (message.fixes || 0),
    };
    await chrome.storage.local.set({ stats });
  });
  return statChain;
}

async function recordFrame(message, sender) {
  if (!sender.tab) return;
  const key = 'frame:' + sender.tab.id + ':' + sender.frameId;
  await chrome.storage.session.set({
    [key]: { issues: message.issues || 0, at: Date.now() },
  });
}

async function resetPageStats(tabId) {
  const all = await chrome.storage.session.get(null);
  const prefix = 'frame:' + tabId + ':';
  const stale = Object.keys(all).filter((key) => key.startsWith(prefix));
  if (stale.length) await chrome.storage.session.remove(stale);
}

async function pageStats(tabId) {
  const all = await chrome.storage.session.get(null);
  const prefix = 'frame:' + tabId + ':';
  const now = Date.now();
  let issues = 0;
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(prefix) || !value) continue;
    if (now - value.at > 15000) continue;
    issues += value.issues || 0;
  }
  return { issues };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'check') {
    checkText(message).then(sendResponse, (error) => {
      sendResponse({ ok: false, error: error.message || 'Check failed' });
    });
    return true;
  }
  if (message.type === 'stat') {
    bumpStats(message).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false })
    );
    return true;
  }
  if (message.type === 'frameStats') {
    recordFrame(message, sender).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false })
    );
    return true;
  }
  if (message.type === 'resetPageStats') {
    resetPageStats(message.tabId).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false })
    );
    return true;
  }
  if (message.type === 'pageStats') {
    pageStats(message.tabId).then(sendResponse, () => sendResponse({ issues: 0 }));
    return true;
  }
});
