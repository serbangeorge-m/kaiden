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

import { workerTest as test } from '/@/fixtures/electron-app';
import { TIMEOUTS, WORKSPACE_STATUS } from '/@/model/core/types';
import { waitForNavigationReady } from '/@/utils/app-ready';
import { OpenshellCli } from '/@/utils/openshell-cli';

test.skip(process.platform === 'win32', 'The OpenShell CLI is not bundled on Windows');
test.skip(
  !!process.env.GITHUB_ACTIONS && process.platform !== 'linux' && !process.env.PODMAN_ENABLED,
  'CLI sandbox discovery requires a local OpenShell gateway able to run sandboxes, which macOS/Windows GitHub Actions runners cannot provide (no nested virtualization)',
);

let cli: OpenshellCli;

const SCENARIOS = [
  {
    id: 'WKS-DISC-01',
    title: 'Running sandbox appears and is removed after CLI delete',
    prefix: 'cli-run',
    command: ['sleep', 'infinity'],
    status: WORKSPACE_STATUS.RUNNING,
  },
  {
    id: 'WKS-DISC-02',
    title: 'Sandbox whose command exited shows as completed and is removed after CLI delete',
    prefix: 'cli-done',
    command: ['true'],
    status: WORKSPACE_STATUS.COMPLETED,
  },
];

test.describe('Workspaces page - sandboxes created from the OpenShell CLI', { tag: '@smoke' }, () => {
  // gateway start + sandbox create + UI status wait can each take up to WORKSPACE_READY on a cold runner
  test.describe.configure({ timeout: TIMEOUTS.WORKSPACE_READY * 4 });

  test.beforeAll(async ({ electronApp, page, navigationBar }) => {
    await waitForNavigationReady(page);
    await navigationBar.ensureExtensionsRunning();
    cli = await OpenshellCli.fromElectronApp(electronApp, page);
    await cli.waitForGateway();
  });

  test.beforeEach(async ({ navigationBar }) => {
    await navigationBar.navigateToWorkspacesPage();
  });

  for (const scenario of SCENARIOS) {
    test(`[${scenario.id}] ${scenario.title}`, async ({ agentWorkspacesPage }) => {
      const name = `${scenario.prefix}-${Date.now().toString(36)}`;
      try {
        await cli.createSandbox(name, scenario.command);
        await agentWorkspacesPage.waitForWorkspaceStatus(name, scenario.status);

        await cli.deleteSandbox(name);
        await agentWorkspacesPage.ensureRowDoesNotExist(name, TIMEOUTS.STANDARD);
      } finally {
        await cli.deleteSandboxIfPresent(name);
      }
    });
  }
});
