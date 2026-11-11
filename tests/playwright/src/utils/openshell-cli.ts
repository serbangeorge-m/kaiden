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

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { type ElectronApplication, expect, type Page } from '@playwright/test';

import { TIMEOUTS } from '/@/model/core/types';

const execFileAsync = promisify(execFile);
/** Default gateway Kaiden starts and registers for the OpenShell CLI. */
const GATEWAY = 'kaiden-local';

/**
 * Drives the OpenShell CLI that Kaiden resolved, against the gateway that Kaiden started.
 * The CLI resolves gateways from the same config dir as Kaiden, so it runs with Kaiden's (isolated test) HOME.
 */
export class OpenshellCli {
  private constructor(
    private readonly binaryPath: string,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  static async fromElectronApp(electronApp: ElectronApplication, page: Page): Promise<OpenshellCli> {
    let binaryPath: string | undefined;
    await expect
      .poll(
        async () => {
          // the preload API is not typed in the e2e project: only the fields read here are declared
          binaryPath = await page.evaluate(async () => {
            const getCliToolInfos = (
              window as unknown as { getCliToolInfos?: () => Promise<{ name: string; path?: string }[]> }
            ).getCliToolInfos;
            if (typeof getCliToolInfos !== 'function') return undefined;
            return (await getCliToolInfos()).find(tool => tool.name === 'openshell')?.path;
          });
          return binaryPath;
        },
        { timeout: TIMEOUTS.STANDARD, message: 'Kaiden did not resolve the OpenShell CLI' },
      )
      .toBeTruthy();
    const appEnv = await electronApp.evaluate(() => ({
      HOME: process.env.HOME,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    }));
    // mirror the app's config location exactly so the CLI never resolves gateways from the runner's own config
    const env: NodeJS.ProcessEnv = { ...process.env, ...appEnv };
    for (const key of ['HOME', 'XDG_CONFIG_HOME'] as const) {
      if (!env[key]) delete env[key];
    }
    return new OpenshellCli(binaryPath ?? '', env);
  }

  private async run(args: string[], timeout: number = TIMEOUTS.STANDARD): Promise<string> {
    const { stdout } = await execFileAsync(this.binaryPath, ['-g', GATEWAY, ...args], { env: this.env, timeout });
    return stdout;
  }

  /** Waits until the gateway answers CLI requests (Kaiden starts it asynchronously). */
  async waitForGateway(timeout: number = TIMEOUTS.WORKSPACE_READY): Promise<void> {
    await expect
      .poll(
        async () => {
          try {
            await this.run(['sandbox', 'list'], TIMEOUTS.SHORT);
            return true;
          } catch (err: unknown) {
            console.log(`[openshell-cli] gateway "${GATEWAY}" not reachable yet:`, err);
            return false;
          }
        },
        { timeout, intervals: [2_000], message: `OpenShell gateway "${GATEWAY}" not reachable from the CLI` },
      )
      .toBe(true);
  }

  /**
   * Creates a sandbox running `command`. `--detach` returns once the sandbox is up, so a long-running command
   * keeps it Ready; a command that exits right away leaves it Completed.
   */
  async createSandbox(name: string, command: string[]): Promise<void> {
    await this.run(['sandbox', 'create', '--detach', '--name', name, '--', ...command], TIMEOUTS.WORKSPACE_READY);
  }

  async deleteSandbox(name: string): Promise<void> {
    await this.run(['sandbox', 'delete', name]);
  }

  /** Best-effort cleanup for `finally` blocks: never masks the test failure. */
  async deleteSandboxIfPresent(name: string): Promise<void> {
    try {
      const names = await this.run(['sandbox', 'list', '--names']);
      if (names.split('\n').some(line => line.trim() === name)) {
        await this.deleteSandbox(name);
      }
    } catch (err: unknown) {
      console.warn(`[openshell-cli] cleanup of sandbox "${name}" failed:`, err);
    }
  }
}
