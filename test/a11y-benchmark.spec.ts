/**
 * Copyright 2020 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import expect from 'expect';
import {
  getTestState,
  setupTestBrowserHooks,
  setupTestPageAndContextHooks,
} from './mocha-utils'; // eslint-disable-line import/extensions

import { ElementHandle } from '../lib/cjs/puppeteer/common/JSHandle.js';
import {
  ariaThroughCDPAXTreeQueryHandler,
  ariaThroughCDPDOMQueryHandler,
  ariaThroughDOMQueryHandler,
} from '../lib/cjs/puppeteer/common/QueryHandler.js';

describe('benchmark for different querying strategies', () => {
  setupTestBrowserHooks();
  setupTestPageAndContextHooks();
  const logs = [];
  after(() => {
    console.log();
    logs.forEach((line) => console.log(line));
  });
  beforeEach(async () => {
    const { page } = getTestState();
    // Reload the target page.
    await page.goto('data:text/html,', { waitUntil: ['domcontentloaded'] });
    // @ts-ignore
    // await page._client.send('Accessibility.enable', {});
    await page.setContent(
      `
      <h2>not title</h2>
      <!--
        We increase size of document to simulate a more realistic setting.
        The avg # elements for pages in the wild appears to be 300-400
        (https://almanac.httparchive.org/en/2019/markup#elements-per-page)
        so we insert a total of 200 div elements below to simulate selections
        happening in the middle of an avg. page
      -->
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
      <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>

      <div id="node1" aria-labeledby="node2"></div>
      <div id="node2" aria-label="bar"></div>
      <div id="node3" aria-label="foo"></div>
      <div id="node4" class="container">
      <div id="node5" aria-label="foo"></div>
      <div id="node6" aria-label="foo"></div>
      <div id="node8" aria-label="bar"></div>
      </div>

      <button id="node10">text content</button>
      <h1 id="node11">text content</h1>
      <h1 id="node12" role="presentation">text content</h1>
      <!-- Accessible name not available when role is "presentation" -->
      <script>
      const div = document.createElement('div');
      const shadowRoot = div.attachShadow({mode: 'open'});
      const h1 = document.createElement('h1');
      h1.textContent = 'text content';
      h1.id = 'node13';
      shadowRoot.appendChild(h1);
      document.documentElement.appendChild(div);
      </script>
      <!-- Elements inside shadow dom should be found -->

      <img id="node20" src="" alt="Accessible Name">
      <input id="node21" type="submit" value="Accessible Name">
      <label id="node22" for="node23">Accessible Name</label>
        <input id="node23">
      <!-- Accessible name for the <input> is "Accessible Name" -->
        <div id="node24" title="Accessible Name"></div>

      <div role="treeitem" id="node30">
      <div role="treeitem" id="node31">
      <div role="treeitem" id="node32">item1</div>
      <div role="treeitem" id="node33">item2</div>
      </div>
      <div role="treeitem" id="node34">item3</div>
      </div>
      <div aria-describedby="node30"></div>
      <!-- Accessible name for the <div> is "item1 item2 item3" -->
      `,
      { waitUntil: ['domcontentloaded'] }
    );
  });
  describe('Querying by accessible name and role', function () {
    this.timeout(0);
    afterEach(() => {
      const { puppeteer } = getTestState();
      puppeteer.__experimental_clearQueryHandlers();
    });

    const runTest = async (page, name) => {
      const getIds = async (elements: ElementHandle[]) =>
        Promise.all(
          elements.map((element) =>
            element.evaluate((element: Element) => element.id)
          )
        );
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const timeStart = Date.now();
      for (let i = 0; i < 1000; i++) {
        let found: ElementHandle[], ids: string[];
        found = await page.$$('aria/foo');
        ids = await getIds(found);
        expect(ids).toEqual(['node3', 'node5', 'node6']);
        found = await page.$$('aria/bar');
        ids = await getIds(found);
        expect(ids).toEqual(['node1', 'node2', 'node8']);
        found = await page.$$('aria/item1 item2 item3');
        ids = await getIds(found);
        expect(ids).toEqual(['node30']);
      }
      const timeEnd = Date.now();
      logs.push(
        `Testing using ${name} took
          ${((timeEnd - timeStart) / 1000).toFixed(2)} seconds`
      );
    };

    it('ComputedAccessibilityInfo', async () => {
      const { page, puppeteer } = getTestState();
      puppeteer.__experimental_registerCustomQueryHandler(
        'aria',
        ariaThroughDOMQueryHandler
      );
      await runTest(page, 'ComputedAccessibilityInfo');
    });
    it.skip('CDP(DOM)', async () => {
      const { page, puppeteer } = getTestState();
      puppeteer.__experimental_registerCustomQueryHandler(
        'aria',
        ariaThroughCDPDOMQueryHandler
      );
      await runTest(page, 'DOM through CDP');
    });
    it('CDP(AXTree)', async () => {
      const { page, puppeteer } = getTestState();
      puppeteer.__experimental_registerCustomQueryHandler(
        'aria',
        ariaThroughCDPAXTreeQueryHandler
      );
      await runTest(page, 'AXTree through CDP');
    });
  });
});
