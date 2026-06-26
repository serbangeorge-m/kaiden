/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
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
import { createServer, type Server } from 'node:http';

import { expect, test } from '/@/fixtures/provider-fixtures';
import { MCP_SERVERS } from '/@/model/core/types';
import { waitForNavigationReady } from '/@/utils/app-ready';

const MCP_REGISTRY_EXAMPLE = 'MCP Registry example';
const SERVER_LIST_UPDATE_TIMEOUT = 60_000;
const SERVER_CONNECTION_TIMEOUT = 10_000;

const MOCK_REGISTRY_RESPONSE = JSON.stringify({
  servers: [
    { server: { name: 'io.test/mock-server-alpha', description: 'Mock MCP server A', version: '1.0.0' }, _meta: {} },
    { server: { name: 'io.test/mock-server-beta', description: 'Mock MCP server B', version: '1.0.0' }, _meta: {} },
  ],
  metadata: { count: 2 },
});

test.use({
  mcpServers: process.env[MCP_SERVERS.github.envVarName] ? ['github'] : [],
});

test.describe('MCP Registry Management', { tag: '@smoke' }, () => {
  let server: Server;
  let mockRegistryUrl: string;

  test.beforeAll(async () => {
    server = createServer((_, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(MOCK_REGISTRY_RESPONSE);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as { port: number };
    mockRegistryUrl = `http://127.0.0.1:${addr.port}`;
  });

  test.afterAll(async () => {
    await new Promise<void>(resolve => server?.close(() => resolve()) ?? resolve());
  });

  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    await navigationBar.navigateToMCPPage();
  });

  test('[MCP-01] Add and remove MCP registry: verify server list updates accordingly', async ({ mcpPage }) => {
    const editRegistriesTab = await mcpPage.openEditRegistriesTab();
    await editRegistriesTab.ensureRowExists(MCP_REGISTRY_EXAMPLE);

    const installTab = await mcpPage.openInstallTab();
    await installTab.verifyInstallTabIsNotEmpty();
    const initialServerCount = await installTab.countRowsFromTable();

    await mcpPage.openEditRegistriesTab();
    await editRegistriesTab.addNewRegistry(mockRegistryUrl);
    await editRegistriesTab.ensureRowExists(mockRegistryUrl);

    await mcpPage.openInstallTab();
    await installTab.verifyServerCountIncreased(initialServerCount, SERVER_LIST_UPDATE_TIMEOUT);

    await mcpPage.openEditRegistriesTab();
    await editRegistriesTab.removeRegistry(mockRegistryUrl);
    await editRegistriesTab.ensureRowDoesNotExist(mockRegistryUrl);

    await mcpPage.openInstallTab();
    await installTab.verifyServerCountIsRestored(initialServerCount, SERVER_LIST_UPDATE_TIMEOUT);
  });
});

test.describe('MCP Server Management', { tag: '@smoke' }, () => {
  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    await navigationBar.navigateToMCPPage();
  });

  test('[MCP-02] Add and remove MCP server: verify server list updates accordingly', async ({
    mcpSetup: _mcpSetup,
    mcpPage,
  }) => {
    const hasGithubToken = !!process.env[MCP_SERVERS.github.envVarName];

    const skipConditions: Array<{ condition: boolean; reason: string }> = [
      { condition: !hasGithubToken, reason: `${MCP_SERVERS.github.envVarName} environment variable is not set` },
    ];

    for (const { condition, reason } of skipConditions) {
      test.skip(condition, reason);
    }

    const serverName = MCP_SERVERS.github.serverName;
    const mcpReadyTab = await mcpPage.openReadyTab();

    await expect
      .poll(async () => await mcpReadyTab.isServerConnected(serverName), { timeout: SERVER_CONNECTION_TIMEOUT })
      .toBeTruthy();
  });
});
