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

import { AgentWorkspaceOverviewPage } from './agent-workspace-overview-page';
import { AgentWorkspaceSettingsPage } from './agent-workspace-settings-page';
import { AgentWorkspaceTerminalPage } from './agent-workspace-terminal-page';
import { BasePage } from './base-page';

export class AgentWorkspaceDetailsPage extends BasePage {
  readonly header: Locator;
  readonly pageTabsRegion: Locator;
  readonly overviewTabLink: Locator;
  readonly terminalTabLink: Locator;
  readonly settingsTabLink: Locator;
  readonly removeButton: Locator;

  constructor(page: Page) {
    super(page);
    this.header = this.page.getByRole('region', { name: 'header' });
    this.pageTabsRegion = this.page.getByRole('region', { name: 'Tabs' });
    this.overviewTabLink = this.pageTabsRegion.getByRole('link', { name: 'Overview' });
    this.terminalTabLink = this.pageTabsRegion.getByRole('link', { name: 'Terminal' });
    this.settingsTabLink = this.pageTabsRegion.getByRole('link', { name: 'Settings' });
    this.removeButton = this.header.getByRole('button', { name: 'Remove Workspace' });
  }

  async waitForLoad(): Promise<void> {
    await expect(this.header).toBeVisible({ timeout: TIMEOUTS.PAGE_LOAD });
    await expect(this.pageTabsRegion).toBeVisible();
  }

  async openOverviewTab(): Promise<AgentWorkspaceOverviewPage> {
    return this.openTab(this.overviewTabLink, AgentWorkspaceOverviewPage);
  }

  async openTerminalTab(): Promise<AgentWorkspaceTerminalPage> {
    return this.openTab(this.terminalTabLink, AgentWorkspaceTerminalPage);
  }

  getTerminalPage(): AgentWorkspaceTerminalPage {
    return new AgentWorkspaceTerminalPage(this.page);
  }

  async openSettingsTab(): Promise<AgentWorkspaceSettingsPage> {
    return this.openTab(this.settingsTabLink, AgentWorkspaceSettingsPage);
  }
}
