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

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test as playwrightTest } from '@playwright/test';

import { expect, guidedSetupTest as test } from '/@/fixtures/electron-app';
import { CODING_AGENT, CODING_AGENTS, type CodingAgent, SELECTORS, WIZARD_STEP } from '/@/model/core/types';
import { GuidedSetupPage } from '/@/model/pages/guided-setup-page';

const ollamaAvailable = !!process.env.OLLAMA_ENABLED;

const candidateModels = [process.env.INFERENCE_MODEL ?? 'granite3.2:2b', process.env.INFERENCE_SECOND_MODEL].filter(
  (model): model is string => Boolean(model),
);

function agentSlug(agent: CodingAgent): string {
  return agent.replace(/\s+/g, '-').toLowerCase();
}

test.describe('Guided setup - welcome entry', { tag: '@smoke' }, () => {
  test.skip(!ollamaAvailable, 'Guided setup persistence requires Ollama models in CI');

  test('[GS-WELCOME-01] Fresh launch shows welcome with Start guided setup enabled', async ({ page }) => {
    const guidedSetup = new GuidedSetupPage(page);
    await expect(guidedSetup.welcomePage).toBeVisible();
    await guidedSetup.waitForWelcomeFooterReady();
    await expect(guidedSetup.startGuidedSetupButton).toBeEnabled();
  });
});

test.describe('Guided setup - flow', { tag: '@smoke' }, () => {
  test.skip(!ollamaAvailable, 'Guided setup persistence requires Ollama models in CI');

  test('[GS-FLOW-01] Opens guided setup with agent cards and model catalog', async ({ page }) => {
    const guidedSetup = new GuidedSetupPage(page);
    await guidedSetup.startFromWelcome();
    await expect(guidedSetup.wizardStepper.getByText('Coding agent')).toBeVisible();
    for (const agent of CODING_AGENTS) {
      const card = guidedSetup.getAgentCard(agent);
      if (await card.isVisible()) {
        await expect(card).toBeVisible();
      }
    }
    await guidedSetup.waitForModelCatalog();
  });

  test('[GS-FLOW-02] Completes guided setup and lands on dashboard', async ({ page }) => {
    const guidedSetup = new GuidedSetupPage(page);
    await guidedSetup.startFromWelcome();
    await guidedSetup.selectAgent(CODING_AGENT.OPENCODE);
    await guidedSetup.waitForModelCatalog();
    const modelLabels = await guidedSetup.getModelLabels();
    playwrightTest.skip(modelLabels.length === 0, 'No compatible models available');
    const firstModel = modelLabels[0];
    if (!firstModel) {
      playwrightTest.skip(true, 'No compatible models available');
    }
    await guidedSetup.selectModelByLabel(firstModel);
    await guidedSetup.complete();
    await expect(page.getByRole(SELECTORS.NAVIGATION.role, { name: SELECTORS.NAVIGATION.name })).toBeVisible();
  });

  test('[GS-FLOW-03] Skip does not persist agent and model selections', async ({
    page,
    navigationBar,
    agentWorkspacesPage,
  }) => {
    const guidedSetup = new GuidedSetupPage(page);
    await guidedSetup.startFromWelcome();
    const gooseCard = guidedSetup.getAgentCard(CODING_AGENT.GOOSE);
    playwrightTest.skip(!(await gooseCard.isVisible()), 'Goose is not available in this environment');
    await guidedSetup.selectAgent(CODING_AGENT.GOOSE);
    await guidedSetup.waitForModelCatalog();
    const modelLabels = await guidedSetup.getModelLabels();
    playwrightTest.skip(modelLabels.length === 0, 'No compatible models for Goose');
    const skippedModel = modelLabels[0];
    if (!skippedModel) {
      playwrightTest.skip(true, 'No compatible models for Goose');
    }
    await guidedSetup.selectModelByLabel(skippedModel);
    await guidedSetup.skip();

    await navigationBar.navigateToWorkspacesPage();
    const createPage = await agentWorkspacesPage.openCreatePage();
    await createPage.workingDirInput.fill('/tmp/guided-setup-skip-test');
    await createPage.navigateToStep(WIZARD_STEP.AGENT_MODEL);
    await createPage.expectAgentSelected(CODING_AGENT.OPENCODE);
    const selectedModel = await createPage.getSelectedModelLabel();
    expect(selectedModel).not.toBe(skippedModel);
  });

  test('[GS-FLOW-04] Back is disabled and agent change updates model section', async ({ page }) => {
    const guidedSetup = new GuidedSetupPage(page);
    await guidedSetup.startFromWelcome();
    await guidedSetup.expectBackDisabled();
    await guidedSetup.selectAgent(CODING_AGENT.OPENCODE);
    await guidedSetup.expectDefaultModelHeading(CODING_AGENT.OPENCODE);
    await guidedSetup.waitForModelCatalog();

    const gooseCard = guidedSetup.getAgentCard(CODING_AGENT.GOOSE);
    if (await gooseCard.isVisible()) {
      await guidedSetup.selectAgent(CODING_AGENT.GOOSE);
      await guidedSetup.expectDefaultModelHeading(CODING_AGENT.GOOSE);
    }
  });
});

test.describe('Guided setup - Claude provider picker', { tag: '@smoke' }, () => {
  test('[GS-FLOW-05] Selecting Claude Code auto-selects Claude over Vertex AI', async ({ page }) => {
    const guidedSetup = new GuidedSetupPage(page);
    await guidedSetup.startFromWelcome();
    await guidedSetup.selectAgent(CODING_AGENT.CLAUDE);

    const providerPicker = guidedSetup.providerPicker;
    playwrightTest.skip(!(await providerPicker.isVisible()), 'Claude and Vertex AI providers are not available');

    await expect(guidedSetup.getProviderOptionById('vertex-ai')).toBeVisible();
    await guidedSetup.expectProviderSelected('Claude');
  });
});

test.describe('Guided setup - discovery', { tag: '@smoke' }, () => {
  test.skip(!ollamaAvailable, 'Guided setup persistence requires Ollama models in CI');

  test('[GS-DISCOVER-01] Discovers agent-model pairs from guided setup', async ({ page }) => {
    const guidedSetup = new GuidedSetupPage(page);
    await guidedSetup.startFromWelcome();
    const pairs = await guidedSetup.discoverAgentModelPairs();
    expect(pairs.length, 'Expected at least one agent-model pair').toBeGreaterThan(0);
  });
});

test.describe('Guided setup - persistence', { tag: '@smoke' }, () => {
  test.skip(!ollamaAvailable, 'Guided setup persistence requires Ollama models in CI');

  for (const agent of CODING_AGENTS) {
    for (const modelLabel of candidateModels) {
      test(`[GS-PERSIST] ${agent} + ${modelLabel}`, async ({ page, navigationBar, agentWorkspacesPage }) => {
        const guidedSetup = new GuidedSetupPage(page);
        await guidedSetup.startFromWelcome();
        const card = guidedSetup.getAgentCard(agent);
        playwrightTest.skip(!(await card.isVisible()), `${agent} is not available in this environment`);
        await guidedSetup.selectAgent(agent);
        try {
          await guidedSetup.waitForModelCatalog();
        } catch {
          playwrightTest.skip(true, `No compatible models for ${agent}`);
        }
        playwrightTest.skip(
          !(await guidedSetup.getModelRow(modelLabel).isVisible()),
          `${modelLabel} is not compatible with ${agent}`,
        );

        await guidedSetup.selectModelByLabel(modelLabel);
        await guidedSetup.complete();

        await navigationBar.navigateToWorkspacesPage();
        const createPage = await agentWorkspacesPage.openCreatePage();
        await createPage.workingDirInput.fill('/tmp/guided-setup-test');
        await createPage.navigateToStep(WIZARD_STEP.AGENT_MODEL);
        await createPage.expectAgentSelected(agent);
        await createPage.expectModelSelected(modelLabel);
      });
    }

    test(`[GS-PERSIST-${agentSlug(agent)}] first available compatible model`, async ({
      page,
      navigationBar,
      agentWorkspacesPage,
    }) => {
      const guidedSetup = new GuidedSetupPage(page);
      await guidedSetup.startFromWelcome();
      const card = guidedSetup.getAgentCard(agent);
      playwrightTest.skip(!(await card.isVisible()), `${agent} is not available in this environment`);
      await guidedSetup.selectAgent(agent);
      await guidedSetup.waitForModelCatalog();
      const modelLabels = await guidedSetup.getModelLabels();
      playwrightTest.skip(modelLabels.length === 0, `No compatible models for ${agent}`);

      const uncoveredModel = modelLabels.find(label => !candidateModels.includes(label)) ?? modelLabels[0];
      if (!uncoveredModel) {
        playwrightTest.skip(true, `No compatible models for ${agent}`);
      }
      await guidedSetup.selectModelByLabel(uncoveredModel);
      await guidedSetup.complete();

      await navigationBar.navigateToWorkspacesPage();
      const createPage = await agentWorkspacesPage.openCreatePage();
      await createPage.workingDirInput.fill('/tmp/guided-setup-test');
      await createPage.navigateToStep(WIZARD_STEP.AGENT_MODEL);
      await createPage.expectAgentSelected(agent);
      await createPage.expectModelSelected(uncoveredModel);
    });
  }
});

test.describe('Guided setup - use defaults shortcut', { tag: '@smoke' }, () => {
  test.skip(!ollamaAvailable, 'Guided setup persistence requires Ollama models in CI');

  for (const agent of CODING_AGENTS) {
    test(`[GS-DEFAULTS-${agentSlug(agent)}] Use all defaults creates workspace with persisted agent`, async ({
      page,
      navigationBar,
      agentWorkspacesPage,
    }) => {
      const guidedSetup = new GuidedSetupPage(page);
      await guidedSetup.startFromWelcome();
      const card = guidedSetup.getAgentCard(agent);
      playwrightTest.skip(!(await card.isVisible()), `${agent} is not available in this environment`);
      await guidedSetup.selectAgent(agent);
      await guidedSetup.waitForModelCatalog();
      const modelLabels = await guidedSetup.getModelLabels();
      playwrightTest.skip(modelLabels.length === 0, `No compatible models for ${agent}`);
      const defaultModel = modelLabels[0];
      if (!defaultModel) {
        playwrightTest.skip(true, `No compatible models for ${agent}`);
      }
      await guidedSetup.selectModelByLabel(defaultModel);
      await guidedSetup.complete();

      const workspaceName = `gs-defaults-${agentSlug(agent)}-${Date.now()}`;
      const workingDir = mkdtempSync(join(tmpdir(), 'kaiden-gs-'));

      await navigationBar.navigateToWorkspacesPage();
      const createPage = await agentWorkspacesPage.openCreatePage();
      await createPage.sessionNameInput.fill(workspaceName);
      await createPage.workingDirInput.fill(workingDir);
      await createPage.startWithDefaults();

      await expect(agentWorkspacesPage.table).toBeVisible();
      const row = await agentWorkspacesPage.getRowLocatorByName(workspaceName);
      await expect(row).toBeVisible();
    });
  }
});
