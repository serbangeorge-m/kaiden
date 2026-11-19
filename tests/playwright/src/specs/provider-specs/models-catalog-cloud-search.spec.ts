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

import { expect, test } from '/@/fixtures/provider-fixtures';
import { PROVIDERS, type ResourceId, TIMEOUTS } from '/@/model/core/types';
import { waitForNavigationReady } from '/@/utils/app-ready';

// Cloud catalogs come live from the provider API, so model names are read from the LLM Providers table after
// resourceSetup has created the connection from the API key. The connection name is searchable text too:
// OpenAI names its connection after the base URL, Gemini after the masked API key.
interface CloudCatalog {
  testId: string;
  resource: ResourceId;
  providerName: string;
  connectionName?: string;
}

const CLOUD_CATALOGS: CloudCatalog[] = [
  { testId: '02', resource: 'openai', providerName: 'OpenAI', connectionName: PROVIDERS.openai.baseURL },
  { testId: '03', resource: 'gemini', providerName: 'Gemini' },
];

// The catalog splits queries on whitespace, '-' and '_' (renderer search-util.ts); cover each separator.
const SEPARATORS = [' ', '-', '_'];

function nameParts(modelName: string): string[] {
  return modelName.split(/[^a-z0-9.]+/i).filter(Boolean);
}

// Rows are also searchable by provider id, provider name and connection name.
function canBeToldApart(target: string, other: string, providerTerms: string): boolean {
  const otherSearchText = `${other} ${providerTerms}`.toLowerCase();
  return nameParts(target).some(part => !otherSearchText.includes(part.toLowerCase()));
}

// First pair of models where each one has a name part the other lacks, so a query can tell them apart.
function pickDistinguishablePair(labels: readonly string[], providerTerms: string): [string, string] | undefined {
  for (const first of labels) {
    for (const second of labels) {
      if (
        first !== second &&
        canBeToldApart(first, second, providerTerms) &&
        canBeToldApart(second, first, providerTerms)
      ) {
        return [first, second];
      }
    }
  }
  return undefined;
}

test.describe('Models catalog search - cloud providers', { tag: '@smoke' }, () => {
  test.beforeEach(async ({ page, navigationBar }) => {
    await waitForNavigationReady(page);
    await navigationBar.ensureExtensionsRunning();
    await navigationBar.navigateToSettingsPage();
  });

  // One test per provider; each provider project runs only its own and skips the others.
  for (const catalog of CLOUD_CATALOGS) {
    test.describe(catalog.providerName, () => {
      test.skip(
        ({ resource }) => resource !== catalog.resource,
        `Runs in the ${catalog.providerName} provider project`,
      );

      test(`[MODELS-SEARCH-${catalog.testId}] token-based search filters ${catalog.providerName} model rows`, async ({
        settingsPage,
      }) => {
        const providerTerms = [catalog.resource, catalog.providerName, catalog.connectionName]
          .filter(Boolean)
          .join(' ');
        const modelsPage = await settingsPage.openModels();
        await modelsPage.selectCategory('LLM Providers');

        await test.step(`${catalog.providerName} is connected and lists models`, async () => {
          await expect(modelsPage.getProviderCardStatus(catalog.providerName, 'Connected')).toBeVisible({
            timeout: TIMEOUTS.STANDARD,
          });
          // Two models are needed to check that a query keeps one and hides the other.
          await expect
            .poll(async () => (await modelsPage.getModelLabels(catalog.providerName)).length, {
              message: `${catalog.providerName} should list at least 2 models`,
              timeout: TIMEOUTS.STANDARD,
            })
            .toBeGreaterThanOrEqual(2);
        });

        const labels = await modelsPage.getModelLabels(catalog.providerName);
        const pair = pickDistinguishablePair(labels, providerTerms);
        if (!pair) {
          throw new Error(`No two ${catalog.providerName} models can be told apart by name: ${labels.join(', ')}`);
        }

        for (const [target, other] of [pair, pair.toReversed()]) {
          // Reversed parts, e.g. 'gpt-4.1-mini' -> 'mini 4.1 gpt': every token must match on its own, in any order.
          const parts = nameParts(target).toReversed();

          for (const separator of SEPARATORS) {
            const query = parts.join(separator);
            await test.step(`'${query}' matches ${target} but not ${other}`, async () => {
              await modelsPage.search(query);
              await expect(modelsPage.getModelRow(target, catalog.providerName)).toBeVisible();
              await expect(modelsPage.getModelRow(other, catalog.providerName)).toBeHidden();
            });
          }

          const noMatchQuery = `${parts.join(' ')} nomatch-e2e`;
          await test.step(`'${noMatchQuery}' matches nothing`, async () => {
            await modelsPage.search(noMatchQuery);
            await expect(modelsPage.filteredEmptyMessage).toBeVisible();
            await expect(modelsPage.getModelRow(target, catalog.providerName)).toBeHidden();
            await expect(modelsPage.getModelRow(other, catalog.providerName)).toBeHidden();
          });
        }

        await test.step('clearing the search restores the rows', async () => {
          await modelsPage.clearSearch();
          for (const model of pair) {
            await expect(modelsPage.getModelRow(model, catalog.providerName)).toBeVisible();
          }
        });
      });
    });
  }
});
