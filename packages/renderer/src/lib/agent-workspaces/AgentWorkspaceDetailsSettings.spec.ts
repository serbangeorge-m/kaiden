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

import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { router } from 'tinro';
import { beforeEach, expect, test, vi } from 'vitest';

import type { AgentWorkspaceConfiguration, AgentWorkspaceSummary } from '/@api/agent-workspace-info';

import AgentWorkspaceDetailsSettings from './AgentWorkspaceDetailsSettings.svelte';

vi.mock(import('tinro'));

const routerStore = writable({
  path: '/agent-workspaces/ws-1/settings',
  url: '/agent-workspaces/ws-1/settings',
  from: '/',
  query: {} as Record<string, string>,
  hash: '',
});

const workspaceSummary: AgentWorkspaceSummary = {
  id: 'ws-1',
  name: 'api-refactor',
  project: 'backend',
  agent: 'opencode',
  model: 'gpt-4o',
  runtime: 'podman',
  state: 'stopped',
  paths: {
    source: '/home/user/projects/backend',
    configuration: '/home/user/.config/kaiden/workspaces/api-refactor.yaml',
  },
  timestamps: { created: 1700000000000, started: 1700100000000 },
  forwards: [],
};

const configuration: AgentWorkspaceConfiguration = {
  mounts: [{ host: '$SOURCES/../shared-lib', target: '/workspace/shared-lib', ro: false }],
  environment: [{ name: 'API_KEY', value: 'test-key' }],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(router).subscribe.mockImplementation(routerStore.subscribe);
  vi.mocked(window.updateAgentWorkspaceSummary).mockResolvedValue(undefined);
});

test('Expect General section is active by default with workspace info', () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  expect(screen.getByText('Workspace Information')).toBeInTheDocument();
});

test('Expect workspace name is displayed in input', () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const nameInput = screen.getByRole('textbox', { name: 'Workspace Name' });
  expect(nameInput).toHaveValue('api-refactor');
});

test('Expect working directory is displayed in input', () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const dirInput = screen.getByRole('textbox', { name: 'Working Directory' });
  expect(dirInput).toHaveValue('/home/user/projects/backend');
});

test('Expect switching to a placeholder section shows future update message', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const skillsNav = screen.getByRole('link', { name: 'Agent Skills' });
  await fireEvent.click(skillsNav);

  expect(screen.getByText('Agent Skills settings will be available in a future update.')).toBeInTheDocument();
});

test('Expect all settings nav sections are rendered', () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  for (const label of ['General', 'Agent Skills', 'MCP Servers', 'Knowledge', 'File Access', 'Network', 'Advanced']) {
    expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
  }
});

test('Expect workspace name input is editable', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const nameInput = screen.getByRole('textbox', { name: 'Workspace Name' });
  expect(nameInput).not.toHaveAttribute('readonly');
  await fireEvent.input(nameInput, { target: { value: 'new-name' } });
  expect(nameInput).toHaveValue('new-name');
});

test('Expect save/discard bar shown when workspace name is modified', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const nameInput = screen.getByRole('textbox', { name: 'Workspace Name' });
  await fireEvent.input(nameInput, { target: { value: 'renamed' } });

  expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
});

test('Expect save/discard bar not shown when workspace name matches original', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const nameInput = screen.getByRole('textbox', { name: 'Workspace Name' });
  await fireEvent.input(nameInput, { target: { value: 'api-refactor' } });

  expect(screen.queryByText('You have unsaved changes')).not.toBeInTheDocument();
});

test('Expect clicking Save changes calls updateAgentWorkspaceSummary', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const nameInput = screen.getByRole('textbox', { name: 'Workspace Name' });
  await fireEvent.input(nameInput, { target: { value: 'renamed' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(window.updateAgentWorkspaceSummary).toHaveBeenCalledWith('ws-1', { name: 'renamed' });
});

test('Expect clicking Discard changes resets workspace name to original', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const nameInput = screen.getByRole('textbox', { name: 'Workspace Name' });
  await fireEvent.input(nameInput, { target: { value: 'renamed' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

  expect(nameInput).toHaveValue('api-refactor');
  expect(screen.queryByText('You have unsaved changes')).not.toBeInTheDocument();
  expect(window.updateAgentWorkspaceSummary).not.toHaveBeenCalled();
});

test('Expect no save when workspace name has not changed', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const nameInput = screen.getByRole('textbox', { name: 'Workspace Name' });
  await fireEvent.input(nameInput, { target: { value: 'api-refactor' } });

  expect(window.updateAgentWorkspaceSummary).not.toHaveBeenCalled();
});

test('Expect working directory input is readonly', () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const dirInput = screen.getByRole('textbox', { name: 'Working Directory' });
  expect(dirInput).toHaveAttribute('readonly');
});

test('Expect empty inputs when workspace summary is undefined', () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary: undefined, configuration: {} });

  const nameInput = screen.getByRole('textbox', { name: 'Workspace Name' });
  expect(nameInput).toHaveValue('');

  const dirInput = screen.getByRole('textbox', { name: 'Working Directory' });
  expect(dirInput).toHaveValue('');
});

test('Expect error dialog shown when save fails', async () => {
  vi.mocked(window.updateAgentWorkspaceSummary).mockRejectedValue(new Error('network timeout'));
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const nameInput = screen.getByRole('textbox', { name: 'Workspace Name' });
  await fireEvent.input(nameInput, { target: { value: 'new-name' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(window.showMessageBox).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Agent Workspace',
      type: 'error',
      message: expect.stringContaining('network timeout'),
    }),
  );
});
