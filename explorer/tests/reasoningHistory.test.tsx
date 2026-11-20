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
  localStorage: dom.window.localStorage,
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});
window.matchMedia = () => ({
  matches: true,
  media: "(prefers-reduced-motion: reduce)",
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() { return false; },
});

const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { setLocale } = await import("../src/i18n/index.ts");
const { ReasoningWorkspace } = await import("../src/workspaces/ReasoningWorkspace.tsx");

setLocale("zh");

function mount() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ReasoningWorkspace />
    </QueryClientProvider>,
  );
}

test.beforeEach(() => {
  window.localStorage.clear();
});

test.afterEach(cleanup);

test("saves a finished analysis and loads it from the history column", async () => {
  const fetchMock = async () => new Response(JSON.stringify({
    facts: ["need(order, 500000)"],
    rules: ["IF need THEN accept"],
    inferred_facts: ["accept(order)"],
    answer: "可以接单",
    reason: "当前产能足够",
    rules_fired: 1,
    added_edges: 0,
    mutated: false,
  }), { status: 200, headers: { "content-type": "application/json" } });
  window.fetch = fetchMock;
  globalThis.fetch = fetchMock;

  const view = mount();
  fireEvent.change(view.getByRole("textbox"), { target: { value: "订单能不能接" } });
  fireEvent.click(view.getByRole("button", { name: "运行推理" }));

  const saved = await view.findByRole("button", { name: /订单能不能接/ });
  assert.ok(view.getByText("可以接单"));
  assert.equal(JSON.parse(window.localStorage.getItem("semantica.reasoning.history") ?? "[]").length, 1);

  fireEvent.click(view.getByRole("button", { name: "恢复默认" }));
  await waitFor(() => {
    assert.equal(view.queryByText("可以接单"), null);
  });

  fireEvent.click(saved);
  assert.equal(view.getByRole("textbox").value, "订单能不能接");
  assert.ok(view.getByText("可以接单"));

  fireEvent.click(view.getByRole("button", { name: "新会话" }));
  assert.equal(view.getByRole("textbox").value, "");
  assert.equal(view.queryByText("可以接单"), null);
  const drafted = JSON.parse(window.localStorage.getItem("semantica.reasoning.history") ?? "[]");
  assert.equal(drafted.length, 2);
  assert.equal(drafted[0].text, "");
  fireEvent.click(view.getAllByRole("button", { name: "删除" })[0]);

  cleanup();
  const restored = mount();
  assert.ok(restored.getByRole("button", { name: /订单能不能接/ }));
  assert.equal(restored.queryByText("可以接单"), null);

  fireEvent.click(restored.getByRole("button", { name: "重命名" }));
  fireEvent.change(restored.getByRole("textbox", { name: "重命名" }), { target: { value: "产能评估" } });
  fireEvent.keyDown(restored.getByRole("textbox", { name: "重命名" }), { key: "Enter" });
  assert.equal(restored.queryByRole("button", { name: /订单能不能接/ }), null);
  assert.equal(JSON.parse(window.localStorage.getItem("semantica.reasoning.history") ?? "[]")[0].name, "产能评估");
  fireEvent.click(restored.getByRole("button", { name: /产能评估/ }));
  assert.equal(restored.getByRole("textbox").value, "订单能不能接");

  fireEvent.click(restored.getByRole("button", { name: "删除" }));
  await waitFor(() => {
    assert.equal(restored.queryByRole("button", { name: /订单能不能接/ }), null);
  });
  assert.equal(JSON.parse(window.localStorage.getItem("semantica.reasoning.history") ?? "[]").length, 0);
  assert.ok(restored.getByText("还没有推理记录"));
});

test("asks the AI for a session title only when reasoning runs", async () => {
  let titleCalls = 0;
  const fetchMock = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/reason/title")) {
      titleCalls += 1;
      return new Response(JSON.stringify({ title: "产能是否够接单" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      facts: [],
      rules: [],
      inferred_facts: [],
      answer: "可以接单",
      rules_fired: 0,
      added_edges: 0,
      mutated: false,
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  window.fetch = fetchMock;
  globalThis.fetch = fetchMock;

  const view = mount();
  fireEvent.click(view.getByRole("button", { name: "新会话" }));
  fireEvent.change(view.getByRole("textbox"), { target: { value: "来了一张50万件的订单，8小时内交，车间产能够不够接？" } });

  assert.equal(titleCalls, 0);
  assert.ok(view.getByRole("button", { name: /来了一张50万件的订单/ }));
  fireEvent.click(view.getByRole("button", { name: "运行推理" }));
  await view.findByRole("button", { name: /产能是否够接单/ });
  assert.equal(titleCalls, 1);
  assert.equal(view.getByRole("textbox").value, "来了一张50万件的订单，8小时内交，车间产能够不够接？");
});
