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

import { expect, type Locator, type Page } from '@playwright/test';

import { CODING_AGENTS, type CodingAgent, SELECTORS, TIMEOUTS } from '/@/model/core/types';
import { waitForNavigationReady } from '/@/utils/app-ready';

import { BasePage } from './base-page';

export interface AgentModelPair {
  agent: CodingAgent;
  modelLabel: string;
}

export class GuidedSetupPage extends BasePage {
  readonly welcomePage: Locator;
  readonly startGuidedSetupButton: Locator;
  readonly dialog: Locator;
  readonly wizardStepper: Locator;
  readonly agentSelector: Locator;
  readonly backButton: Locator;
  readonly skipButton: Locator;
  readonly continueButton: Locator;

  constructor(page: Page) {
    super(page);
    this.welcomePage = page.locator(SELECTORS.WELCOME_PAGE).first();
    this.startGuidedSetupButton = page.getByRole('button', { name: 'Start guided setup', exact: true });
    this.dialog = page.getByRole('dialog', { name: 'Guided Setup' });
    this.wizardStepper = this.dialog.getByLabel('Wizard progress');
    this.agentSelector = this.dialog.getByRole('listbox', { name: 'Coding agent' });
    this.backButton = this.dialog.getByRole('button', { name: 'Back', exact: true });
    this.skipButton = this.dialog.getByRole('button', { name: 'Skip', exact: true });
    this.continueButton = this.dialog.getByRole('button', { name: /Go to Dashboard|Continue/ });
  }

  async waitForLoad(): Promise<void> {
    await this.expectLoaded();
  }

  async waitForWelcomeFooterReady(): Promise<void> {
    const skipButton = this.page.getByRole('button', { name: 'Skip', exact: true });
    const readyButton = this.startGuidedSetupButton.or(skipButton);
    await expect(readyButton.first()).toBeEnabled({ timeout: 60_000 });
  }

  async startFromWelcome(): Promise<void> {
    await expect(this.welcomePage).toBeVisible({ timeout: TIMEOUTS.STANDARD });
    await this.waitForWelcomeFooterReady();
    await expect(this.startGuidedSetupButton).toBeEnabled();
    await this.startGuidedSetupButton.click();
    await this.expectLoaded();
  }

  async expectLoaded(): Promise<void> {
    await expect(this.dialog).toBeVisible({ timeout: TIMEOUTS.STANDARD });
    await expect(this.wizardStepper).toBeVisible();
    await expect(this.agentSelector).toBeVisible();
  }

  getAgentCard(agent: CodingAgent): Locator {
    return this.agentSelector
      .locator('button[role="option"]')
      .filter({ has: this.page.getByText(agent, { exact: true }) });
  }

  async selectAgent(agent: CodingAgent): Promise<void> {
    const card = this.getAgentCard(agent);
    await expect(card).toBeVisible();
    if ((await card.getAttribute('aria-selected')) !== 'true') {
      await card.click();
    }
    await expect(card).toHaveAttribute('aria-selected', 'true');
  }

  getModelTableRows(): Locator {
    return this.dialog.locator('[data-testid^="model-row-"]');
  }

  async waitForModelCatalog(timeout: number = TIMEOUTS.DEFAULT): Promise<void> {
    await expect
      .poll(async () => await this.getModelTableRows().count(), {
        timeout,
        intervals: [500, 1_000, 2_000],
        message: 'Model catalog did not populate in guided setup',
      })
      .toBeGreaterThan(0);
  }

  async getModelLabels(): Promise<string[]> {
    const rows = this.getModelTableRows();
    const count = await rows.count();
    const labels: string[] = [];
    for (let i = 0; i < count; i++) {
      const testId = await rows.nth(i).getAttribute('data-testid');
      if (testId?.startsWith('model-row-')) {
        labels.push(testId.slice('model-row-'.length));
      }
    }
    return labels;
  }

  getModelRow(modelLabel: string): Locator {
    return this.dialog.getByTestId(`model-row-${modelLabel}`);
  }

  async selectModelByLabel(modelLabel: string): Promise<void> {
    const row = this.getModelRow(modelLabel);
    await expect(row).toBeVisible();
    const radio = row.locator('input[name="modelSelection"]');
    if (!(await radio.isChecked())) {
      await radio.click();
    }
    await expect(radio).toBeChecked();
    await expect(this.dialog.getByTestId('selected-model')).toHaveText(`Selected: ${modelLabel}`);
  }

  async getSelectedModelLabel(): Promise<string> {
    const selected = this.dialog.getByTestId('selected-model');
    await expect(selected).toBeVisible();
    const text = await selected.textContent();
    return text?.replace(/^Selected:\s*/, '').trim() ?? '';
  }

  async expectDefaultModelHeading(agent: CodingAgent): Promise<void> {
    await expect(this.dialog.getByText(new RegExp(`Choose the default model ${agent} should use`))).toBeVisible();
  }

  async expectBackDisabled(): Promise<void> {
    await expect(this.backButton).toBeDisabled();
  }

  get providerPicker(): Locator {
    return this.dialog.getByTestId('provider-picker');
  }

  getProviderOption(providerName: string): Locator {
    return this.providerPicker.getByRole('button', { name: `Select ${providerName}`, exact: true });
  }

  getProviderOptionById(providerId: string): Locator {
    return this.dialog.getByTestId(`provider-option-${providerId}`);
  }

  async expectProviderSelected(providerName: string, providerId = 'claude'): Promise<void> {
    await expect(this.providerPicker).toBeVisible();
    await expect(this.getProviderOptionById(providerId)).toHaveAttribute('data-selected', 'true');
    await expect(this.getProviderOption(providerName)).toBeVisible();
    await expect(this.dialog.getByTestId('inline-connection-form')).toBeVisible();
  }

  async complete(): Promise<void> {
    await expect(this.continueButton).toBeEnabled();
    await this.continueButton.click();
    await expect(this.dialog).toBeHidden({ timeout: TIMEOUTS.STANDARD });
    await expect(this.welcomePage).toBeHidden({ timeout: TIMEOUTS.STANDARD });
    await waitForNavigationReady(this.page);
  }

  async skip(): Promise<void> {
    await expect(this.skipButton).toBeEnabled();
    await this.skipButton.click();
    await expect(this.dialog).toBeHidden({ timeout: TIMEOUTS.STANDARD });
    await expect(this.welcomePage).toBeHidden({ timeout: TIMEOUTS.STANDARD });
    await waitForNavigationReady(this.page);
  }

  async discoverAgentModelPairs(): Promise<AgentModelPair[]> {
    const pairs: AgentModelPair[] = [];

    for (const agent of CODING_AGENTS) {
      const card = this.getAgentCard(agent);
      if (!(await card.isVisible())) {
        continue;
      }
      await this.selectAgent(agent);
      try {
        await this.waitForModelCatalog(TIMEOUTS.STANDARD);
      } catch {
        continue;
      }
      const modelLabels = await this.getModelLabels();
      for (const modelLabel of modelLabels) {
        pairs.push({ agent, modelLabel });
      }
    }

    return pairs;
  }
}
