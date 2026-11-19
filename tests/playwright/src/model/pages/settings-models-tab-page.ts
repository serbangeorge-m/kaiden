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

import { BasePage } from './base-page';

// Category nav label -> subtitle shown in the Models header once that category is active.
const MODEL_CATEGORIES = {
  'LLM Providers': 'API keys for hosted providers',
  'In-house': 'In-house · OpenShift AI & models',
  Local: 'Host detection & loaded models',
  'Semantic Routers': 'Intelligent request routers across multiple backends',
} as const;

export type ModelCategory = keyof typeof MODEL_CATEGORIES;

export class SettingsModelsPage extends BasePage {
  readonly modelsRegion: Locator;
  readonly searchInput: Locator;
  readonly categoryNav: Locator;
  readonly modelsTable: Locator;
  readonly filteredEmptyMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.modelsRegion = page.getByRole('region', { name: 'Models' });
    this.searchInput = this.modelsRegion.getByRole('textbox', { name: 'search Models' });
    this.categoryNav = page.getByRole('navigation', { name: 'Model categories' });
    this.modelsTable = page.getByRole('table', { name: 'models' });
    this.filteredEmptyMessage = page.getByRole('heading', { name: /No models matching/ });
  }

  async waitForLoad(): Promise<void> {
    await expect(this.modelsRegion).toBeVisible();
  }

  async selectCategory(category: ModelCategory): Promise<void> {
    await this.categoryNav.getByRole('link', { name: category, exact: true }).click();
    await expect(this.modelsRegion.getByText(MODEL_CATEGORIES[category], { exact: true })).toBeVisible();
  }

  // A model row. Pass providerName to match only that provider's row (its Runtime cell carries the name as a title).
  getModelRow(label: string, providerName?: string): Locator {
    const row = this.modelsTable.getByRole('row').filter({ has: this.page.getByTitle(label, { exact: true }) });
    return providerName ? row.filter({ has: this.page.getByTitle(providerName, { exact: true }) }) : row;
  }

  // Model names listed for one provider, in table order. Cells are located by column header because
  // other columns (e.g. Status) also carry title attributes.
  async getModelLabels(providerName: string): Promise<string[]> {
    return this.modelsTable.evaluate((table, provider) => {
      const headers = Array.from(table.querySelectorAll('[role="columnheader"]'), header =>
        header.textContent?.trim().toLowerCase(),
      );
      const nameIndex = headers.indexOf('name');
      const runtimeIndex = headers.indexOf('runtime');
      const labels: string[] = [];
      for (const row of table.querySelectorAll('[role="row"]')) {
        const cells = row.querySelectorAll('[role="cell"]');
        const label = cells[nameIndex]?.querySelector('[title]')?.getAttribute('title');
        const runtime = cells[runtimeIndex]?.querySelector('[title]')?.getAttribute('title');
        if (label && runtime === provider) {
          labels.push(label);
        }
      }
      return labels;
    }, providerName);
  }

  // Provider connection cards have no accessible role; match the card by its provider name.
  getProviderCard(providerName: string): Locator {
    return this.page.locator('.provider-tile').filter({ has: this.page.getByText(providerName, { exact: true }) });
  }

  // Status badge on a provider card, e.g. 'Connected' or 'Not configured'.
  getProviderCardStatus(providerName: string, status: string): Locator {
    return this.getProviderCard(providerName).getByText(status, { exact: true });
  }

  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
    await expect(this.searchInput).toHaveValue(term);
  }

  async clearSearch(): Promise<void> {
    await this.searchInput.clear();
    await expect(this.searchInput).toHaveValue('');
  }
}
