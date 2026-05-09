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

export function renderMarkdown(input: string): string {
  return md.render(input);
}
