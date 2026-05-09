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

export function renderMarkdown(input: string): string {
  return md.render(input);
}
