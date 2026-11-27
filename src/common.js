'use strict';

/*
 * Shared helpers for the service worker, popup, options page, and content script.
 * Also loadable from Node (module.exports) for unit tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Redline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PUBLIC_ENDPOINT = 'https://api.languagetool.org/v2/check';
  const MAX_TEXT = 18000;

  const DEFAULTS = {
    enabled: true,
    language: 'en-US',
    serverUrl: '',
    picky: true,
    disabledSites: [],
    dictionary: [],
    ignored: [],
    stats: { checks: 0, fixes: 0 },
  };

  const LANGUAGES = [
    ['en-US', 'English (US)'],
    ['en-GB', 'English (UK)'],
    ['en-AU', 'English (Australia)'],
    ['en-CA', 'English (Canada)'],
    ['en-NZ', 'English (New Zealand)'],
    ['en-ZA', 'English (South Africa)'],
    ['de-DE', 'German'],
    ['de-AT', 'German (Austria)'],
    ['de-CH', 'German (Switzerland)'],
    ['fr', 'French'],
    ['es', 'Spanish'],
    ['pt-BR', 'Portuguese (Brazil)'],
    ['pt-PT', 'Portuguese (Portugal)'],
    ['it', 'Italian'],
    ['nl', 'Dutch'],
    ['pl-PL', 'Polish'],
    ['ru-RU', 'Russian'],
    ['uk-UA', 'Ukrainian'],
    ['sv', 'Swedish'],
    ['da-DK', 'Danish'],
    ['nb', 'Norwegian'],
    ['ro-RO', 'Romanian'],
    ['el-GR', 'Greek'],
    ['ca-ES', 'Catalan'],
    ['ja-JP', 'Japanese'],
    ['zh-CN', 'Chinese'],
    ['auto', 'Detect language'],
  ];

  const CATEGORY_LABEL = {
    spelling: 'Spelling',
    grammar: 'Grammar',
    style: 'Style',
  };

  function endpointFor(serverUrl) {
    if (serverUrl == null || !String(serverUrl).trim()) return PUBLIC_ENDPOINT;
    let url = String(serverUrl).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('Server URL must start with http:// or https://');
    }
    if (/\/v2\/check$/i.test(url)) return url;
    return url + '/v2/check';
  }

  function categorize(match) {
    const issue = String(match.issueType || '').toLowerCase();
    const cat = String(match.categoryId || '').toUpperCase();
    if (cat === 'CONFUSED_WORDS') return 'grammar';
    if (cat === 'TYPOS' || issue === 'misspelling') return 'spelling';
    if (
      issue === 'style' ||
      issue === 'locale-violation' ||
      issue === 'register' ||
      cat === 'STYLE' ||
      cat === 'REDUNDANCY' ||
      cat === 'REPETITIONS_STYLE' ||
      cat === 'PLAIN_ENGLISH' ||
      cat === 'CREATIVE_WRITING' ||
      cat === 'COLLOQUIALISMS' ||
      cat === 'WIKIPEDIA'
    ) {
      return 'style';
    }
    if (issue === 'typographical' || cat === 'TYPOGRAPHY' || cat === 'PUNCTUATION' || cat === 'CASING') {
      return 'style';
    }
    return 'grammar';
  }

  function categoryLabel(category) {
    return CATEGORY_LABEL[category] || 'Grammar';
  }

  function normalizeWord(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^[^\p{L}\p{N}'’-]+|[^\p{L}\p{N}'’-]+$/gu, '');
  }

  function isAllowedInputType(type) {
    const name = String(type || 'text').toLowerCase();
    return name === 'text' || name === 'search' || name === 'email' || name === 'url';
  }

  function isSensitiveMeta(meta) {
    const type = String(meta.type || '').toLowerCase();
    if (type === 'password' || type === 'hidden') return true;
    const autocomplete = String(meta.autocomplete || '').toLowerCase();
    if (
      /(^|[\s-])(current-password|new-password|one-time-code|cc-name|cc-given-name|cc-additional-name|cc-family-name|cc-number|cc-exp|cc-exp-month|cc-exp-year|cc-csc|cc-type|transaction-amount|transaction-currency)([\s-]|$)/.test(
        autocomplete
      ) ||
      /\bcc-/.test(autocomplete)
    ) {
      return true;
    }
    const hint = [meta.name, meta.id, meta.placeholder, meta.ariaLabel]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return /password|passwd|credit[\s_-]?card|card[\s_-]?number|cc[\s_-]?number|\bcvv\b|\bcvc\b|\bcsc\b|\bssn\b|social[\s_-]?security|tax[\s_-]?id|routing[\s_-]?number|account[\s_-]?number|security[\s_-]?code|\botp\b|\bpin\b/.test(
      hint
    );
  }

  function dropOverlaps(matches) {
    const sorted = matches.slice().sort((a, b) => a.offset - b.offset || b.length - a.length);
    const kept = [];
    let end = -1;
    for (const match of sorted) {
      if (match.offset < end) continue;
      kept.push(match);
      end = match.offset + match.length;
    }
    return kept;
  }

  function sentenceLooksComplete(sentence) {
    return /[.!?…]['"”’)\]]*\s*$/.test(sentence || '');
  }

  function filterMatches(matches, text, settings) {
    const dictionary = new Set((settings.dictionary || []).map((word) => String(word).toLowerCase()));
    const ignored = new Set((settings.ignored || []).map((item) => (item.ruleId || '') + '\n' + (item.text || '')));
    const visible = [];
    for (const match of matches || []) {
      if (!match || typeof match.offset !== 'number' || typeof match.length !== 'number') continue;
      if (match.offset < 0 || match.length <= 0 || match.offset + match.length > text.length) continue;
      const raw = text.slice(match.offset, match.offset + match.length);
      if (!/[\p{L}\p{N}]/u.test(raw)) continue;
      if (match.ignoreForIncompleteSentence && !sentenceLooksComplete(match.sentence)) continue;
      const word = normalizeWord(raw);
      if (word && dictionary.has(word)) continue;
      const key = (match.ruleId || '') + '\n' + (word || raw.trim().toLowerCase());
      if (ignored.has(key)) continue;
      visible.push(match);
    }
    return dropOverlaps(visible);
  }

  function firstReplacement(match) {
    const list = match && match.replacements;
    if (!list || !list.length || list[0].value == null) return null;
    return list[0].value;
  }

  function applyReplacements(text, matches) {
    const usable = dropOverlaps(matches || []).filter((match) => {
      const replacement = firstReplacement(match);
      if (replacement == null) return false;
      return text.slice(match.offset, match.offset + match.length) !== replacement;
    });
    const ordered = usable.slice().sort((a, b) => b.offset - a.offset);
    let next = text;
    for (const match of ordered) {
      const replacement = firstReplacement(match);
      next = next.slice(0, match.offset) + replacement + next.slice(match.offset + match.length);
    }
    return { text: next, count: ordered.length };
  }

  function sliceForCheck(text, caret, max) {
    const limit = max || MAX_TEXT;
    if (text.length <= limit) return { text, offset: 0 };
    const focus = Math.max(0, Math.min(text.length, caret || 0));
    let start = Math.max(0, focus - Math.floor(limit / 2));
    let end = Math.min(text.length, start + limit);
    if (end - start < limit) start = Math.max(0, end - limit);
    if (start > 0) {
      const window = text.slice(start, Math.min(text.length, start + 200));
      const newline = window.indexOf('\n');
      const sentence = window.search(/[.!?]\s/);
      const cut = newline === -1 ? sentence : sentence === -1 ? newline : Math.min(newline, sentence);
      if (cut !== -1 && cut < 180) start += cut + 1;
      else {
        const space = text.indexOf(' ', start);
        if (space !== -1 && space < start + 80) start = space + 1;
      }
    }
    if (end < text.length) {
      const space = text.lastIndexOf(' ', end);
      if (space > start + 100) end = space;
    }
    return { text: text.slice(start, end), offset: start };
  }

  function addDictionaryWord(list, word) {
    const cleaned = normalizeWord(word);
    if (!cleaned) return { list: list || [], added: false, error: 'Enter a word' };
    if (cleaned.length > 80) return { list: list || [], added: false, error: 'That word is too long' };
    const next = Array.isArray(list) ? list.slice() : [];
    if (next.some((item) => String(item).toLowerCase() === cleaned)) {
      return { list: next, added: false, error: 'Already in the dictionary' };
    }
    next.push(cleaned);
    return { list: next.slice(-2000), added: true, word: cleaned };
  }

  function addIgnored(list, match, fullText) {
    const raw = fullText.slice(match.offset, match.offset + match.length);
    const text = normalizeWord(raw) || raw.trim().toLowerCase();
    if (!text) return Array.isArray(list) ? list : [];
    const entry = { ruleId: match.ruleId || '', text };
    const next = (Array.isArray(list) ? list : []).filter(
      (item) => item && (item.ruleId !== entry.ruleId || item.text !== entry.text)
    );
    next.push(entry);
    return next.slice(-500);
  }

  async function getSettings() {
    const stored = await chrome.storage.local.get(null);
    return {
      enabled: stored.enabled !== false,
      language: stored.language || DEFAULTS.language,
      serverUrl: typeof stored.serverUrl === 'string' ? stored.serverUrl : '',
      picky: stored.picky !== false,
      disabledSites: Array.isArray(stored.disabledSites) ? stored.disabledSites : [],
      dictionary: Array.isArray(stored.dictionary) ? stored.dictionary : [],
      ignored: Array.isArray(stored.ignored) ? stored.ignored : [],
      stats: {
        checks: stored.stats && stored.stats.checks ? stored.stats.checks : 0,
        fixes: stored.stats && stored.stats.fixes ? stored.stats.fixes : 0,
      },
    };
  }

  return {
    PUBLIC_ENDPOINT,
    MAX_TEXT,
    DEFAULTS,
    LANGUAGES,
    CATEGORY_LABEL,
    endpointFor,
    categorize,
    categoryLabel,
    normalizeWord,
    isAllowedInputType,
    isSensitiveMeta,
    dropOverlaps,
    filterMatches,
    firstReplacement,
    applyReplacements,
    sliceForCheck,
    addDictionaryWord,
    addIgnored,
    getSettings,
  };
});
