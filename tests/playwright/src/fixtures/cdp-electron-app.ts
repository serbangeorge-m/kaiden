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

import { type ChildProcess, spawn } from 'node:child_process';

import { type Browser, chromium, type ElectronApplication, type Page } from '@playwright/test';
import { TIMEOUTS } from 'src/model/core/types';

const DEVTOOLS_URL_PREFIX = 'devtools://';
const DEFAULT_CDP_PORT = 9222;

export function resolveCdpPort(): string {
  return process.env.DEBUGGING_PORT ?? process.env.KAIDEN_CDP_PORT ?? String(DEFAULT_CDP_PORT);
}

/**
 * CDP attach is required for Windows packaged builds (MAPT + nightly Windows prod).
 * Linux/macOS prod uses Playwright electron.launch({ executablePath }) so main-process
 * evaluate() remains available for native file-dialog mocking.
 */
export function shouldLaunchViaCdp(): boolean {
  if (!process.env.KAIDEN_BINARY) {
    return false;
  }
  if (process.env.KAIDEN_E2E_FORCE_CDP === 'true') {
    return true;
  }
  return process.platform === 'win32';
}

function isDevToolsWindow(url: string): boolean {
  return url.startsWith(DEVTOOLS_URL_PREFIX);
}

function getBrowserPages(browser: Browser): Page[] {
  return browser
    .contexts()
    .flatMap(context => context.pages())
    .filter(page => !page.isClosed() && !isDevToolsWindow(page.url()));
}

async function waitForCdpEndpoint(port: string, timeout = TIMEOUTS.DEFAULT): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {
      // Expected while the app is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`CDP endpoint did not become ready on port ${port} within ${timeout}ms`);
}

async function waitForRendererPage(browser: Browser, timeout = TIMEOUTS.DEFAULT): Promise<Page> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const pages = getBrowserPages(browser);
    const loaded = pages.find(page => page.url() && page.url() !== 'about:blank');
    if (loaded) {
      return loaded;
    }
    if (pages.length > 0) {
      return pages[0];
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`No renderer page appeared after CDP connection within ${timeout}ms`);
}

/**
 * Adapter so Windows packaged CDP launches expose the ElectronApplication surface area
 * used by Kaiden fixtures (windows/close/process/on). Main-process evaluate() is
 * unavailable in CDP mode — use selectLocalFile() drag-and-drop for file imports.
 */
class CdpElectronApplicationAdapter {
  private readonly browser: Browser;
  private readonly childProcess: ChildProcess;
  private closed = false;
  private readonly closeListeners = new Set<() => void>();

  constructor(browser: Browser, childProcess: ChildProcess) {
    this.browser = browser;
    this.childProcess = childProcess;
    childProcess.on('exit', () => {
      this.closed = true;
      for (const listener of this.closeListeners) {
        listener();
      }
    });
  }

  windows(): Page[] {
    return getBrowserPages(this.browser);
  }

  on(event: 'close', handler: () => void): void {
    if (event === 'close') {
      this.closeListeners.add(handler);
    }
  }

  process(): ChildProcess {
    return this.childProcess;
  }

  async firstWindow(options?: { timeout?: number }): Promise<Page> {
    return waitForRendererPage(this.browser, options?.timeout ?? TIMEOUTS.DEFAULT);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    try {
      await this.browser.close();
    } finally {
      if (this.childProcess.pid && !this.childProcess.killed) {
        this.childProcess.kill('SIGTERM');
      }
      this.closed = true;
      for (const listener of this.closeListeners) {
        listener();
      }
    }
  }
}

export async function launchCdpElectronApp(
  executablePath: string,
  args: string[],
  env: Record<string, string>,
): Promise<ElectronApplication> {
  const port = resolveCdpPort();
  const childProcess = spawn(
    executablePath,
    [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', ...args],
    {
      env: env as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  await new Promise<void>((resolve, reject) => {
    const onSpawn = (): void => {
      childProcess.off('error', onError);
      resolve();
    };
    const onError = (error: Error): void => {
      childProcess.off('spawn', onSpawn);
      reject(error);
    };
    childProcess.once('spawn', onSpawn);
    childProcess.once('error', onError);
  });

  try {
    await waitForCdpEndpoint(port);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    return new CdpElectronApplicationAdapter(browser, childProcess) as unknown as ElectronApplication;
  } catch (error) {
    if (childProcess.pid && !childProcess.killed) {
      childProcess.kill('SIGTERM');
    }
    throw error;
  }
}
