<script lang="ts">
import { Button, Input, SettingsNavItem } from '@podman-desktop/ui-svelte';
import { router } from 'tinro';

import type { AgentWorkspaceSummaryUI } from '/@/stores/agent-workspaces.svelte';
import type { AgentWorkspaceConfiguration } from '/@api/agent-workspace-info';

type SettingsSection = 'general' | 'skills' | 'mcp' | 'knowledge' | 'file-access' | 'network' | 'advanced';

interface SectionConfig {
  id: SettingsSection;
  label: string;
}

interface Props {
  workspaceId: string;
  workspaceSummary: AgentWorkspaceSummaryUI | undefined;
  configuration: AgentWorkspaceConfiguration;
}

let { workspaceId, workspaceSummary, configuration = $bindable() }: Props = $props();

const sections: SectionConfig[] = [
  { id: 'general', label: 'General' },
  { id: 'skills', label: 'Agent Skills' },
  { id: 'mcp', label: 'MCP Servers' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'file-access', label: 'File Access' },
  { id: 'network', label: 'Network' },
  { id: 'advanced', label: 'Advanced' },
];

let activeSection: SettingsSection = $state('general');
const activeLabel = $derived(sections.find(s => s.id === activeSection)?.label ?? '');

const originalName = $derived(workspaceSummary?.name ?? '');
let workspaceName = $state(originalName);
const hasChanges = $derived(workspaceName.trim() !== originalName && workspaceName.trim().length > 0);

async function saveChanges(): Promise<void> {
  const trimmed = workspaceName.trim();
  if (!trimmed || trimmed === originalName) return;
  try {
    await window.updateAgentWorkspaceSummary(workspaceId, { name: trimmed });
  } catch (err: unknown) {
    await window.showMessageBox({
      title: 'Agent Workspace',
      type: 'error',
      message: `Failed to save workspace settings: ${err instanceof Error ? err.message : String(err)}`,
      buttons: ['OK'],
    });
  }
}

function discardChanges(): void {
  workspaceName = originalName;
}
</script>

<div class="flex flex-row w-full h-full">
  <nav
    class="z-1 w-leftsidebar min-w-leftsidebar flex flex-col bg-[var(--pd-secondary-nav-bg)] border-[var(--pd-global-nav-bg-border)] border-r-[1px]"
    aria-label="Settings sections">
    <div class="pt-4 px-3 mb-5">
      <p class="text-xl font-semibold text-[color:var(--pd-secondary-nav-header-text)] border-l-[4px] border-transparent">
        Settings
      </p>
    </div>
    <div class="h-full overflow-y-auto" style="margin-bottom:auto">
      {#each sections as section (section.id)}
        <SettingsNavItem
          title={section.label}
          href={$router.path}
          selected={activeSection === section.id}
          onClick={(): void => {
            activeSection = section.id;
          }} />
      {/each}
    </div>
  </nav>

  <div class="flex flex-col flex-1 min-w-0 h-full bg-[var(--pd-content-bg)]">
    <div class="flex flex-row items-center gap-3 px-8 py-3 bg-[var(--pd-content-card-bg)] border-b border-[var(--pd-content-card-border)]">
      <span class="text-sm text-[var(--pd-content-text)]">{hasChanges ? 'You have unsaved changes' : 'No changes to save'}</span>
      <div class="flex flex-row gap-2 ml-auto">
        <Button type="secondary" onclick={discardChanges} disabled={!hasChanges}>Discard changes</Button>
        <Button onclick={saveChanges} disabled={!hasChanges}>Save changes</Button>
      </div>
    </div>
    <div class="p-8 overflow-auto h-full">
      <div class="max-w-[800px]">
        <h2 class="text-xl font-semibold text-[var(--pd-content-header)] mb-2">{activeLabel}</h2>

        {#if activeSection === 'general'}
          <p class="text-sm text-[var(--pd-content-text)] mb-7">
            Configure the basic settings for your workspace.
          </p>

          <div class="flex flex-col gap-5">
            <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] rounded-lg p-6">
              <div class="mb-5">
                <h3 class="text-[15px] font-semibold text-[var(--pd-content-card-header-text)] mb-1">Workspace Information</h3>
                <p class="text-[13px] text-[var(--pd-content-text)] opacity-60 m-0">Basic details about this workspace</p>
              </div>
              <div class="flex flex-col gap-5">
                <div class="flex flex-col gap-2">
                  <label for="input-workspace-name" class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)]">Workspace Name</label>
                  <Input
                    id="input-workspace-name"
                    aria-label="Workspace Name"
                    bind:value={workspaceName} />
                </div>
                <div class="flex flex-col gap-2">
                  <label for="input-working-directory" class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)]">Working Directory</label>
                  <Input
                    id="input-working-directory"
                    aria-label="Working Directory"
                    value={workspaceSummary?.paths.source ?? ''}
                    readonly />
                  <p class="text-[12px] text-[var(--pd-content-text)] opacity-50 m-0">The directory where the agent will operate</p>
                </div>
              </div>
            </div>
          </div>

        {:else}
          <p class="text-sm text-[var(--pd-content-text)] mb-7">
            Configure {activeLabel.toLowerCase()} settings for this workspace.
          </p>
          <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] rounded-lg p-6">
            <p class="text-sm text-[var(--pd-content-text)] opacity-60">
              {activeLabel} settings will be available in a future update.
            </p>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
