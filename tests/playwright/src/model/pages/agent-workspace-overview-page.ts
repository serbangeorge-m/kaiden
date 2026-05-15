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

export interface OverviewExpectations {
  agentName?: string;
  model?: string;
  project?: string;
  status?: string;
  runtime?: string;
  network?: string;
  sandboxBadge?: string;
  skillsCount?: number;
  mcpServersCount?: number;
  filesystemBadge?: string;
  sourcePath?: string;
}

export class AgentWorkspaceOverviewPage extends BasePage {
  readonly tabContentRegion: Locator;

  constructor(page: Page) {
    super(page);
    this.tabContentRegion = this.page.getByRole('region', { name: 'Tab Content' });
  }

  async waitForLoad(): Promise<void> {
    await expect(this.agentName).toBeVisible();
  }

  get agentName(): Locator {
    return this.tabContentRegion.getByLabel('Agent name');
  }

  get modelLabel(): Locator {
    return this.tabContentRegion.getByLabel('Model');
  }

  get projectLabel(): Locator {
    return this.tabContentRegion.getByLabel('Project');
  }

  get sandboxBadge(): Locator {
    return this.tabContentRegion.getByLabel('Sandbox status');
  }

  getDetailValue(label: string): Locator {
    return this.tabContentRegion.getByLabel(label, { exact: true });
  }

  getCardBadge(cardName: string): Locator {
    return this.tabContentRegion.getByLabel(`${cardName} count`);
  }

  getCardRegion(cardName: string): Locator {
    return this.tabContentRegion.getByLabel(`${cardName} card`);
  }

  async verifyOverview(expected: OverviewExpectations): Promise<void> {
    if (expected.agentName) {
      await expect(this.agentName).toHaveText(expected.agentName);
    }
    if (expected.model) {
      await expect(this.modelLabel).toBeVisible();
      await expect(this.modelLabel).toContainText(expected.model);
    }
    if (expected.project) {
      await expect(this.projectLabel).toContainText(expected.project);
    }
    if (expected.sandboxBadge) {
      await expect(this.sandboxBadge).toContainText(expected.sandboxBadge);
    }
    if (expected.status) {
      await expect(this.getDetailValue('Status')).toContainText(expected.status);
    }
    if (expected.runtime) {
      await expect(this.getDetailValue('Runtime')).toContainText(expected.runtime);
    }
    if (expected.network) {
      await expect(this.getDetailValue('Network')).toContainText(expected.network);
    }
    if (expected.skillsCount !== undefined) {
      await expect(this.getCardBadge('Skills')).toHaveText(String(expected.skillsCount));
    }
    if (expected.mcpServersCount !== undefined) {
      await expect(this.getCardBadge('MCP Servers')).toHaveText(String(expected.mcpServersCount));
    }
    if (expected.filesystemBadge) {
      await expect(this.tabContentRegion.getByLabel('Filesystem mode')).toHaveText(expected.filesystemBadge);
    }
    if (expected.sourcePath) {
      await expect(this.getCardRegion('Filesystem').getByText(expected.sourcePath)).toBeVisible();
    }
  }
}
