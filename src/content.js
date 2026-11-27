'use strict';

/*
 * Underlines spelling and grammar in the focused field.
 * Plain inputs use a measured overlay. Contenteditable editors use the CSS Highlight API.
 * Google Docs is skipped: its document is painted on a canvas, not in the DOM.
 */

(function () {
  if (globalThis.__REDLINE__) return;
  globalThis.__REDLINE__ = true;

  if (location.hostname === 'docs.google.com') {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message) return;
      if (message.type === 'ping') sendResponse({ ok: true, docs: true });
      if (message.type === 'reportStats') sendResponse({ ok: true });
    });
    return;
  }

  const DEBOUNCE_MS = 700;
  const BLOCK = new Set([
    'DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'BLOCKQUOTE', 'PRE',
    'SECTION', 'ARTICLE', 'UL', 'OL', 'TABLE', 'HEADER', 'FOOTER', 'FIGCAPTION',
  ]);

  const UI_CSS = `
    :host { color-scheme: light; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .mirror, .mirror span {
      margin: 0;
      letter-spacing: inherit;
    }
    .mirror {
      position: fixed !important;
      left: 0 !important;
      top: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
      overflow: visible !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      border-style: solid !important;
      border-color: transparent !important;
      white-space: pre-wrap !important;
      word-wrap: break-word !important;
    }
    .wave {
      position: fixed;
      height: 5px;
      pointer-events: none;
      background-repeat: repeat-x;
      background-position: left center;
      background-size: 8px 4px;
      z-index: 2147483644;
    }
    .wave.spelling {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='4' viewBox='0 0 8 4'%3E%3Cpath d='M0 3 Q2 0 4 3 T8 3' fill='none' stroke='%23d4352c' stroke-width='1.2' stroke-linecap='round'/%3E%3C/svg%3E");
    }
    .wave.grammar {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='4' viewBox='0 0 8 4'%3E%3Cpath d='M0 3 Q2 0 4 3 T8 3' fill='none' stroke='%232457d6' stroke-width='1.2' stroke-linecap='round'/%3E%3C/svg%3E");
    }
    .wave.style {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='4' viewBox='0 0 8 4'%3E%3Cpath d='M0 3 Q2 0 4 3 T8 3' fill='none' stroke='%23d08900' stroke-width='1.2' stroke-linecap='round'/%3E%3C/svg%3E");
    }
    .badge, .popup, .panel { pointer-events: auto; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .badge {
      position: fixed;
      z-index: 2147483646;
      min-width: 22px;
      height: 22px;
      padding: 0 6px;
      border: 0;
      border-radius: 999px;
      background: #1c1712;
      color: #f6f1e8;
      font-size: 12px;
      font-weight: 650;
      letter-spacing: 0.01em;
      cursor: pointer;
      box-shadow: 0 6px 16px rgba(40, 28, 18, 0.22);
    }
    .badge[data-mode="error"] { background: #d4352c; }
    .badge[data-mode="ok"] { background: #1d6b45; }
    .badge[data-mode="busy"] { background: #6f6458; }
    .popup, .panel {
      position: fixed;
      z-index: 2147483647;
      background: #fffdf8;
      color: #1c1712;
      border: 1px solid #e4d9c8;
      border-radius: 14px;
      box-shadow: 0 16px 40px rgba(48, 32, 16, 0.16), 0 0 0 1px rgba(48, 32, 16, 0.04);
    }
    .popup { width: 300px; max-height: min(380px, 70vh); overflow: auto; padding: 12px; }
    .panel { width: 320px; max-height: min(440px, 72vh); overflow: auto; padding: 12px 12px 8px; }
    .pill {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .pill.spelling { color: #d4352c; background: #fde8e4; }
    .pill.grammar { color: #2457d6; background: #e6eeff; }
    .pill.style { color: #8a5a00; background: #fff1d6; }
    .context {
      margin: 8px 0 6px;
      font-family: Palatino, "Palatino Linotype", Georgia, serif;
      font-size: 16px;
      line-height: 1.45;
    }
    .context mark {
      background: transparent;
      color: inherit;
      text-decoration: underline wavy #d4352c;
      text-underline-offset: 3px;
    }
    .popup[data-cat="grammar"] .context mark, .issue[data-cat="grammar"] .context mark { text-decoration-color: #2457d6; }
    .popup[data-cat="style"] .context mark, .issue[data-cat="style"] .context mark { text-decoration-color: #d08900; }
    .message { margin: 0 0 8px; color: #74685c; font-size: 13px; line-height: 1.45; }
    .suggestions { display: flex; flex-direction: column; gap: 6px; }
    .suggestion {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1px;
      width: 100%;
      text-align: left;
      border-radius: 9px;
      border: 1px solid #e4d9c8;
      background: #fff;
      color: #1c1712;
      padding: 7px 10px;
      cursor: pointer;
      font: inherit;
    }
    .suggestion strong { font-size: 14px; font-weight: 650; }
    .suggestion span { color: #74685c; font-size: 11px; }
    .suggestion.primary { background: #1c1712; color: #f6f1e8; border-color: #1c1712; }
    .suggestion.primary span { color: #e4d9c8; }
    .suggestion:hover { border-color: #1c1712; }
    .actions, .issue-actions {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }
    .quiet, .issue-actions button {
      flex: 1;
      border: 0;
      background: transparent;
      color: #3a332c;
      border-radius: 8px;
      padding: 6px 4px;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
    }
    .quiet:hover, .issue-actions button:hover { background: rgba(28, 23, 18, 0.05); }
    .panel-head {
      position: sticky;
      top: -12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 2px 0 10px;
      background: #fffdf8;
      z-index: 1;
    }
    .panel-head h2 { margin: 0; font-size: 15px; font-weight: 680; letter-spacing: -0.01em; }
    .fixall, .retry {
      border: 0;
      border-radius: 999px;
      background: #1c1712;
      color: #f6f1e8;
      padding: 6px 12px;
      font: inherit;
      font-size: 12px;
      font-weight: 650;
      cursor: pointer;
    }
    .fixall:disabled { opacity: 0.38; cursor: not-allowed; }
    .empty { margin: 8px 0 12px; color: #74685c; font-size: 13px; line-height: 1.45; }
    .issue { border-top: 1px solid #e4d9c8; padding: 10px 0; }
    .issue .context { font-size: 15px; margin-top: 6px; }
    .status-error { color: #d4352c; }
  `;

  const fields = new Map();
  let settings = null;
  let host = null;
  let shadow = null;
  let mirror = null;
  let badge = null;
  let popup = null;
  let panel = null;
  let focused = null;
  let panelState = null;
  let panelOpen = false;
  let positionRaf = 0;
  let frameTimer = 0;

  function h(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          if (error) resolve({ ok: false, error: error.message });
          else resolve(response);
        });
      } catch (error) {
        resolve({ ok: false, error: String(error && error.message ? error.message : error) });
      }
    });
  }

  function canCheck() {
    return !!(settings && settings.enabled && !settings.disabledSites.includes(location.hostname));
  }

  function ancestorPath(node) {
    const path = [];
    let current = node;
    while (current) {
      path.push(current);
      current = current.parentElement || current.parentNode;
      if (current && current.nodeType === 11) current = current.host || null;
    }
    return path;
  }

  function findField(path) {
    let editable = null;
    for (const node of path) {
      if (!node || node.nodeType !== 1) continue;
      if (node.id === 'redline-extension-root') break;
      const tag = node.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return node;
      if (!node.isContentEditable || !node.hasAttribute('contenteditable')) continue;
      const value = (node.getAttribute('contenteditable') || '').toLowerCase();
      if (value !== 'false') editable = node;
    }
    return editable;
  }

  function isVisible(el) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 8 && rect.height >= 8;
  }

  function eligible(el) {
    if (!el || el.nodeType !== 1 || !el.isConnected) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest('fieldset[disabled]')) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') {
      if (el.disabled || el.readOnly) return false;
      if (tag === 'INPUT' && !Redline.isAllowedInputType(el.getAttribute('type'))) return false;
      if (el.closest('.monaco-editor, .ace_editor')) return false;
      if (sensitive(el) || !isVisible(el)) return false;
      return true;
    }
    if (el.isContentEditable) {
      if (el === document.body || el === document.documentElement) return false;
      const role = (el.getAttribute('role') || '').toLowerCase();
      if (role === 'button' || role === 'checkbox' || role === 'menuitem' || role === 'tab') return false;
      if (sensitive(el) || !isVisible(el)) return false;
      return true;
    }
    return false;
  }

  function sensitive(el) {
    return Redline.isSensitiveMeta({
      type: el.getAttribute('type') || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      name: el.getAttribute('name') || '',
      id: el.id || '',
      placeholder: el.getAttribute('placeholder') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
    });
  }

  function createMirror() {
    const el = document.createElement('div');
    el.className = 'mirror';
    el.setAttribute('aria-hidden', 'true');
    return {
      el,
      sync(field) {
        const style = getComputedStyle(field);
        const borderLeft = parseFloat(style.borderLeftWidth) || 0;
        const borderRight = parseFloat(style.borderRightWidth) || 0;
        const scrollbar = field.tagName === 'TEXTAREA'
          ? Math.max(0, field.offsetWidth - field.clientWidth - borderLeft - borderRight)
          : 0;
        const set = (prop, value) => el.style.setProperty(prop, value, 'important');
        set('box-sizing', 'border-box');
        set('width', Math.max(0, field.offsetWidth - scrollbar) + 'px');
        set('border-top-width', style.borderTopWidth);
        set('border-right-width', style.borderRightWidth);
        set('border-bottom-width', style.borderBottomWidth);
        set('border-left-width', style.borderLeftWidth);
        set('padding-top', style.paddingTop);
        set('padding-right', style.paddingRight);
        set('padding-bottom', style.paddingBottom);
        set('padding-left', style.paddingLeft);
        set('font-style', style.fontStyle);
        set('font-variant', style.fontVariant);
        set('font-weight', style.fontWeight);
        set('font-stretch', style.fontStretch);
        set('font-size', style.fontSize);
        set('line-height', style.lineHeight);
        set('font-family', style.fontFamily);
        set('letter-spacing', style.letterSpacing);
        set('word-spacing', style.wordSpacing);
        set('text-align', style.textAlign);
        set('text-indent', style.textIndent);
        set('text-transform', style.textTransform);
        set('tab-size', style.tabSize);
        set('direction', style.direction);
        set('white-space', field.tagName === 'INPUT' ? 'pre' : (style.whiteSpace || 'pre-wrap'));
        set('overflow-wrap', style.overflowWrap || 'break-word');
        set('word-break', style.wordBreak);
      },
      caret(value, index) {
        const i = Math.max(0, Math.min(value.length, index));
        const span = document.createElement('span');
        const rest = value.slice(i);
        span.textContent = rest.length ? rest : '\u200b';
        el.replaceChildren(document.createTextNode(value.slice(0, i)), span);
        const origin = el.getBoundingClientRect();
        const rect = span.getClientRects()[0] || span.getBoundingClientRect();
        return {
          left: rect.left - origin.left,
          top: rect.top - origin.top,
          height: rect.height || 16,
          width: rect.width,
        };
      },
    };
  }

  function inputTopDelta(field, lineHeight) {
    if (field.tagName !== 'INPUT') return 0;
    const style = getComputedStyle(field);
    const inner = field.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
    if (!lineHeight || inner <= lineHeight + 1) return 0;
    return (inner - lineHeight) / 2;
  }

  function extract(root) {
    const segments = [];
    let text = '';

    function addText(node) {
      const value = node.nodeValue || '';
      if (!value) return;
      const start = text.length;
      text += value;
      segments.push({ type: 'text', node, start, end: text.length });
    }

    function addBreak() {
      const start = text.length;
      text += '\n';
      segments.push({ type: 'break', start, end: text.length });
    }

    function walk(node, isRoot) {
      if (node.nodeType === Node.TEXT_NODE) {
        addText(node);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (tag === 'BR') {
        addBreak();
        return;
      }
      if (BLOCK.has(tag) && !isRoot && text.length && !text.endsWith('\n')) addBreak();
      for (const child of node.childNodes) walk(child, false);
    }

    walk(root, true);
    return { text, segments };
  }

  function locate(segments, offset, bias) {
    for (const segment of segments) {
      if (segment.type !== 'text') continue;
      if (offset > segment.start && offset < segment.end) {
        return { node: segment.node, offset: offset - segment.start };
      }
      if (offset === segment.start && bias === 'start') return { node: segment.node, offset: 0 };
      if (offset === segment.end && bias === 'end') {
        return { node: segment.node, offset: segment.node.nodeValue.length };
      }
      if (offset === segment.start && bias === 'end' && offset === segment.end) {
        return { node: segment.node, offset: 0 };
      }
    }
    if (bias === 'end') {
      for (let i = segments.length - 1; i >= 0; i--) {
        const segment = segments[i];
        if (segment.type === 'text' && segment.end <= offset) {
          return { node: segment.node, offset: segment.node.nodeValue.length };
        }
      }
    }
    for (const segment of segments) {
      if (segment.type === 'text' && segment.start >= offset) return { node: segment.node, offset: 0 };
    }
    const first = segments.find((segment) => segment.type === 'text');
    return first ? { node: first.node, offset: 0 } : null;
  }

  function offsetToRange(segments, start, end) {
    if (!segments || end <= start) return null;
    const from = locate(segments, start, 'start');
    const to = locate(segments, end, 'end');
    if (!from || !to) return null;
    try {
      const range = document.createRange();
      range.setStart(from.node, Math.min(from.offset, from.node.nodeValue.length));
      range.setEnd(to.node, Math.min(to.offset, to.node.nodeValue.length));
      return range;
    } catch (error) {
      return null;
    }
  }

  function absoluteFromSelection(segments, container, offset) {
    if (!segments) return null;
    if (container.nodeType === Node.TEXT_NODE) {
      const segment = segments.find((item) => item.node === container);
      if (!segment) return null;
      return segment.start + Math.min(offset, container.nodeValue.length);
    }
    if (container.nodeType === Node.ELEMENT_NODE) {
      if (offset >= container.childNodes.length) {
        const inside = segments.filter((item) => item.type === 'text' && container.contains(item.node));
        return inside.length ? inside[inside.length - 1].end : null;
      }
      const child = container.childNodes[offset];
      if (!child) return null;
      if (child.nodeType === Node.TEXT_NODE) {
        const segment = segments.find((item) => item.node === child);
        return segment ? segment.start : null;
      }
      const next = segments.find((item) => item.type === 'text' && child.contains && child.contains(item.node));
      if (next) return next.start;
      if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'BR') {
        const brIndex = segments.findIndex((item) => item.type === 'break');
        return brIndex >= 0 ? segments[brIndex].start : null;
      }
    }
    return null;
  }

  function readField(state) {
    if (state.kind === 'text') return { text: state.field.value, segments: null };
    return extract(state.field);
  }

  function caretOffset(state) {
    if (state.kind === 'text') return state.field.selectionStart || 0;
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !state.segments) return 0;
    const range = selection.getRangeAt(0);
    if (!state.field.contains(range.endContainer)) return 0;
    const pos = absoluteFromSelection(state.segments, range.endContainer, range.endOffset);
    return pos == null ? 0 : pos;
  }

  function matchAt(matches, pos) {
    if (pos == null) return null;
    let edge = null;
    for (const match of matches) {
      if (pos >= match.offset && pos < match.offset + match.length) return match;
      if (pos === match.offset + match.length) edge = match;
    }
    return edge;
  }

  function hasSelection(state) {
    if (state.kind === 'text') return state.field.selectionStart !== state.field.selectionEnd;
    const selection = window.getSelection();
    return !!(selection && !selection.isCollapsed && state.field.contains(selection.anchorNode));
  }

  function installHighlightStyles() {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`
        ::highlight(redline-spelling) {
          text-decoration-line: underline; text-decoration-style: wavy; text-decoration-color: #d4352c;
          text-decoration-thickness: 1.5px; text-underline-offset: 2px; text-decoration-skip-ink: none;
          background-color: rgba(212, 53, 44, 0.13);
        }
        ::highlight(redline-grammar) {
          text-decoration-line: underline; text-decoration-style: wavy; text-decoration-color: #2457d6;
          text-decoration-thickness: 1.5px; text-underline-offset: 2px; text-decoration-skip-ink: none;
          background-color: rgba(36, 87, 214, 0.13);
        }
        ::highlight(redline-style) {
          text-decoration-line: underline; text-decoration-style: wavy; text-decoration-color: #d08900;
          text-decoration-thickness: 1.5px; text-underline-offset: 2px; text-decoration-skip-ink: none;
          background-color: rgba(208, 137, 0, 0.16);
        }
      `);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch (error) {
      /* content.css from the manifest still applies */
    }
  }

  function ensureUi() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = 'redline-extension-root';
    host.style.all = 'initial';
    host.style.position = 'fixed';
    host.style.zIndex = '2147483646';
    host.style.top = '0';
    host.style.left = '0';
    host.style.width = '0';
    host.style.height = '0';
    host.style.overflow = 'visible';
    host.style.pointerEvents = 'none';
    (document.documentElement || document.body).append(host);
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = UI_CSS;
    shadow.append(style);
    mirror = createMirror();
    badge = h('button', 'badge');
    badge.type = 'button';
    badge.hidden = true;
    popup = h('div', 'popup');
    popup.hidden = true;
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Suggestion');
    panel = h('div', 'panel');
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Issues');
    shadow.append(mirror.el, badge, popup, panel);
    const keepFieldFocus = (event) => event.preventDefault();
    badge.addEventListener('mousedown', keepFieldFocus);
    popup.addEventListener('mousedown', keepFieldFocus);
    panel.addEventListener('mousedown', keepFieldFocus);
    badge.addEventListener('click', () => {
      const state = focused && fields.get(focused);
      if (!state) return;
      if (panel.hidden) openPanel(state);
      else hidePanel();
    });
  }

  function schedulePosition() {
    if (positionRaf) return;
    positionRaf = requestAnimationFrame(() => {
      positionRaf = 0;
      for (const state of [...fields.values()]) {
        if (!state.field.isConnected) {
          detach(state);
          continue;
        }
        if (state.kind === 'text' && state.field.clientWidth !== state.layoutWidth && state.matches.length) {
          layoutText(state);
        }
        positionMarks(state);
      }
      positionBadge();
      if (panelOpen && panelState && panelState.field.isConnected) placePanel(panelState);
      if (host && !host.isConnected) document.documentElement.append(host);
    });
  }

  function measureBoxes(text, matches, field) {
    const el = mirror.el;
    el.replaceChildren();
    const sorted = matches.slice().sort((a, b) => a.offset - b.offset);
    let cursor = 0;
    const spans = [];
    for (const match of sorted) {
      const start = Math.max(cursor, match.offset);
      const end = match.offset + match.length;
      if (end <= start || start >= text.length) continue;
      if (start > cursor) el.append(document.createTextNode(text.slice(cursor, start)));
      const span = document.createElement('span');
      span.textContent = text.slice(start, Math.min(text.length, end));
      el.append(span);
      spans.push({ match, span });
      cursor = Math.min(text.length, end);
    }
    if (!spans.length) return [];
    if (cursor < text.length) el.append(document.createTextNode(text.slice(cursor)));
    const fontSize = parseFloat(getComputedStyle(field).fontSize) || 16;
    const origin = el.getBoundingClientRect();
    const sample = spans[0].span.getClientRects()[0];
    const delta = inputTopDelta(field, sample ? sample.height : fontSize);
    const boxes = [];
    for (const item of spans) {
      const category = Redline.categorize(item.match);
      for (const rect of item.span.getClientRects()) {
        if (rect.width < 0.5) continue;
        const leading = Math.max(0, rect.height - fontSize);
        boxes.push({
          category,
          left: rect.left - origin.left,
          // Sit the wave in the gap under the glyphs, not through the x-height.
          top: rect.top - origin.top + leading / 2 + fontSize * 0.92 + delta,
          width: Math.max(6, rect.width),
        });
      }
    }
    return boxes;
  }

  function layoutText(state) {
    mirror.sync(state.field);
    state.boxes = measureBoxes(state.field.value, state.matches, state.field);
    state.layoutWidth = state.field.clientWidth;
    while (state.waves.length < state.boxes.length) {
      const node = document.createElement('span');
      node.className = 'wave';
      shadow.append(node);
      state.waves.push(node);
    }
    while (state.waves.length > state.boxes.length) state.waves.pop().remove();
    state.boxes.forEach((box, index) => {
      state.waves[index].className = 'wave ' + box.category;
    });
  }

  function positionMarks(state) {
    if (state.kind !== 'text') return;
    const field = state.field;
    const rect = field.getBoundingClientRect();
    const style = getComputedStyle(field);
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const borderBottom = parseFloat(style.borderBottomWidth) || 0;
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderRight = parseFloat(style.borderRightWidth) || 0;
    const scrollbar = Math.max(0, field.offsetWidth - field.clientWidth - borderLeft - borderRight);
    const viewTop = rect.top + borderTop - 2;
    const viewBottom = rect.bottom - borderBottom + 2;
    const viewLeft = rect.left + borderLeft;
    const viewRight = rect.right - borderRight - scrollbar;
    state.waves.forEach((node, index) => {
      const box = state.boxes[index];
      if (!box || rect.width < 2 || rect.height < 2) {
        node.style.display = 'none';
        return;
      }
      const x = rect.left + box.left - field.scrollLeft;
      const y = rect.top + box.top - field.scrollTop;
      if (y < viewTop || y > viewBottom || x > viewRight || x + box.width < viewLeft) {
        node.style.display = 'none';
        return;
      }
      const left = Math.max(x, viewLeft);
      node.style.display = 'block';
      node.style.left = left + 'px';
      node.style.top = y + 'px';
      node.style.width = Math.max(4, Math.min(box.width - (left - x), viewRight - left)) + 'px';
    });
  }

  function clearMarks(state) {
    for (const node of state.waves) node.remove();
    state.waves = [];
    state.boxes = [];
  }

  function refreshHighlights() {
    if (!window.CSS || !CSS.highlights || typeof Highlight !== 'function') return;
    const groups = { spelling: [], grammar: [], style: [] };
    for (const state of fields.values()) {
      if (state.kind !== 'rich' || !state.segments) continue;
      for (const match of state.matches) {
        const range = offsetToRange(state.segments, match.offset, match.offset + match.length);
        if (!range || range.collapsed) continue;
        groups[Redline.categorize(match)].push(range);
      }
    }
    for (const name of ['spelling', 'grammar', 'style']) {
      const key = 'redline-' + name;
      try {
        if (!groups[name].length) CSS.highlights.delete(key);
        else CSS.highlights.set(key, new Highlight(...groups[name]));
      } catch (error) {
        /* ignore a detached range */
      }
    }
  }

  function clearHighlights() {
    if (!window.CSS || !CSS.highlights) return;
    CSS.highlights.delete('redline-spelling');
    CSS.highlights.delete('redline-grammar');
    CSS.highlights.delete('redline-style');
  }

  function renderField(state) {
    if (state.kind === 'text') layoutText(state);
    else clearMarks(state);
    positionMarks(state);
    refreshHighlights();
    if (panelOpen && panelState === state) buildPanel(state);
    updateBadge();
    publishFrameStats();
    schedulePosition();
  }

  function hidePopup() {
    popup.hidden = true;
    popup.replaceChildren();
  }

  function hidePanel() {
    panelOpen = false;
    panelState = null;
    panel.hidden = true;
    panel.replaceChildren();
  }

  function hideBadge() {
    badge.hidden = true;
  }

  function updateBadge() {
    const state = focused && fields.get(focused);
    if (!state || !canCheck()) {
      hideBadge();
      return;
    }
    const count = state.matches.length;
    if (!state.checked && !state.pending && !count && !state.error) {
      hideBadge();
      return;
    }
    badge.hidden = false;
    if (state.error && !count) {
      badge.dataset.mode = 'error';
      badge.textContent = '!';
      badge.title = state.error;
    } else if ((state.pending || state.checking) && !count) {
      badge.dataset.mode = 'busy';
      badge.textContent = '…';
      badge.title = 'Checking';
    } else if (!count) {
      badge.dataset.mode = 'ok';
      badge.textContent = '✓';
      badge.title = 'No issues';
    } else {
      badge.dataset.mode = 'issues';
      badge.textContent = String(count);
      badge.title = count === 1 ? '1 issue' : count + ' issues';
    }
    badge.setAttribute('aria-label', badge.title + '. Show all issues');
    positionBadge();
  }

  function positionBadge() {
    const state = focused && fields.get(focused);
    if (!state || badge.hidden) return;
    const rect = state.field.getBoundingClientRect();
    const width = badge.offsetWidth || 28;
    let left = rect.right - width - 8;
    let top = rect.height < 56 ? rect.top - 12 : rect.top + 8;
    if (top < 6) top = Math.min(rect.bottom + 6, window.innerHeight - 30);
    if (left < 6) left = 6;
    if (left + width > window.innerWidth - 6) left = window.innerWidth - width - 6;
    badge.style.left = left + 'px';
    badge.style.top = top + 'px';
  }

  function contextFragment(match, fullText) {
    const raw = fullText.slice(match.offset, match.offset + match.length);
    const frag = document.createDocumentFragment();
    let text = '';
    let offset = 0;
    let length = raw.length;
    const ctx = match.context;
    if (ctx && ctx.text && ctx.text.slice(ctx.offset, ctx.offset + ctx.length) === raw) {
      text = ctx.text;
      offset = ctx.offset;
      length = ctx.length;
    } else {
      const start = Math.max(0, match.offset - 28);
      const end = Math.min(fullText.length, match.offset + match.length + 28);
      text = (start ? '…' : '') + fullText.slice(start, end) + (end < fullText.length ? '…' : '');
      offset = (start ? 1 : 0) + (match.offset - start);
    }
    if (text.length > 150) {
      const begin = Math.max(0, offset - 46);
      const end = Math.min(text.length, offset + length + 46);
      const prefix = begin > 0 ? '…' : '';
      const suffix = end < text.length ? '…' : '';
      text = prefix + text.slice(begin, end) + suffix;
      offset = offset - begin + prefix.length;
    }
    frag.append(document.createTextNode(text.slice(0, offset)));
    frag.append(h('mark', null, text.slice(offset, offset + length)));
    frag.append(document.createTextNode(text.slice(offset + length)));
    return frag;
  }

  function suggestionButton(label, detail, primary) {
    const button = h('button', primary ? 'suggestion primary' : 'suggestion');
    button.type = 'button';
    button.append(h('strong', null, label));
    if (detail) button.append(h('span', null, detail));
    return button;
  }

  function fillIssue(container, state, match, limit) {
    const category = Redline.categorize(match);
    container.dataset.cat = category;
    container.append(h('span', 'pill ' + category, Redline.categoryLabel(category)));
    const context = h('div', 'context');
    context.append(contextFragment(match, state.text));
    container.append(context);
    if (match.message) container.append(h('p', 'message', match.message));
    const suggestions = h('div', 'suggestions');
    (match.replacements || []).slice(0, limit).forEach((item, index) => {
      const label = item.value === '' ? 'Delete' : item.value;
      const button = suggestionButton(label, item.shortDescription || '', index === 0);
      button.addEventListener('click', () => applyOne(state, match, item.value));
      suggestions.append(button);
    });
    if (suggestions.childElementCount) container.append(suggestions);
    else container.append(h('p', 'message', 'No suggestion for this one.'));
    return category;
  }

  function anchorFor(state, match) {
    if (state.kind === 'text') {
      mirror.sync(state.field);
      const pos = mirror.caret(state.field.value, match.offset + match.length);
      const rect = state.field.getBoundingClientRect();
      const delta = inputTopDelta(state.field, pos.height);
      return {
        x: rect.left + Math.max(0, pos.left) - state.field.scrollLeft,
        y: rect.top + pos.top + Math.min(pos.height, 28) + delta - state.field.scrollTop,
      };
    }
    const range = state.segments && offsetToRange(state.segments, match.offset, match.offset + match.length);
    if (!range) {
      const rect = state.field.getBoundingClientRect();
      return { x: rect.left + 12, y: rect.top + 24 };
    }
    const rect = range.getClientRects()[0] || range.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom };
  }

  function place(el, x, y) {
    el.hidden = false;
    const width = el.offsetWidth || 300;
    const height = el.offsetHeight || 180;
    let left = x;
    let top = y + 8;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    if (left < 8) left = 8;
    if (top + height > window.innerHeight - 8) top = Math.max(8, y - height - 10);
    if (top < 8) top = 8;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function showPopup(state, match, x, y) {
    hidePanel();
    const category = Redline.categorize(match);
    popup.replaceChildren();
    popup.dataset.cat = category;
    fillIssue(popup, state, match, 6);
    const actions = h('div', 'actions');
    const ignore = h('button', 'quiet', 'Ignore');
    ignore.type = 'button';
    ignore.addEventListener('click', () => ignoreMatch(state, match));
    const dict = h('button', 'quiet', 'Add to dictionary');
    dict.type = 'button';
    dict.addEventListener('click', () => addWord(state, match));
    actions.append(ignore, dict);
    popup.append(actions);
    place(popup, x, y);
  }

  function openPanel(state) {
    hidePopup();
    panelState = state;
    panelOpen = true;
    buildPanel(state);
  }

  function placePanel(state) {
    panel.hidden = false;
    const rect = state.field.getBoundingClientRect();
    const width = panel.offsetWidth || 320;
    const height = panel.offsetHeight || 220;
    const gap = 8;
    let left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    let top = rect.bottom + gap;
    if (top + height > window.innerHeight - 8) {
      const above = rect.top - height - gap;
      if (above >= 8) top = above;
      else top = Math.max(8, window.innerHeight - height - 8);
    }
    if (left < 8) left = 8;
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }

  function buildPanel(state) {
    panel.replaceChildren();
    const head = h('div', 'panel-head');
    const count = state.matches.length;
    const title = state.error && !count
      ? 'Couldn’t check'
      : (state.pending || state.checking) && !count
        ? 'Checking…'
        : count === 1
          ? '1 issue'
          : count + ' issues';
    head.append(h('h2', null, title));
    const fixes = state.matches.filter((match) => Redline.firstReplacement(match) != null).length;
    const fix = h('button', 'fixall', fixes ? 'Fix all (' + fixes + ')' : 'Fix all');
    fix.type = 'button';
    fix.disabled = fixes === 0;
    fix.addEventListener('click', () => fixAll(state));
    head.append(fix);
    panel.append(head);
    if (state.error && !count) {
      panel.append(h('p', 'empty status-error', state.error));
      const retry = h('button', 'retry', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', () => {
        state.lastCheckedKey = '';
        state.error = '';
        scheduleCheck(state, 20);
      });
      panel.append(retry);
    } else if ((state.pending || state.checking) && !count) {
      panel.append(h('p', 'empty', 'Checking this field…'));
    } else if (!count) {
      panel.append(h('p', 'empty', 'No issues in this field.'));
    } else {
      for (const match of state.matches) {
        const issue = h('article', 'issue');
        fillIssue(issue, state, match, 3);
        const actions = h('div', 'issue-actions');
        const jump = h('button', null, 'Show');
        jump.type = 'button';
        jump.addEventListener('click', () => reveal(state, match));
        const ignore = h('button', null, 'Ignore');
        ignore.type = 'button';
        ignore.addEventListener('click', () => ignoreMatch(state, match));
        const dict = h('button', null, 'Dictionary');
        dict.type = 'button';
        dict.addEventListener('click', () => addWord(state, match));
        actions.append(jump, ignore, dict);
        issue.append(actions);
        panel.append(issue);
      }
    }
    placePanel(state);
  }

  function reveal(state, match) {
    state.field.focus();
    if (state.kind === 'text') {
      state.field.setSelectionRange(match.offset, match.offset + match.length);
      const anchor = anchorFor(state, match);
      const top = anchor.y - state.field.getBoundingClientRect().top + state.field.scrollTop;
      if (top < state.field.scrollTop + 8 || top > state.field.scrollTop + state.field.clientHeight - 16) {
        state.field.scrollTop = Math.max(0, top - 48);
      }
      return;
    }
    const fresh = extract(state.field);
    state.segments = fresh.segments;
    const range = offsetToRange(fresh.segments, match.offset, match.offset + match.length);
    if (!range) return;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    if (node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function onFieldClick(state) {
    if (hasSelection(state)) return;
    const match = matchAt(state.matches, caretOffset(state));
    if (!match) {
      hidePopup();
      return;
    }
    const anchor = anchorFor(state, match);
    showPopup(state, match, anchor.x, anchor.y);
  }

  function replacePlain(field, start, end, text) {
    field.focus();
    const before = field.value;
    try {
      field.setSelectionRange(start, end);
      document.execCommand('insertText', false, text);
    } catch (error) {
      /* setRangeText below */
    }
    if (field.value !== before && field.value.slice(start, start + text.length) === text) return true;
    if (field.value !== before) field.value = before;
    try {
      field.setRangeText(text, start, end, 'end');
    } catch (error) {
      field.value = before.slice(0, start) + text + before.slice(end);
      field.setSelectionRange(start + text.length, start + text.length);
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
    return field.value.slice(start, start + text.length) === text;
  }

  function replaceWhole(field, text) {
    field.focus();
    const before = field.value;
    try {
      field.setSelectionRange(0, before.length);
      document.execCommand('insertText', false, text);
    } catch (error) {
      /* direct replacement below */
    }
    if (field.value === text) return;
    try {
      field.setRangeText(text, 0, field.value.length, 'end');
    } catch (error) {
      field.value = text;
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }

  function replaceRich(state, match, replacement) {
    const before = extract(state.field);
    const range = offsetToRange(before.segments, match.offset, match.offset + match.length);
    if (!range) return false;
    state.field.focus();
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    try {
      document.execCommand('insertText', false, replacement);
    } catch (error) {
      /* fallback below */
    }
    let now = extract(state.field).text;
    if (now.slice(match.offset, match.offset + replacement.length) === replacement) return true;
    if (now !== before.text && now.includes(replacement)) return true;
    if (now !== before.text) return true;
    const rangeAgain = offsetToRange(before.segments, match.offset, match.offset + match.length);
    if (!rangeAgain) return false;
    rangeAgain.deleteContents();
    const node = document.createTextNode(replacement);
    rangeAgain.insertNode(node);
    const after = document.createRange();
    after.setStartAfter(node);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
    state.field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: replacement }));
    now = extract(state.field).text;
    return now !== before.text;
  }

  function afterEdit(state, applied) {
    if (applied) send({ type: 'stat', fixes: applied });
    state.matches = [];
    state.rawMatches = null;
    state.lastCheckedKey = '';
    state.error = '';
    hidePopup();
    const fresh = readField(state);
    state.text = fresh.text;
    state.segments = fresh.segments;
    renderField(state);
    scheduleCheck(state, 220);
  }

  function applyOne(state, match, replacement) {
    state.applying = true;
    let ok = false;
    try {
      ok = state.kind === 'text'
        ? replacePlain(state.field, match.offset, match.offset + match.length, replacement)
        : replaceRich(state, match, replacement);
    } finally {
      state.applying = false;
    }
    if (!ok) return;
    afterEdit(state, 1);
  }

  function fixAll(state) {
    const source = state.kind === 'text' ? state.field.value : state.text;
    const planned = Redline.applyReplacements(source, state.matches);
    if (!planned.count) return;
    state.applying = true;
    let applied = 0;
    try {
      if (state.kind === 'text') {
        const before = state.field.value;
        replaceWhole(state.field, planned.text);
        if (state.field.value !== before) applied = planned.count;
      } else {
        const ordered = state.matches
          .filter((match) => Redline.firstReplacement(match) != null)
          .sort((a, b) => b.offset - a.offset);
        for (const match of ordered) {
          if (replaceRich(state, match, Redline.firstReplacement(match))) applied += 1;
        }
      }
    } finally {
      state.applying = false;
    }
    afterEdit(state, applied);
  }

  function ignoreMatch(state, match) {
    settings.ignored = Redline.addIgnored(settings.ignored, match, state.text);
    chrome.storage.local.set({ ignored: settings.ignored });
    hidePopup();
    refilterAll();
  }

  function addWord(state, match) {
    const raw = state.text.slice(match.offset, match.offset + match.length);
    const result = Redline.addDictionaryWord(settings.dictionary, raw);
    if (!result.added && result.list === settings.dictionary) {
      hidePopup();
      return;
    }
    settings.dictionary = result.list;
    chrome.storage.local.set({ dictionary: result.list });
    hidePopup();
    refilterAll();
  }

  function refilterAll() {
    for (const state of fields.values()) {
      if (!state.rawMatches) continue;
      state.matches = Redline.filterMatches(state.rawMatches, state.text, settings);
      renderField(state);
    }
  }

  function scheduleCheck(state, delay) {
    clearTimeout(state.timer);
    state.pending = true;
    state.timer = setTimeout(() => runCheck(state), delay == null ? DEBOUNCE_MS : delay);
    updateBadge();
  }

  async function runCheck(state) {
    if (!fields.has(state.field)) return;
    if (!canCheck()) {
      state.pending = false;
      state.checking = false;
      detach(state);
      return;
    }
    const extracted = readField(state);
    state.text = extracted.text;
    state.segments = extracted.segments;
    if (!/[\p{L}\p{N}]/u.test(state.text)) {
      state.pending = false;
      state.checking = false;
      state.checked = true;
      state.matches = [];
      state.rawMatches = null;
      state.error = '';
      renderField(state);
      return;
    }
    const slice = Redline.sliceForCheck(state.text, caretOffset(state));
    const key = [settings.language, settings.picky, settings.serverUrl, slice.offset, slice.text].join('\n');
    if (key === state.lastCheckedKey && state.rawMatches) {
      state.matches = Redline.filterMatches(state.rawMatches, state.text, settings);
      state.pending = false;
      state.checking = false;
      state.checked = true;
      renderField(state);
      return;
    }
    const id = ++state.requestId;
    state.checking = true;
    state.pending = true;
    updateBadge();
    const response = await send({
      type: 'check',
      text: slice.text,
      language: settings.language,
      serverUrl: settings.serverUrl,
      picky: !!settings.picky,
    });
    if (id !== state.requestId || !fields.has(state.field)) return;
    const fresh = readField(state);
    if (fresh.text !== state.text) {
      state.checking = false;
      scheduleCheck(state, 180);
      return;
    }
    state.checking = false;
    state.pending = false;
    state.checked = true;
    if (!response || !response.ok) {
      state.error = (response && response.error) || 'Could not reach LanguageTool.';
      state.matches = [];
      renderField(state);
      return;
    }
    state.error = '';
    state.rawMatches = (response.matches || []).map((match) => ({ ...match, offset: match.offset + slice.offset }));
    state.lastCheckedKey = key;
    state.matches = Redline.filterMatches(state.rawMatches, state.text, settings);
    if (!response.cached) send({ type: 'stat', checks: 1 });
    renderField(state);
  }

  function publishFrameStats() {
    clearTimeout(frameTimer);
    frameTimer = setTimeout(publishFrameStatsNow, 60);
  }

  function publishFrameStatsNow() {
    let issues = 0;
    for (const state of fields.values()) issues += state.matches.length;
    send({ type: 'frameStats', issues });
  }

  function attach(field) {
    const state = {
      field,
      kind: field.tagName === 'TEXTAREA' || field.tagName === 'INPUT' ? 'text' : 'rich',
      controller: new AbortController(),
      waves: [],
      boxes: [],
      matches: [],
      rawMatches: null,
      segments: null,
      text: '',
      timer: 0,
      requestId: 0,
      lastCheckedKey: '',
      error: '',
      checking: false,
      pending: false,
      checked: false,
      applying: false,
      composing: false,
      layoutWidth: -1,
      originalSpellcheck: !!field.spellcheck,
    };
    field.spellcheck = false;
    fields.set(field, state);
    const signal = state.controller.signal;
    field.addEventListener('input', () => onInput(state), { signal });
    field.addEventListener('compositionstart', () => { state.composing = true; }, { signal });
    field.addEventListener('compositionend', () => {
      state.composing = false;
      onInput(state);
    }, { signal });
    field.addEventListener('click', () => onFieldClick(state), { signal });
    field.addEventListener('scroll', () => schedulePosition(), { signal, passive: true });
    field.addEventListener('blur', () => onBlur(state), { signal });
    state.ro = new ResizeObserver(() => schedulePosition());
    state.ro.observe(field);
    return state;
  }

  function onInput(state) {
    if (state.applying || state.composing) return;
    hidePopup();
    state.matches = [];
    state.rawMatches = null;
    state.lastCheckedKey = '';
    state.error = '';
    state.checked = false;
    const fresh = readField(state);
    state.text = fresh.text;
    state.segments = fresh.segments;
    renderField(state);
    scheduleCheck(state, DEBOUNCE_MS);
  }

  function onBlur(state) {
    setTimeout(() => {
      if (!state.field.isConnected) return;
      if (document.activeElement === state.field) return;
      const inside = document.activeElement === host;
      if (inside && (panelOpen || !popup.hidden)) return;
      if (focused === state.field) {
        focused = null;
        hideBadge();
        if (!inside) {
          hidePopup();
          hidePanel();
        }
      }
    }, 140);
  }

  function detach(state) {
    clearTimeout(state.timer);
    state.controller.abort();
    if (state.ro) state.ro.disconnect();
    try {
      state.field.spellcheck = state.originalSpellcheck;
    } catch (error) {
      /* the node may already be gone */
    }
    clearMarks(state);
    fields.delete(state.field);
    if (focused === state.field) {
      focused = null;
      hideBadge();
    }
    if (panelState === state) hidePanel();
    refreshHighlights();
    publishFrameStats();
  }

  function detachAll() {
    for (const state of [...fields.values()]) detach(state);
    clearHighlights();
    hidePopup();
    hidePanel();
    hideBadge();
  }

  function focusState(state) {
    focused = state.field;
    updateBadge();
    schedulePosition();
  }

  function watchFromPath(path) {
    if (!canCheck()) return;
    const field = findField(path);
    if (!field || !eligible(field)) return;
    let state = fields.get(field);
    if (!state) state = attach(field);
    focusState(state);
    if (!state.pending && !state.checking && state.lastCheckedKey === '') scheduleCheck(state, 80);
  }

  function onFocusIn(event) {
    watchFromPath(event.composedPath());
  }

  function onKey(event) {
    if (event.key !== 'Escape') return;
    if (popup && !popup.hidden) {
      hidePopup();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (panelOpen) {
      hidePanel();
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function onDocMouseDown(event) {
    const path = event.composedPath();
    if (path.includes(popup) || path.includes(panel) || path.includes(badge)) return;
    hidePopup();
    const onField = focused && path.includes(focused);
    if (!onField) hidePanel();
  }

  function onMessage(message, _sender, sendResponse) {
    if (!message) return;
    if (message.type === 'ping') {
      sendResponse({ ok: true });
      return;
    }
    if (message.type === 'reportStats') {
      publishFrameStatsNow();
      sendResponse({ ok: true });
    }
  }

  function onStorage(changes, area) {
    if (area !== 'local') return;
    Redline.getSettings().then((next) => {
      settings = next;
      if (!canCheck()) {
        detachAll();
        return;
      }
      const refetch = changes.language || changes.picky || changes.serverUrl || changes.enabled || changes.disabledSites;
      if (!fields.size && document.activeElement) watchFromPath(ancestorPath(document.activeElement));
      for (const state of fields.values()) {
        if (refetch) {
          state.lastCheckedKey = '';
          scheduleCheck(state, 40);
        } else if (state.rawMatches) {
          state.matches = Redline.filterMatches(state.rawMatches, state.text, settings);
          renderField(state);
        }
      }
    }).catch(() => {});
  }

  async function init() {
    try {
      settings = await Redline.getSettings();
    } catch (error) {
      return;
    }
    ensureUi();
    installHighlightStyles();
    chrome.storage.onChanged.addListener(onStorage);
    chrome.runtime.onMessage.addListener(onMessage);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('scroll', () => schedulePosition(), true);
    window.addEventListener('resize', () => schedulePosition());
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDocMouseDown, true);
    if (document.activeElement && document.activeElement !== document.body && document.activeElement !== document.documentElement) {
      watchFromPath(ancestorPath(document.activeElement));
    }
  }

  init();
})();
