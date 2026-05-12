<script lang="ts">
  import type { RangeTuple } from "fuse.js";

  interface Props {
    text: string;
    /** Inclusive-at-both-ends index ranges from Fuse. Empty or undefined
     *  renders the text plain. Ranges are sorted and clipped here so the
     *  consumer can pass them straight from `FuseResultMatch.indices`. */
    indices?: ReadonlyArray<RangeTuple>;
  }

  let { text, indices = [] }: Props = $props();

  const segments = $derived.by(() => {
    if (indices.length === 0) return [{ text, hit: false }];
    const parts: { text: string; hit: boolean }[] = [];
    let pos = 0;
    const sorted = [...indices].sort((a, b) => a[0] - b[0]);
    for (const [start, end] of sorted) {
      const s = Math.max(start, pos);
      if (s > pos) parts.push({ text: text.slice(pos, s), hit: false });
      const e = Math.min(end + 1, text.length);
      if (e > s) parts.push({ text: text.slice(s, e), hit: true });
      pos = e;
    }
    if (pos < text.length) parts.push({ text: text.slice(pos), hit: false });
    return parts;
  });
</script>

{#each segments as seg, i (i)}{#if seg.hit}<mark class="rounded-sm bg-warning/40 text-base-content"
      >{seg.text}</mark
    >{:else}{seg.text}{/if}{/each}
