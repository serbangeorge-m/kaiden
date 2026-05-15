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
import type { SettingsSection } from 'src/model/core/types';

import { BasePage } from './base-page';

export interface SettingsExpectations {
  workspaceName?: string;
  workingDirectory?: string;
  sections?: readonly string[];
}

export class AgentWorkspaceSettingsPage extends BasePage {
  readonly settingsNav: Locator;
  readonly workspaceNameInput: Locator;
  readonly workingDirectoryInput: Locator;
  readonly saveChangesButton: Locator;
  readonly discardChangesButton: Locator;
  readonly unsavedChangesMessage: Locator;
  readonly noChangesMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.settingsNav = this.page.getByRole('navigation', { name: 'Settings sections' });
    this.workspaceNameInput = this.page.getByRole('textbox', { name: 'Workspace Name' });
    this.workingDirectoryInput = this.page.getByRole('textbox', { name: 'Working Directory' });
    this.saveChangesButton = this.page.getByRole('button', { name: 'Save changes' });
    this.discardChangesButton = this.page.getByRole('button', { name: 'Discard changes' });
    this.unsavedChangesMessage = this.page.getByText('You have unsaved changes');
    this.noChangesMessage = this.page.getByText('No changes to save');
  }

  async waitForLoad(): Promise<void> {
    await expect(this.settingsNav).toBeVisible();
    await expect(this.workspaceNameInput).toBeVisible();
  }

  getNavItem(section: SettingsSection): Locator {
    return this.settingsNav.getByRole('link', { name: section });
  }

  async selectSection(section: SettingsSection): Promise<void> {
    const link = this.getNavItem(section);
    await expect(link).toBeVisible();
    await link.click();
  }

  async verifySettings(expected: SettingsExpectations): Promise<void> {
    if (expected.sections) {
      for (const section of expected.sections) {
        await expect(this.getNavItem(section as SettingsSection)).toBeVisible();
      }
    }
    if (expected.workspaceName) {
      await expect(this.workspaceNameInput).toHaveValue(expected.workspaceName);
    }
    if (expected.workingDirectory) {
      await expect(this.workingDirectoryInput).toHaveValue(expected.workingDirectory);
      await expect(this.workingDirectoryInput).toHaveAttribute('readonly');
    }
  }
}
