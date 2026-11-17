# 界面文案（i18n）

Explorer 里用户能看到的句子、按钮、占位符、提示和状态，都走 `explorer/src/i18n`，不要在组件里直接写中文或英文。

- 文案表在 `explorer/src/i18n/messages.ts`。新增一条文案时，`en` 和 `zh` 使用同一个 key。`zh` 的类型是 `Record<MessageKey, string>`，漏掉中文会在类型检查里失败。
- 组件通过 `useI18n()` 取 `t`。固定句子写 `t("some.key")`；带变量的句子在文案里用 `{name}` 占位，调用时写 `t("some.key", { name })`。
- 本体中心在 `explorer/src/workspaces/OntologyWorkspace`。注册表、编辑器、版本、对齐、健康和 SHACL 都用同一套 key。URI、Turtle、SHACL、OWL、SKOS 这类技术标识保留原文。
- 后端返回的固定状态、分类和句式，在前端按 key 映射到文案表。匹配不上的原文可以原样显示，不要在 JSX 里再写一套中文。

# 测试

跑 Python 测试时使用本机 conda 环境 `Semantic`。不要直接调用系统自带的 `python`，那个环境里没有本仓库的依赖。

```powershell
conda activate Semantic
python -m pytest tests/explorer/test_ragflow_document_parse.py -q --tb=short
```
