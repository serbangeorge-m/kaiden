/**********************************************************************
 * Copyright (C) 2026 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared lifecycle for Coding Agent Workspace provider E2E tests.
 * See .agents/skills/playwright-testing/workspace-provider-e2e.md
 ***********************************************************************/

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Expect } from '@playwright/test';

import type { test as providerTest } from '/@/fixtures/provider-fixtures';
import {
  type CodingAgent,
  FILE_ACCESS_LEVEL,
  type FileAccessLevel,
  NETWORK_ACCESS_LEVEL,
  type NetworkAccessLevel,
  PROVIDERS,
  type ResourceId,
  TIMEOUTS,
  WIZARD_STEP,
  WORKSPACE_STATUS,
  type WorkspaceCustomMount,
} from '/@/model/core/types';
import type { AgentWorkspaceCreatePage } from '/@/model/pages/agent-workspace-create-page';
import { waitForNavigationReady } from '/@/utils/app-ready';

export interface WorkspaceSandboxOptions {
  fileAccess: FileAccessLevel;
  network: NetworkAccessLevel;
  customMounts?: WorkspaceCustomMount[];
  denyHosts?: string[];
  additionalHosts?: string[];
  summary: string;
}

export interface WorkspaceLifecycleConfig {
  testIdPrefix: string;
  /** Sandbox matrix scenario ID (e.g. FS-NONE-NET-DEVELOPER) for short step titles. */
  scenarioId?: string;
  workspaceName: string;
  agent: CodingAgent;
  requiredResource?: ResourceId;
  selectModel: (createPage: AgentWorkspaceCreatePage) => Promise<string | undefined>;
  terminalReadyPatterns: readonly RegExp[];
  prePrompts?: { command: string; expectedResponse: RegExp }[];
  promptTimeout?: number;
  promptTest: {
    prompt: string;
    expectedResponse: RegExp;
  };
  /** When set, configures filesystem/network wizard steps and skips stat-card assertions. */
  sandbox?: WorkspaceSandboxOptions;
  /** When false, caller owns create/delete (sandbox matrix agent scope). Default true. */
  manageResource?: boolean;
  /** When true, creates the workspace without a project folder (sourcePath left empty). */
  noProjectFolder?: boolean;
}

const SANDBOX_STEP_TITLES: Record<string, string> = {
  '01': '[01] creation',
  '02': '[02] running status check',
  '03': '[03] terminal navigation',
  '04': '[04] terminal prompt response',
  '05': '[05] sandbox policy enforced',
  '06': '[06] removal',
};

/** Allowed by the Developer Preset, blocked by Deny All. */
const PRESET_REGISTRY_HOST = 'registry.npmjs.org';
/** Never allowed by any scenario: must stay blocked. */
const BLOCKED_PROBE_HOST = 'example.com';
const SOURCES_PREFIX = '$SOURCES/';

function sandboxStepTitle(step: string): string {
  return SANDBOX_STEP_TITLES[step] ?? `[${step}] ${step}`;
}

function lifecycleStepTitle(config: WorkspaceLifecycleConfig, step: string, legacyTitle: string): string {
  if (config.sandbox && config.scenarioId) {
    return sandboxStepTitle(step);
  }
  return `[${config.testIdPrefix}-${step}] ${legacyTitle}`;
}

export function registerWorkspaceLifecycleTests(
  test: typeof providerTest,
  expect: Expect,
  config: WorkspaceLifecycleConfig,
): void {
  const podmanAvailable = !!process.env.PODMAN_ENABLED;
  const hasSandbox = config.sandbox !== undefined;

  test.skip(
    process.platform !== 'linux' && !podmanAvailable,
    'Workspace tests require Podman (set PODMAN_ENABLED=true on non-Linux)',
  );

  if (config.requiredResource) {
    const envVar = PROVIDERS[config.requiredResource].envVarName;
    test.skip(!process.env[envVar], `${envVar} not set`);
  }

  let workingDir: string | undefined;
  let mountDirs: string[] = [];
  /** Host folder of each custom mount: a temp dir for an empty host, `$SOURCES/...` under the project folder. */
  let mountHostPaths: string[] = [];
  let countsBefore: { activeSessions: number; totalSessions: number; configuredAgents: number };

  const steps = hasSandbox
    ? { terminal: '03', prompt: '04', remove: '06' }
    : { statAfterCreate: '03', terminal: '04', prompt: '05', remove: '06', statAfterRemove: '07' };

  const manageResource = config.manageResource !== false;

  test.beforeAll(async ({ workerNavigationBar }) => {
    await workerNavigationBar.ensureExtensionsRunning();

    if (manageResource && config.requiredResource) {
      const provider = PROVIDERS[config.requiredResource];
      if (!('autoDetected' in provider && provider.autoDetected)) {
        const settingsPage = await workerNavigationBar.navigateToSettingsPage();
        await settingsPage.createResource(config.requiredResource, process.env[provider.envVarName]!);
        await workerNavigationBar.navigateToWorkspacesPage();
      }
    }

    if (!config.noProjectFolder) {
      workingDir = mkdtempSync(join(homedir(), '.kdn-e2e-'));
    }

    if (
      hasSandbox &&
      config.sandbox!.fileAccess === FILE_ACCESS_LEVEL.CUSTOM_PATHS &&
      config.sandbox!.customMounts?.length
    ) {
      mountDirs = config.sandbox!.customMounts.map(mount =>
        mount.host === '' ? mkdtempSync(join(homedir(), '.kdn-e2e-mount-')) : '',
      );

      mountHostPaths = config.sandbox!.customMounts.map((mount, index) => {
        if (mount.host === '') return mountDirs[index] ?? '';
        if (mount.host.startsWith(SOURCES_PREFIX) && workingDir) {
          return join(workingDir, mount.host.slice(SOURCES_PREFIX.length));
        }
        return mount.host;
      });
      for (const [index, mount] of config.sandbox!.customMounts.entries()) {
        if (mount.host.startsWith(SOURCES_PREFIX)) {
          mkdirSync(mountHostPaths[index] ?? '', { recursive: true });
        }
      }
    }
  });

  test.afterAll(async ({ workerNavigationBar }) => {
    for (const mountDir of mountDirs) {
      if (mountDir) {
        rmSync(mountDir, { recursive: true, force: true });
      }
    }
    if (workingDir) {
      rmSync(workingDir, { recursive: true, force: true });
    }
    if (manageResource && config.requiredResource) {
      const provider = PROVIDERS[config.requiredResource];
      if (!('autoDetected' in provider && provider.autoDetected)) {
        try {
          const settingsPage = await workerNavigationBar.navigateToSettingsPage();
          await settingsPage.deleteResource(config.requiredResource);
        } catch (error) {
          console.error(`Failed to delete ${config.requiredResource} resource:`, error);
        }
      }
    }
  });

  test.beforeEach(async ({ page }) => {
    await waitForNavigationReady(page);
  });

  const createStepTitle = hasSandbox ? `Creates a workspace with ${config.sandbox!.summary}` : 'Creates a workspace';

  test(lifecycleStepTitle(config, '01', createStepTitle), async ({ navigationBar, agentWorkspacesPage }) => {
    if (hasSandbox) {
      await navigationBar.navigateToWorkspacesPage();
      await agentWorkspacesPage.removeWorkspaceIfPresent(config.workspaceName);
    } else {
      await navigationBar.navigateToWorkspacesPage();
      await navigationBar.navigateToSettingsPage();
      await navigationBar.navigateToWorkspacesPage();
      await agentWorkspacesPage.removeWorkspaceIfPresent(config.workspaceName);
      countsBefore = await agentWorkspacesPage.getStatCounts();
    }

    const createPage = await agentWorkspacesPage.openCreatePage();

    await createPage.sessionNameInput.fill(config.workspaceName);
    if (!config.noProjectFolder) {
      await createPage.workingDirInput.fill(workingDir!);
    }
    await createPage.continueToStep(WIZARD_STEP.AGENT_MODEL);

    await createPage.selectAgent(config.agent);
    await createPage.waitForModelCatalog();
    await config.selectModel(createPage);

    if (hasSandbox) {
      const customMounts =
        config.sandbox!.fileAccess === FILE_ACCESS_LEVEL.CUSTOM_PATHS && mountDirs.length
          ? config.sandbox!.customMounts!.map((mount, index) =>
              mount.host === '' ? { ...mount, host: mountDirs[index]! } : mount,
            )
          : config.sandbox!.customMounts;

      await createPage.completeSandboxWizardSteps({
        fileAccess: config.sandbox!.fileAccess,
        customMounts,
        network: config.sandbox!.network,
        denyHosts: config.sandbox!.denyHosts,
        additionalHosts: config.sandbox!.additionalHosts,
      });
      await createPage.startWorkspace();
      await agentWorkspacesPage.expectWorkspaceCreated(config.workspaceName);
    } else {
      await createPage.continueToStep(WIZARD_STEP.TOOLS_SECRETS);
      await createPage.continueToStep(WIZARD_STEP.FILE_SYSTEM);
      await createPage.continueToStep(WIZARD_STEP.NETWORKING);
      await createPage.startWorkspace();
      await expect(agentWorkspacesPage.heading).toBeVisible({ timeout: TIMEOUTS.WORKSPACE_READY });
    }
  });

  test(
    lifecycleStepTitle(config, '02', 'Workspace appears with Running status'),
    async ({ navigationBar, agentWorkspacesPage }) => {
      await navigationBar.navigateToWorkspacesPage();
      await agentWorkspacesPage.ensureRowExists(config.workspaceName, TIMEOUTS.WORKSPACE_READY);
      await agentWorkspacesPage.waitForWorkspaceStatus(
        config.workspaceName,
        WORKSPACE_STATUS.RUNNING,
        TIMEOUTS.WORKSPACE_READY,
      );
    },
  );

  if (!hasSandbox) {
    test(`[${config.testIdPrefix}-${steps.statAfterCreate}] Stat cards reflect the new workspace`, async ({
      navigationBar,
      agentWorkspacesPage,
    }) => {
      await navigationBar.navigateToWorkspacesPage();
      await agentWorkspacesPage.waitForStatCounts({
        totalSessions: countsBefore.totalSessions + 1,
        activeSessions: countsBefore.activeSessions + 1,
      });
      const countsAfter = await agentWorkspacesPage.getStatCounts();
      expect(countsAfter.configuredAgents).toBeGreaterThanOrEqual(countsBefore.configuredAgents);
    });
  }

  test(
    lifecycleStepTitle(config, steps.terminal, 'Terminal shows agent is loaded'),
    async ({ navigationBar, agentWorkspacesPage }) => {
      await navigationBar.navigateToWorkspacesPage();
      const detailsPage = await agentWorkspacesPage.openWorkspaceTerminal(config.workspaceName);
      const terminalPage = detailsPage.getTerminalPage();
      for (const pattern of config.terminalReadyPatterns) {
        await terminalPage.waitForTerminalContent(pattern, TIMEOUTS.MODEL_RESPONSE);
      }
    },
  );

  test(
    lifecycleStepTitle(config, steps.prompt, 'Sends a prompt and receives a response'),
    async ({ navigationBar, agentWorkspacesPage }) => {
      const promptTimeout = config.promptTimeout ?? TIMEOUTS.MODEL_RESPONSE;
      await navigationBar.navigateToWorkspacesPage();
      const detailsPage = await agentWorkspacesPage.openWorkspaceTerminal(config.workspaceName);
      const terminalPage = detailsPage.getTerminalPage();

      await terminalPage.waitForTerminalContent(config.terminalReadyPatterns[0]!, TIMEOUTS.MODEL_RESPONSE);

      if (config.prePrompts) {
        for (const pre of config.prePrompts) {
          await terminalPage.sendPrompt({
            prompt: pre.command,
            expectedResponse: pre.expectedResponse,
            timeout: TIMEOUTS.STANDARD,
          });
        }
      }

      await terminalPage.sendPrompt({
        prompt: config.promptTest.prompt,
        expectedResponse: config.promptTest.expectedResponse,
        timeout: promptTimeout,
      });
    },
  );

  const sandbox = config.sandbox;
  if (sandbox) {
    test(
      lifecycleStepTitle(config, '05', 'Sandbox policy is enforced'),
      async ({ navigationBar, agentWorkspacesPage }) => {
        await navigationBar.navigateToWorkspacesPage();
        // the network policy is applied at the end of creation, after the workspace already shows Running
        await agentWorkspacesPage.waitForCreationTask(config.workspaceName);
        const detailsPage = await agentWorkspacesPage.openWorkspaceDetails(config.workspaceName);
        const shell = await detailsPage.openShellTerminalTab();
        await shell.waitForTerminalContent(/\$\s*$/m, TIMEOUTS.STANDARD);

        // whether a host answers from inside the sandbox; curl reports HTTP 000 when the connection is refused
        let probe = 0;
        const reachability = async (host: string): Promise<'reachable' | 'blocked'> => {
          const tag = `HTTP${probe++}`;
          const match = await shell.runShellCommand(
            `curl -s -o /dev/null -m 8 -w '${tag}=%{http_code}\\n' https://${host}`,
            new RegExp(`${tag}=(\\d{3})`),
          );
          return match[1] === '000' ? 'blocked' : 'reachable';
        };

        const registryExpected = sandbox.network === NETWORK_ACCESS_LEVEL.DEVELOPER_PRESET ? 'reachable' : 'blocked';
        expect(await reachability(PRESET_REGISTRY_HOST), `${PRESET_REGISTRY_HOST} with ${sandbox.network}`).toBe(
          registryExpected,
        );
        expect(await reachability(BLOCKED_PROBE_HOST), `${BLOCKED_PROBE_HOST} (allowed by no scenario)`).toBe(
          'blocked',
        );
        for (const host of [...(sandbox.denyHosts ?? []), ...(sandbox.additionalHosts ?? [])]) {
          expect(await reachability(host), `${host} (allowed by this scenario)`).toBe('reachable');
        }

        if (sandbox.fileAccess !== FILE_ACCESS_LEVEL.CUSTOM_PATHS) {
          return;
        }
        for (const [index, mount] of (sandbox.customMounts ?? []).entries()) {
          const hostPath = mountHostPaths[index] ?? '';
          // a target defaults to the host path when omitted
          const sandboxPath = mount.target ? resolveSandboxTarget(mount.target) : hostPath;

          // host → sandbox: a file created on the host after creation is visible through the mount
          const fromHost = `from-host-${index}.txt`;
          writeFileSync(join(hostPath, fromHost), 'qe');
          const visible = await shell.runShellCommand(
            `test -f '${sandboxPath}/${fromHost}' && printf 'R${index}=%s\\n' yes || printf 'R${index}=%s\\n' no`,
            new RegExp(`R${index}=(yes|no)`),
          );
          const mountLabel = `mount ${index} (${hostPath} → ${sandboxPath})`;
          expect(
            visible[1] === 'yes' ? 'visible in sandbox' : 'missing in sandbox',
            `${mountLabel}: file created on the host after creation (missing = folder copied, not mounted)`,
          ).toBe('visible in sandbox');

          // sandbox → host: writes are denied on read-only mounts and reach the host on read-write ones
          const fromSandbox = `from-sandbox-${index}.txt`;
          const write = await shell.runShellCommand(
            `touch '${sandboxPath}/${fromSandbox}' 2>/dev/null && printf 'W${index}=%s\\n' ok || printf 'W${index}=%s\\n' denied`,
            new RegExp(`W${index}=(ok|denied)`),
          );
          const writeOutcome = write[1] === 'ok' ? 'write allowed' : 'write denied';
          if (mount.readOnly) {
            expect(writeOutcome, `${mountLabel}: write from the sandbox to a read-only mount`).toBe('write denied');
          } else {
            expect(writeOutcome, `${mountLabel}: write from the sandbox to a read-write mount`).toBe('write allowed');
            await expect
              .poll(() => (existsSync(join(hostPath, fromSandbox)) ? 'on host' : 'missing on host'), {
                timeout: TIMEOUTS.SHORT,
                message: `${mountLabel}: file written in the sandbox`,
              })
              .toBe('on host');
          }
        }
      },
    );
  }

  test(
    lifecycleStepTitle(config, steps.remove, 'Removes the workspace'),
    async ({ navigationBar, agentWorkspacesPage }) => {
      await navigationBar.navigateToWorkspacesPage();
      await agentWorkspacesPage.removeWorkspace(config.workspaceName);
      await expect(agentWorkspacesPage.noWorkspacesMessage.or(agentWorkspacesPage.table)).toBeVisible();
    },
  );

  if (!hasSandbox) {
    test(`[${config.testIdPrefix}-${steps.statAfterRemove}] Stat cards reflect workspace removal`, async ({
      navigationBar,
      agentWorkspacesPage,
    }) => {
      await navigationBar.navigateToWorkspacesPage();
      await agentWorkspacesPage.waitForStatCounts({
        totalSessions: countsBefore.totalSessions,
        activeSessions: countsBefore.activeSessions,
      });
    });
  }
}

/** Path inside the sandbox of a mount target; `$SOURCES/...` targets live under /sandbox. */
function resolveSandboxTarget(target: string): string {
  return target.startsWith(SOURCES_PREFIX) ? `/sandbox/${target.slice(SOURCES_PREFIX.length)}` : target;
}
