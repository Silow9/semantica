import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import React from "react";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});

const { cleanup, render } = await import("@testing-library/react");
const { setLocale } = await import("../src/i18n/index.ts");
const { graph } = await import("../src/store/graphStore.ts");
const { GraphInspectorPanel } = await import("../src/workspaces/GraphWorkspace/GraphInspectorPanel.tsx");

setLocale("zh");

test.afterEach(cleanup);

test("shows a labeled node id under the selected node title", () => {
  graph.addNode("entity:aspirin", {
    label: "阿司匹林",
    content: "阿司匹林",
    nodeType: "entity",
    properties: {},
  });

  const view = render(
    <GraphInspectorPanel
      nodeId="entity:aspirin"
      predictions={[]}
      predictionType=""
      onPredictionTypeChange={() => undefined}
      onRunPredictions={() => undefined}
      pathTargetId=""
      onPathTargetChange={() => undefined}
      onTracePath={() => undefined}
      pathResult={null}
      onDownloadProvenance={() => undefined}
    />,
  );

  assert.equal(view.getByRole("heading", { name: "阿司匹林" }).textContent, "阿司匹林");
  assert.ok(view.getByText("节点 ID"));
  assert.ok(view.getByText("entity:aspirin"));
  graph.dropNode("entity:aspirin");
});
