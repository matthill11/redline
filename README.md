# Redline

Redline is a personal Manifest V3 Chrome extension (version 1.1.0). It underlines spelling, grammar, and style as you type, applies one-click fixes, and, after you sign in with a Grok account, rewrites for tone and lets you talk to Grok. It is installed with **Load unpacked**. It is not published to the Chrome Web Store.


## What it does

**Spelling and grammar.** While a textarea, single-line text input, or contenteditable field is focused, Redline waits about 700ms after you pause, then sends that field’s text to the [LanguageTool](https://languagetool.org) check API (`https://api.languagetool.org/v2/check` unless you set another server). Matches come back as wavy underlines:

- red for spelling
- blue for grammar
- amber for style, including picky style rules when that option is on

Click an underline to read the explanation and suggestions. Click a suggestion to replace the marked text. **Ignore** hides that rule for that word. **Add to dictionary** stores the word in `chrome.storage` on this browser so it is not flagged again.

A round badge on the focused field shows the issue count. Click it for the full list and **Fix all**, which applies the first suggestion of every issue that has one.

The toolbar popup turns checking on or off globally and for the current site, sets the language (default English (US)), and shows checks, fixes, and the issue count on the page. Options also holds a custom LanguageTool URL, picky mode, the dictionary, and the ignore list.

**Tone.** On the issue list, or in the Grok side panel, choose Formal, Friendly, Confident, Concise, Casual, or Direct, then rewrite. Grok rewrites the selection, or the whole field when nothing is selected. You apply it with **Replace selection** or **Replace field**.

**Sign in with Grok.** The popup and Options start a device-code sign-in. Redline opens xAI’s site, you approve access with the Grok account you use on grok.com or x.com, and the tokens stay in `chrome.storage` on this browser. Redline never sees that password. The sign-in is meant for a SuperGrok or X Premium+ subscription. If xAI accepts the login and then refuses requests, Options can store an API key from [console.x.ai](https://console.x.ai) instead.

**Talk to Grok.** **Talk to Grok** in the toolbar opens a side panel. Type and send, or press **Speak** and the browser transcribes your voice before the text is sent. Each reply can be placed in the field. The same chat is available from **Talk to Grok** on the issue list, which opens a small panel on the page.

Checked fields are text, search, email, and URL inputs, textareas, and contenteditable editors such as Gmail compose. Google Docs is skipped: the document is painted on a canvas, and the popup says so on `docs.google.com`. Monaco and Ace editors are skipped. CodeMirror 6 and other normal contenteditables are attempted.

## Install

1. Clone or unzip this project so `manifest.json` is in the folder you will select.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select that folder (the repo root, which contains `manifest.json`, `src/`, and `icons/`).
6. Pin Redline, then reload any tabs that were already open.

`file://` pages are checked only after you open the extension’s details and turn on **Allow access to file URLs**.

## Usage

1. Focus a field and pause. Underlines appear when LanguageTool returns issues.
2. Click a wavy underline and choose a suggestion, or open the badge and use **Fix all**.
3. Use **Ignore** or **Add to dictionary** when a flag should stay hidden.
4. Open the toolbar popup to pause Redline, disable the current site, or change language.
5. Sign in with Grok from the popup or Options.
6. Rewrite tone from the issue list or the side panel, then apply the result.
7. Open **Talk to Grok** to ask about the writing in the focused field. **Speak** fills the message from the microphone. **Use in the field** inserts a reply.




## Privacy

Redline does not include analytics or tracking.

The text of a field you are editing is sent to LanguageTool when spelling and grammar run. With the server box in Options left empty, that server is `https://api.languagetool.org`. A custom URL, such as `http://localhost:8081`, is used instead when you save one. Only that field’s text is sent, and long fields are limited to about 18,000 characters around the cursor. The public API is also rate-limited (about a dozen requests a minute from this extension).

Text is sent to xAI only when you use a Grok feature: a tone rewrite or a Talk to Grok message. Sign-in itself happens on xAI’s site.

These fields are never read or sent:

- password and hidden inputs
- credit-card fields (`cc-*` autocomplete, or names and labels such as card number, CVV, CVC, or CSC)
- other obvious secrets (SSN, OTP, PIN, account number, routing number, security code)

The personal dictionary, ignore list, Grok tokens, and an optional API key stay in `chrome.storage` on this browser.

## Project structure

| Path | Role |
| --- | --- |
| `manifest.json` | Manifest V3, version 1.1.0. Permissions: `storage`, `sidePanel`, and host access for checks and Grok. |
| `src/content.js` | Finds editable fields, draws underlines, applies fixes, and hosts the on-page tone and chat UI. |
| `src/content.css` | Wavy highlight styles for contenteditable text. |
| `src/background.js` | Calls LanguageTool, runs Grok sign-in, and sends tone and chat requests to `api.x.ai`. |
| `src/common.js` | Shared settings, languages, match filtering, and the tone list. |
| `src/popup.html` | Toolbar popup: on/off, per-site switch, language, stats, and Talk to Grok. |
| `src/options.html` | LanguageTool server, picky mode, dictionary, ignore list, and Grok sign-in. |
| `src/sidepanel.html` | Talk to Grok: account, tone rewrite, chat, and Speak. |
| `src/grok-account.js` | Device-code sign-in UI shared by Options and the side panel. |
| `icons/` | Toolbar and store icons. |

## Limitations

- Google Docs cannot be underlined. The editor is a canvas, not a DOM text field.
- Monaco and Ace are skipped. Closed shadow roots that hide the real field are out of reach.
- LanguageTool’s public API is the free tier. Premium-only rules are not returned.
- Some custom editors reject an inserted suggestion. Redline uses the browser’s editing commands so undo usually still works.
- The dictionary is one list for this browser, not a separate list per site.

## License

No license has been chosen yet. Until a `LICENSE` file is added, all rights belong to the copyright holder. Do not assume this project is open source.
