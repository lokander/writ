// Renders task description markdown to safe HTML for `{@html ...}` mounting.
//
// Safety: `html: false` strips raw HTML at parse time, so the output never
// contains script/iframe/etc. tags — no separate sanitizer pass needed.
// markdown-it's default `validateLink` already rejects javascript: and data:
// URIs (except for embedded images, which we don't allow because html:false).
//
// Features enabled:
// - GFM essentials via core: tables, fenced code blocks, ordered/unordered
//   lists, inline code.
// - linkify: bare URLs become clickable links.
// Skipped: strikethrough (would need a plugin), syntax highlighting (separate
// follow-up if it comes up), live preview during edit.

import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
});

// Override the link_open rule to add target="_blank" rel="noopener noreferrer"
// to every emitted <a>. In Electron, a plain `<a href="…">` navigates the
// renderer to that URL — replacing the writ UI with an external page. With
// target="_blank", clicks trigger window.open semantics, which fires the
// `setWindowOpenHandler` registered in main/index.ts → opens in the OS
// browser instead. (writ task Z84ASQ.)
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

// Inline `<code>SHORTID</code>` (or `<code>FULL_ULID</code>`) becomes an
// `<a class="task-link" data-task-id="…">…</a>`. The host (TaskEditModal)
// installs a delegated click handler that resolves the data-task-id
// against writState.tasks and routes through onSwitch.
//
// Matching the closing tag exactly (`</code>`) means fenced code BLOCKS
// don't get touched — markdown-it emits those as `<pre><code class="…">`,
// so the class attribute breaks this regex. That's deliberate: an id-looking
// substring inside a code sample shouldn't behave as a link.
const TASK_ID_CODE_RE = /<code>([A-Z0-9]{6}|[0-9A-Z]{26})<\/code>/g;

function linkifyTaskIds(html: string): string {
  return html.replace(TASK_ID_CODE_RE, '<a class="task-link" data-task-id="$1">$1</a>');
}

export function renderMarkdown(input: string): string {
  return linkifyTaskIds(md.render(input));
}
