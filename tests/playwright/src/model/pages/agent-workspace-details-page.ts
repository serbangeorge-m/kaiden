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
import { TIMEOUTS } from 'src/model/core/types';

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

export class AgentWorkspaceDetailsPage extends BasePage {
  readonly header: Locator;
  readonly pageTabsRegion: Locator;
  readonly tabContentRegion: Locator;
  readonly overviewTabLink: Locator;
  readonly terminalTabLink: Locator;
  readonly terminalContainer: Locator;
  readonly emptyTerminalMessage: Locator;
  readonly removeButton: Locator;

  constructor(page: Page) {
    super(page);
    this.header = this.page.getByRole('region', { name: 'header' });
    this.pageTabsRegion = this.page.getByRole('region', { name: 'Tabs' });
    this.tabContentRegion = this.page.getByRole('region', { name: 'Tab Content' });
    this.overviewTabLink = this.pageTabsRegion.getByRole('link', { name: 'Overview' });
    this.terminalTabLink = this.pageTabsRegion.getByRole('link', { name: 'Terminal' });
    this.terminalContainer = this.tabContentRegion.locator('.xterm-rows');
    this.emptyTerminalMessage = this.tabContentRegion.getByText('Workspace is not running');
    this.removeButton = this.header.getByRole('button', { name: 'Remove Workspace' });
  }

  async waitForLoad(): Promise<void> {
    await expect(this.header).toBeVisible({ timeout: TIMEOUTS.PAGE_LOAD });
    await expect(this.pageTabsRegion).toBeVisible();
  }

  async openOverviewTab(): Promise<void> {
    await expect(this.overviewTabLink).toBeVisible();
    await this.overviewTabLink.click();
  }

  async openTerminalTab(): Promise<void> {
    await expect(this.terminalTabLink).toBeVisible();
    await this.terminalTabLink.click();
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

  async waitForTerminalContent(
    textOrRegex: string | RegExp,
    timeout: number = TIMEOUTS.WORKSPACE_READY,
  ): Promise<void> {
    await expect(this.terminalContainer).toContainText(textOrRegex, { timeout });
  }

  async getTerminalText(): Promise<string> {
    return (await this.terminalContainer.textContent()) ?? '';
  }

  async sendPrompt(prompt: string): Promise<void> {
    const textarea = this.tabContentRegion.locator('textarea.xterm-helper-textarea');
    await expect(textarea).toBeAttached({ timeout: TIMEOUTS.SHORT });
    await textarea.evaluate(el => (el as HTMLTextAreaElement).focus());

    const contentBefore = await this.getTerminalText();
    await this.page.keyboard.type(prompt, { delay: 50 });
    await expect
      .poll(() => this.getTerminalText(), {
        timeout: TIMEOUTS.SHORT,
        message: `Typed text "${prompt}" did not appear in the terminal`,
      })
      .not.toBe(contentBefore);

    await this.page.keyboard.press('Enter');
  }

  async sendPromptAndWaitForResponse(options: {
    prompt: string;
    expectedResponse: string | RegExp;
    timeout?: number;
  }): Promise<void> {
    const { prompt, expectedResponse, timeout = TIMEOUTS.MODEL_RESPONSE } = options;
    await this.sendPrompt(prompt);
    const contentAfterSubmit = await this.getTerminalText();
    await expect
      .poll(() => this.getTerminalText(), {
        timeout,
        message: `Terminal content did not change after pressing Enter`,
      })
      .not.toBe(contentAfterSubmit);
    await this.waitForTerminalContent(expectedResponse, timeout);
  }
}
