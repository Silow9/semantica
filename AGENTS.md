# 测试

跑 Python 测试时使用本机 conda 环境 `Semantic`。不要直接调用系统自带的 `python`，那个环境里没有本仓库的依赖。

```powershell
conda activate Semantic
python -m pytest tests/explorer/test_ragflow_document_parse.py -q --tb=short
```
