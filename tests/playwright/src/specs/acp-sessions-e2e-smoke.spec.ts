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
 ***********************************************************************/

import { expect, workerTest as test } from '/@/fixtures/electron-app';
import { CODING_AGENT, TIMEOUTS, WIZARD_STEP, WORKSPACE_STATUS } from '/@/model/core/types';
import { waitForNavigationReady } from '/@/utils/app-ready';

const WORKSPACE_NAME = 'acp-smoke-pr';
const MODEL_RESPONSE_TIMEOUT = 120_000;

test.skip(
  !!process.env.GITHUB_ACTIONS && process.platform !== 'linux',
  'ACP session e2e requires Podman + Ollama, only available on Linux GitHub Actions runners',
);
test.skip(!process.env.OLLAMA_ENABLED, 'OLLAMA_ENABLED not set — Ollama is required for ACP session tests');

test.describe
  .serial('ACP session round-trip', { tag: '@smoke' }, () => {
    let sessionLabel: string;

    test.beforeEach(async ({ page }) => {
      await waitForNavigationReady(page);
    });

    test('[ACP-E2E-01] Provision a workspace with OpenCode+Ollama', async ({ navigationBar, agentWorkspacesPage }) => {
      await navigationBar.ensureExtensionsRunning();
      await navigationBar.navigateToWorkspacesPage();
      await agentWorkspacesPage.removeWorkspaceIfPresent(WORKSPACE_NAME);

      const createPage = await agentWorkspacesPage.openCreatePage();
      await createPage.sessionNameInput.fill(WORKSPACE_NAME);
      await createPage.workingDirInput.fill('/tmp/acp-smoke-pr');
      await createPage.continueToStep(WIZARD_STEP.AGENT_MODEL);
      await createPage.selectAgent(CODING_AGENT.OPENCODE);
      await createPage.waitForModelCatalog();
      await createPage.searchAndSelectByRuntime('ollama', 'Ollama');
      await createPage.continueToStep(WIZARD_STEP.TOOLS_SECRETS);
      await createPage.continueToStep(WIZARD_STEP.FILE_SYSTEM);
      await createPage.continueToStep(WIZARD_STEP.NETWORKING);
      await createPage.startWorkspace();

      await agentWorkspacesPage.expectWorkspaceCreated(WORKSPACE_NAME);
      await agentWorkspacesPage.waitForWorkspaceStatus(
        WORKSPACE_NAME,
        WORKSPACE_STATUS.RUNNING,
        TIMEOUTS.WORKSPACE_READY,
      );
    });

    test('[ACP-E2E-02] Create a session and receive a model response', async ({
      navigationBar,
      agentSessionsPage,
      agentSessionDetailPage,
    }) => {
      await navigationBar.navigateToAgentsPage();
      await expect(agentSessionsPage.createButton).toBeEnabled({ timeout: TIMEOUTS.WORKSPACE_READY });

      const prompt = 'Reply with exactly the single word "pong". Do not use any tools or read any files.';
      const createDialog = await agentSessionsPage.openCreateDialog();
      await createDialog.fillPrompt(prompt);
      await agentSessionDetailPage.installTurnObserver();
      await createDialog.submit();
      await agentSessionDetailPage.markTurnSent();

      await agentSessionDetailPage.waitForLoad();
      await expect(agentSessionDetailPage.getPromptEvent(prompt)).toBeVisible();

      sessionLabel = prompt.slice(0, 40);
      await agentSessionDetailPage.waitForTurnCompletion(MODEL_RESPONSE_TIMEOUT);
      await expect(agentSessionDetailPage.getFlowText(/pong/i)).toBeVisible();
    });

    test('[ACP-E2E-03] Rename a session via the sidebar', async ({ navigationBar, agentSessionsPage }) => {
      await navigationBar.navigateToAgentsPage();
      await agentSessionsPage.sidebar.renameSession(sessionLabel, 'smoke-renamed');
      await expect(agentSessionsPage.sidebar.getSessionRow('smoke-renamed')).toBeVisible();
      sessionLabel = 'smoke-renamed';
    });

    test('[ACP-E2E-04] Search filters sessions and clearing restores the list', async ({
      navigationBar,
      agentSessionsPage,
    }) => {
      await navigationBar.navigateToAgentsPage();

      await agentSessionsPage.search(sessionLabel);
      await expect(agentSessionsPage.getSessionRowByText(sessionLabel)).toBeVisible();

      await agentSessionsPage.search('no-match-xyz');
      await expect(agentSessionsPage.filteredEmptyMessage).toBeVisible();
      await agentSessionsPage.clearFilterButton.click();
      await expect(agentSessionsPage.searchInput).toHaveValue('');
    });

    test('[ACP-E2E-05] Delete the session and clean up workspace', async ({
      navigationBar,
      agentSessionsPage,
      agentWorkspacesPage,
    }) => {
      await navigationBar.navigateToAgentsPage();
      await agentSessionsPage.sidebar.deleteSession(sessionLabel);
      await expect(agentSessionsPage.sidebar.getSessionRow(sessionLabel)).toHaveCount(0, {
        timeout: TIMEOUTS.STANDARD,
      });

      await navigationBar.navigateToWorkspacesPage();
      await agentWorkspacesPage.removeWorkspaceIfPresent(WORKSPACE_NAME);
    });
  });
