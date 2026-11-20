"""Turn a natural-language reasoning request into facts and IF/THEN rules via the configured LLM."""

from __future__ import annotations

import json
import re
from typing import Any

from .model_settings import chat

SYSTEM_PROMPT = """You convert a user's natural-language description into input for a forward-chaining rule engine.

Reply with a single JSON object and nothing else:
{"facts": ["..."], "rules": ["..."], "answer": "...", "reason": "..."}

answer is a short verdict in the same language as the user. For a capacity question it must say whether to accept with the machines already running, accept only by starting spare machines, or reject.
reason is one or two sentences in that same language and must cite the quantities behind the verdict, such as how many pieces the running machines can finish before the deadline and how many the full workshop can finish.

Fact syntax:
- predicate(subject, object), one fact per array item. Unary facts predicate(subject) are allowed.
- Predicates are lower_snake_case English verbs or relations, e.g. inhibits, causes, treats, located_in.
- Arguments are entity names exactly as the user wrote them. Keep the user's language for entity names; do not translate them.
- Arguments must not contain commas or parentheses. Do not quote them.

Rule syntax:
- IF condition AND condition ... THEN conclusion
- Every condition and the conclusion use the fact syntax above.
- Variables start with ? and are lowercase, e.g. ?x, ?drug. Use variables to generalise; use concrete names only when the user is talking about specific entities.
- Every variable in the conclusion must appear in at least one condition.
- Prefer binary conclusions predicate(?a, ?b), because binary conclusions become edges in the knowledge graph.

Content rules:
- Extract only facts the user stated or that the existing graph facts provide. Do not invent facts.
- Write rules that capture the inference the user is asking for. If the user only states facts and asks a question, write the rule that would answer it.
- Reuse the same predicate name for the same relation in facts and rules so the rules can match.
- If the request contains nothing to reason about, return {"facts": [], "rules": []}.
- Keep it short: at most 8 facts and 3 rules. A quantity is one fact, such as running_machines(workshop, 36). Never expand a count into one fact per item.
- The engine only checks whether each condition exactly matches a listed fact. It cannot multiply, compare numbers, or compute a new value.
- When the question needs arithmetic, calculate it yourself and add the result as a fact. Then write one rule whose every condition is copied from those facts and whose conclusion states the answer. Example: IF order_quantity(订单, 500000) AND available_output(车间, 449280) THEN needs_spare_machines(订单, 车间)."""

_MAX_TOKENS = 2000
_TIMEOUT = 90.0
# Kimi-style thinking models otherwise fill max_tokens with reasoning and return an empty content field.
_JSON_EXTRAS = (
    {"temperature": 0, "chat_template_kwargs": {"enable_thinking": False}, "response_format": {"type": "json_object"}},
    {"temperature": 0, "chat_template_kwargs": {"enable_thinking": False}},
    {},
)


class NaturalReasoningError(RuntimeError):
    """The LLM reply could not be turned into facts and rules."""


def build_prompt(text: str, graph_facts: list[str]) -> str:
    parts = [f"User request:\n{text.strip()}"]
    if graph_facts:
        parts.append("Existing graph facts you may use:\n" + "\n".join(graph_facts))
    return "\n\n".join(parts)


def _extract_json(reply: str) -> dict[str, Any]:
    cleaned = re.sub(r"<think>.*?</think>", "", reply, flags=re.DOTALL | re.IGNORECASE)
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned.strip(), flags=re.IGNORECASE)
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        shown = reply.strip()[:200] or "模型没有返回正文，思考过程占满了输出长度"
        raise NaturalReasoningError(f"LLM reply is not JSON: {shown}")
    try:
        data = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError as exc:
        raise NaturalReasoningError(f"LLM reply is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise NaturalReasoningError("LLM reply must be a JSON object.")
    return data


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [" ".join(str(item).split()) for item in value if str(item).strip()]


def _plain_text(value: Any) -> str:
    return " ".join(str(value or "").split())


_TITLE_PROMPT = """Write a short session title for the user's question.
Use the same language as the question.
Return only the title, at most 16 Chinese characters or 8 English words.
Do not add quotes or a trailing period."""


def clean_session_title(reply: str) -> str:
    cleaned = re.sub(r"<think>.*?</think>", "", reply, flags=re.DOTALL | re.IGNORECASE)
    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    title = (lines[0] if lines else "").strip("\"'“”‘’").rstrip("。.!！")
    return " ".join(title.split())[:24]


def summarize_session_title(settings: dict[str, str], text: str) -> str:
    reply = chat(
        settings,
        text.strip()[:2000],
        max_tokens=64,
        system=_TITLE_PROMPT,
        extra={"temperature": 0, "chat_template_kwargs": {"enable_thinking": False}},
        timeout=30,
    )
    title = clean_session_title(reply)
    if not title:
        raise NaturalReasoningError("LLM returned an empty session title.")
    return title


def generate_facts_and_rules(
    settings: dict[str, str],
    text: str,
    graph_facts: list[str] | None = None,
) -> tuple[list[str], list[str], str, str]:
    prompt = build_prompt(text, graph_facts or [])
    last_error: Exception | None = None
    for extra in _JSON_EXTRAS:
        try:
            reply = chat(settings, prompt, max_tokens=_MAX_TOKENS, system=SYSTEM_PROMPT, extra=extra or None, timeout=_TIMEOUT)
        except RuntimeError as exc:
            last_error = exc
            if "HTTP 400" in str(exc):
                continue
            raise
        data = _extract_json(reply)
        return (
            _string_list(data.get("facts")),
            _string_list(data.get("rules")),
            _plain_text(data.get("answer")),
            _plain_text(data.get("reason")),
        )
    raise NaturalReasoningError(str(last_error) if last_error else "LLM request failed")
