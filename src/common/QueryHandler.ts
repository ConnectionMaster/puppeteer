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

import { ElementHandle } from './JSHandle.js';
import { SnapshotOptions, SerializedAXNode } from './Accessibility.js';
import { ExecutionContext } from './ExecutionContext.js';
import { Protocol } from 'devtools-protocol';

export interface InPageQueryHandler {
  queryOne?: (element: Element | Document, selector: string) => Element | null;
  queryAll?: (
    element: Element | Document,
    selector: string
  ) => Element[] | NodeListOf<Element>;
}

export interface InPptrQueryHandler {
  findOne?: (
    elementHandle: ElementHandle,
    selector: string
  ) => Promise<ElementHandle> | null;
  findAll?: (
    elementHandle: ElementHandle,
    selector: string
  ) => Promise<ElementHandle[]>;
}

export type QueryHandler = InPageQueryHandler | InPptrQueryHandler;

export function isInPptrQueryHandler(
  handler: QueryHandler
): handler is InPptrQueryHandler {
  return (
    (handler as InPageQueryHandler).queryOne === undefined &&
    (handler as InPageQueryHandler).queryAll === undefined
  );
}

const _customQueryHandlers = new Map<string, QueryHandler>();

export function registerCustomQueryHandler(
  name: string,
  handler: QueryHandler
): void {
  if (_customQueryHandlers.get(name))
    throw new Error(`A custom query handler named "${name}" already exists`);

  const isValidName = /^[a-zA-Z]+$/.test(name);
  if (!isValidName)
    throw new Error(`Custom query handler names may only contain [a-zA-Z]`);

  _customQueryHandlers.set(name, handler);
}

/**
 * @param {string} name
 */
export function unregisterCustomQueryHandler(name: string): void {
  _customQueryHandlers.delete(name);
}

export function customQueryHandlers(): Map<string, QueryHandler> {
  return _customQueryHandlers;
}

export function clearQueryHandlers(): void {
  _customQueryHandlers.clear();
}

export function getQueryHandlerAndSelector(
  selector: string
): { updatedSelector: string; queryHandler: QueryHandler } {
  const defaultHandler = {
    queryOne: (element: Element, selector: string) =>
      element.querySelector(selector),
    queryAll: (element: Element, selector: string) =>
      element.querySelectorAll(selector),
  };
  const hasCustomQueryHandler = /^[a-zA-Z]+\//.test(selector);
  if (!hasCustomQueryHandler)
    return { updatedSelector: selector, queryHandler: defaultHandler };

  const index = selector.indexOf('/');
  const name = selector.slice(0, index);
  const updatedSelector = selector.slice(index + 1);
  const queryHandler = customQueryHandlers().get(name);
  if (!queryHandler)
    throw new Error(
      `Query set to use "${name}", but no query handler of that name was found`
    );

  return {
    updatedSelector,
    queryHandler,
  };
}

function getAXTree(exeCtx: ExecutionContext, element: ElementHandle) {
  const page = exeCtx.frame()._page;
  const options: SnapshotOptions = {
    root: element,
    includeBackendDOMNodeId: true,
  };
  return page.accessibility.snapshot(options);
}

function traverseTree(
  tree: SerializedAXNode,
  matchPred: (node: SerializedAXNode) => boolean,
  returnPred: (res: SerializedAXNode[]) => boolean
): SerializedAXNode[] {
  let res: SerializedAXNode[] = [];
  if (tree.children) {
    for (const child of tree.children) {
      res = res.concat(traverseTree(child, matchPred, returnPred));
      if (returnPred(res)) {
        return res;
      }
    }
  }
  if (matchPred(tree)) {
    res.push(tree);
  }
  return res;
}

function parseAriaSelector(selector: string): { name?: string; role?: string } {
  const s = selector.split('&');
  const name = s[0] || undefined; // can't search for empty name
  const role = s.length > 1 ? s[1] : undefined;
  return { name, role };
}

function ariaMatcher(
  name: string,
  role: string
): (node: SerializedAXNode) => boolean {
  return (node: SerializedAXNode) => {
    const nameMatch = !name || node.name === name;
    const roleMatch = !role || node.role === role;
    return nameMatch && roleMatch;
  };
}

function backendNodeIdtoHandle(
  exeCtx: ExecutionContext,
  backendNodeId: number
): Promise<ElementHandle> {
  return exeCtx._adoptBackendNodeId(backendNodeId);
}

async function queryAXTree(
  element: ElementHandle,
  accessibleName?: string,
  role?: string
): Promise<Protocol.Accessibility.AXNode[]> {
  const client = element._client;
  // @ts-ignore
  const { nodes } = await client.send(
    // @ts-ignore
    'Accessibility.queryAXTree',
    {
      objectId: element._remoteObject.objectId,
      accessibleName,
      role,
    }
  );
  // @ts-ignore
  const filteredNodes = nodes.filter(
    (node: Protocol.Accessibility.AXNode) => node.role.value !== 'text'
  );
  // @ts-ignore
  return filteredNodes;
}

async function ariaFindOneThroughCDPAXTree(
  element: ElementHandle,
  selector: string
): Promise<ElementHandle> {
  const exeCtx = element.executionContext();
  const { name, role } = parseAriaSelector(selector);
  const res = await queryAXTree(element, name, role);
  if (res.length < 1) {
    return null;
  }
  const handle = backendNodeIdtoHandle(exeCtx, res[0].backendDOMNodeId);
  return handle;
}
async function ariaFindAllThroughCDPAXTree(
  element: ElementHandle,
  selector: string
): Promise<ElementHandle[]> {
  const exeCtx = element.executionContext();
  const { name, role } = parseAriaSelector(selector);
  const res = await queryAXTree(element, name, role);
  const resHandles = Promise.all(
    res.map((axNode) => backendNodeIdtoHandle(exeCtx, axNode.backendDOMNodeId))
  );
  return resHandles;
}

async function getIdsByAccessibleName(
  element: ElementHandle,
  accessibleName: string
): Promise<number[]> {
  const client = element._client;
  // @ts-ignore
  const { nodeIds } = await client.send(
    // @ts-ignore
    'DOM.getNodesForSubtreeByAccessibleNameAndRole',
    {
      objectId: element._remoteObject.objectId,
      accessibleName,
    }
  );
  // @ts-ignore
  return nodeIds;
}

async function ariaFindOneThroughCDPDOM(
  element: ElementHandle,
  selector: string
): Promise<ElementHandle> {
  const exeCtx = element.executionContext();
  const { name } = parseAriaSelector(selector);
  const nodeIds = await getIdsByAccessibleName(element, name);
  if (nodeIds.length === 0) {
    return null;
  }
  const handle = await backendNodeIdtoHandle(exeCtx, nodeIds[0]);
  return handle;
}

async function ariaFindAllThroughCDPDOM(
  element: ElementHandle,
  selector: string
): Promise<ElementHandle[]> {
  const exeCtx = element.executionContext();
  const { name } = parseAriaSelector(selector);
  const nodeIds = await getIdsByAccessibleName(element, name);
  if (nodeIds.length === 0) {
    return null;
  }
  const handles = await Promise.all(
    nodeIds.map((id) => backendNodeIdtoHandle(exeCtx, id))
  );
  return handles;
}

function ariaQueryOneThroughDOM(
  element: Element | Document | ShadowRoot,
  selector: string
): Element | null {
  const s = selector.split('&');
  const { name, role } =
    s.length > 1 ? { name: s[0], role: s[1] } : { name: s[0], role: '' };
  let res;
  const search = (root: Element | Document | ShadowRoot) => {
    const iter = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT);
    let currentNode;
    while (!res && (currentNode = iter.nextNode())) {
      if (currentNode.shadowRoot) {
        search(currentNode.shadowRoot);
      }
      const nameMatch = !name || currentNode.computedName === name;
      const roleMatch = !role || currentNode.computedRole === role;
      if (nameMatch && roleMatch) {
        res = currentNode;
      }
    }
  };
  search(element);
  return res;
}

function ariaQueryAllThroughDOM(
  element: Element | Document,
  selector: string
): Element[] {
  const s = selector.split('&');
  const { name, role } =
    s.length > 1 ? { name: s[0], role: s[1] } : { name: s[0], role: '' };
  const result = [];
  const collect = (root: Element | Document | ShadowRoot) => {
    const iter = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT);
    let currentNode;
    while ((currentNode = iter.nextNode())) {
      if (currentNode.shadowRoot) {
        collect(currentNode.shadowRoot);
      }
      const nameMatch = !name || currentNode.computedName === name;
      const roleMatch = !role || currentNode.computedRole === role;
      if (nameMatch && roleMatch) {
        result.push(currentNode);
      }
    }
  };
  collect(element);
  return result;
}

export const ariaThroughCDPAXTreeQueryHandler: InPptrQueryHandler = {
  findOne: ariaFindOneThroughCDPAXTree,
  findAll: ariaFindAllThroughCDPAXTree,
};

export const ariaThroughCDPDOMQueryHandler: InPptrQueryHandler = {
  findOne: ariaFindOneThroughCDPDOM,
  findAll: ariaFindAllThroughCDPDOM,
};

export const ariaThroughDOMQueryHandler: QueryHandler = {
  queryOne: ariaQueryOneThroughDOM,
  queryAll: ariaQueryAllThroughDOM,
};
