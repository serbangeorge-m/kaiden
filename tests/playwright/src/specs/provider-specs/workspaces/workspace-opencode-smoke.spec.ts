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

import { CODING_AGENT } from 'src/model/core/types';

import { expect, test } from '../../../fixtures/provider-fixtures';
import { registerWorkspaceLifecycleTests } from './workspace-lifecycle-helper';

test.describe
  .serial('OpenCode agent workspace with OpenAI', { tag: '@smoke' }, () => {
    registerWorkspaceLifecycleTests(test, expect, {
      testIdPrefix: 'WKS-OPENAI',
      workspaceName: 'opencode-e2e-smoke',
      agent: CODING_AGENT.OPENCODE,
      selectModel: async createPage => {
        await createPage.searchModel('chat');
        await expect(createPage.getModelTableRows().first()).toBeVisible();
        await createPage.selectDefaultModel();
        return undefined;
      },
      terminalReadyPatterns: [/Ask anything/, /OpenAI/],
      promptTest: {
        prompt: 'what is 123+456? reply with just the number',
        expectedResponse: /579/,
      },
    });
  });
