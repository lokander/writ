import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown linkifyTaskIds", () => {
  it("turns a backticked 6-char id into a task-link anchor", () => {
    const html = renderMarkdown("see `XP59D5` for context");
    expect(html).toContain('<a class="task-link" data-task-id="XP59D5">XP59D5</a>');
    expect(html).not.toContain("<code>XP59D5</code>");
  });

  it("turns a backticked full 26-char ulid into a task-link anchor", () => {
    const id = "01KR9D2QNAFRFJN49MFF4STV92";
    const html = renderMarkdown(`reference \`${id}\``);
    expect(html).toContain(`<a class="task-link" data-task-id="${id}">${id}</a>`);
  });

  it("leaves bare task-id-shaped tokens in prose alone (only backticked refs link)", () => {
    const html = renderMarkdown("the suffix XP59D5 here");
    expect(html).not.toContain("task-link");
    expect(html).toContain("XP59D5");
  });

  it("does not linkify ids inside fenced code blocks", () => {
    const html = renderMarkdown("```\nXP59D5\n```");
    expect(html).not.toContain("task-link");
  });

  it("does not match 5- or 7-char backticked strings", () => {
    const html = renderMarkdown("`SHORT` and `TOOLONG` and `XP59D5`");
    // Exactly one task-link from XP59D5.
    expect(html.match(/task-link/g)?.length).toBe(1);
    expect(html).toContain("<code>SHORT</code>");
    expect(html).toContain("<code>TOOLONG</code>");
  });

  it("linkifies multiple references in the same description", () => {
    const html = renderMarkdown("see `AAAAAA` and also `BBBBBB`");
    expect(html).toContain('data-task-id="AAAAAA"');
    expect(html).toContain('data-task-id="BBBBBB"');
  });

  it("ignores lower-case backticked tokens (task ids are uppercase Crockford)", () => {
    const html = renderMarkdown("`abcdef`");
    expect(html).toContain("<code>abcdef</code>");
    expect(html).not.toContain("task-link");
  });
});
