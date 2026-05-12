<script lang="ts">
  import {
    ArrowSquareOutIcon,
    BugIcon,
    GithubLogoIcon,
    HeadCircuitIcon,
    XIcon,
  } from "phosphor-svelte";

  import Modal from "./Modal.svelte";

  interface Props {
    onClose: () => void;
  }

  const { onClose }: Props = $props();

  const REPO_URL = "https://github.com/lokander/writ";
  const ISSUES_URL = `${REPO_URL}/issues/new`;

  // process.versions.electron is exposed through @electron-toolkit/preload's
  // electronAPI on `window.electron`. Captured at module load so the dialog
  // doesn't reach for it on every render.
  const electronVersion = window.electron.process.versions.electron ?? "unknown";

  // Esc closes. Backdrop click and the X button do the same. There's no
  // discard-edit path here — the About dialog is read-only — so all three
  // route straight to onClose.
  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<Modal ariaLabelledBy="about-dialog-title" onBackdropClick={onClose}>
  <div class="modal-box w-[28rem] max-w-none">
    <div class="mb-4 flex items-start justify-between gap-3">
      <div class="flex items-center gap-3">
        <HeadCircuitIcon size={36} weight="duotone" class="opacity-80" />
        <div>
          <h2 id="about-dialog-title" class="text-2xl font-semibold leading-tight">writ</h2>
          <p class="font-mono text-xs opacity-60">
            v{__APP_VERSION__} · <span class="select-text">{__APP_COMMIT__}</span>
          </p>
        </div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" aria-label="Close" onclick={onClose}>
        <XIcon size={16} weight="bold" />
      </button>
    </div>

    <p class="mb-6 text-sm opacity-80">{__APP_DESCRIPTION__}</p>

    <dl class="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
      <dt class="opacity-60">Electron</dt>
      <dd class="font-mono">{electronVersion}</dd>
    </dl>

    <!-- target="_blank" routes through the main process's setWindowOpenHandler,
         which hands http(s) URLs to shell.openExternal and denies the rest.
         No renderer-side IPC needed. -->
    <div class="flex flex-col gap-2">
      <a href={REPO_URL} target="_blank" rel="noopener" class="btn btn-sm btn-soft gap-2">
        <GithubLogoIcon size={14} weight="bold" />
        <span class="flex-1 text-left">View on GitHub</span>
        <ArrowSquareOutIcon size={12} weight="bold" class="opacity-60" />
      </a>
      <a href={ISSUES_URL} target="_blank" rel="noopener" class="btn btn-sm btn-soft gap-2">
        <BugIcon size={14} weight="bold" />
        <span class="flex-1 text-left">Report a bug</span>
        <ArrowSquareOutIcon size={12} weight="bold" class="opacity-60" />
      </a>
    </div>
  </div>
</Modal>
