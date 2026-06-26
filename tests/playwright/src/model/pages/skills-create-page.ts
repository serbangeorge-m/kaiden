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

import { type ElectronApplication, expect, type Locator, type Page } from '@playwright/test';

import { TIMEOUTS } from '/@/model/core/types';
import { withMockedFileDialog } from '/@/utils/app-ready';

import { BasePage } from './base-page';

export class SkillsCreatePage extends BasePage {
  readonly dialog: Locator;
  readonly dialogHeading: Locator;
  readonly nameInput: Locator;
  readonly descriptionInput: Locator;
  readonly contentTextarea: Locator;
  readonly cancelButton: Locator;
  readonly createButton: Locator;
  readonly fileDropZone: Locator;

  constructor(page: Page) {
    super(page);
    this.dialog = this.page.getByRole('dialog', { name: 'Create Skill' });
    this.dialogHeading = this.dialog.getByRole('heading', { name: 'Create Skill' });
    this.nameInput = this.dialog.getByLabel('Skill name');
    this.descriptionInput = this.dialog.getByLabel('Skill description');
    this.contentTextarea = this.dialog.getByLabel('Skill content');
    this.cancelButton = this.dialog.getByRole('button', { name: 'Cancel' });
    this.createButton = this.dialog.getByRole('button', { name: 'Create' });
    this.fileDropZone = this.dialog.getByLabel('Drop or click to select a SKILL.md file');
  }

  async waitForLoad(): Promise<void> {
    await expect(this.dialog).toBeVisible({ timeout: TIMEOUTS.SHORT });
    await expect(this.dialogHeading).toBeVisible();
  }

  async cancel(): Promise<void> {
    await expect(this.cancelButton).toBeEnabled();
    await this.cancelButton.click();
    await expect(this.dialog).toBeHidden();
  }

  async selectFile(absoluteFilePath: string, electronApp: ElectronApplication): Promise<void> {
    await withMockedFileDialog(electronApp, absoluteFilePath, async () => {
      await expect(this.fileDropZone).toBeVisible();
      await this.fileDropZone.click();
    });
    await expect(this.nameInput).not.toBeEmpty({ timeout: TIMEOUTS.SHORT });
  }

  async fillForm(name: string, description: string, content: string): Promise<void> {
    await this.nameInput.fill(name);
    await this.descriptionInput.fill(description);
    await this.contentTextarea.fill(content);
  }

  async create(): Promise<void> {
    await expect(this.createButton).toBeEnabled({ timeout: TIMEOUTS.SHORT });
    await this.createButton.click();
    await expect(this.dialog).toBeHidden({ timeout: TIMEOUTS.SHORT });
  }
}
