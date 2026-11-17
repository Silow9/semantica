"""RAGFlow-shaped parsers for the formats that can run without CGO.

Each parser returns the same payload the Go ``ParseResult`` projects onto
the wire: file metadata plus items of ``{text, doc_type_kwd}``.
"""

from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from html import escape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

MAX_ITEMS = 5000
TABLE_CHUNK_CHARS = 2000
CSV_SAMPLE_BYTES = 64 * 1024
CSV_SAMPLE_ROWS = 20
CSV_DELIMITERS = [",", ";", "\t", "|"]

_TEXT_SUFFIXES = {
    ".txt", ".text", ".log",
    ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".cpp", ".h",
    ".php", ".go", ".sh", ".cs", ".kt", ".sql", ".css", ".xml", ".yaml", ".yml",
}
_MARKDOWN_SUFFIXES = {".md", ".markdown"}
_HTML_SUFFIXES = {".html", ".htm"}
_CSV_SUFFIXES = {".csv", ".tsv"}
_JSON_SUFFIXES = {".json", ".jsonl", ".ldjson"}
_DOCX_SUFFIXES = {".docx"}
_XLSX_SUFFIXES = {".xlsx"}
_PDF_SUFFIXES = {".pdf"}
_NATIVE_ONLY = {
    ".doc": "DOCParser",
    ".ppt": "PPTParser",
    ".pptx": "PPTXParser",
    ".xls": "XLSParser",
}

_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_X_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
_CELL_REF = re.compile(r"^([A-Z]+)")


def parse_bytes(filename: str, data: bytes) -> dict[str, Any]:
    """Parse one uploaded file into RAGFlow parser items."""
    suffix = Path(filename or "").suffix.lower()
    if suffix in _TEXT_SUFFIXES:
        return _parse_text(filename, data, "TextParser", "txt")
    if suffix in _MARKDOWN_SUFFIXES:
        return _finish(filename, data, "MarkdownParser", "markdown", _markdown_items(data))
    if suffix in _HTML_SUFFIXES:
        return _finish(filename, data, "HTMLParser", "html", _html_items(data))
    if suffix in _CSV_SUFFIXES:
        return _parse_csv(filename, data)
    if suffix in _JSON_SUFFIXES:
        return _finish(filename, data, "JSONParser", "json", _json_items(data))
    if suffix in _DOCX_SUFFIXES:
        return _parse_docx(filename, data)
    if suffix in _XLSX_SUFFIXES:
        return _parse_xlsx(filename, data)
    if suffix in _PDF_SUFFIXES:
        return _parse_pdf(filename, data)
    if suffix in _NATIVE_ONLY:
        parser_name = _NATIVE_ONLY[suffix]
        return _error(
            filename,
            parser_name,
            suffix.lstrip("."),
            f"{parser_name} requires the RAGFlow native office engine (office_oxide), "
            "which is not linked into this process.",
        )
    return _error(
        filename,
        "",
        suffix.lstrip("."),
        f"Unsupported file type '{suffix or '(none)'}'.",
    )


def _parse_text(filename: str, data: bytes, parser: str, fmt: str) -> dict[str, Any]:
    text, encoding = _decode(data)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return _payload(filename, data, parser, fmt, encoding, [{"text": text, "doc_type_kwd": "text"}], [])


def _finish(filename: str, data: bytes, parser: str, fmt: str, parsed: tuple[list[dict[str, Any]], list[str], str]) -> dict[str, Any]:
    items, warnings, encoding = parsed
    return _payload(filename, data, parser, fmt, encoding, items, warnings)


def _decode(data: bytes) -> tuple[str, str]:
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return data.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace"), "utf-8"


def _payload(
    filename: str,
    data: bytes,
    parser: str,
    fmt: str,
    encoding: str,
    items: list[dict[str, Any]],
    warnings: list[str],
) -> dict[str, Any]:
    clipped = list(warnings)
    if len(items) > MAX_ITEMS:
        clipped.append(f"truncated to the first {MAX_ITEMS} items")
        items = items[:MAX_ITEMS]
    return {
        "name": Path(filename).name or "upload",
        "size": len(data),
        "parser": parser,
        "format": fmt,
        "encoding": encoding,
        "items": items,
        "warnings": clipped,
        "error": None,
    }


def _error(filename: str, parser: str, fmt: str, message: str) -> dict[str, Any]:
    return {
        "name": Path(filename).name or "upload",
        "size": 0,
        "parser": parser,
        "format": fmt,
        "encoding": "",
        "items": [],
        "warnings": [],
        "error": message,
    }


def _markdown_items(data: bytes) -> tuple[list[dict[str, Any]], list[str], str]:
    text, encoding = _decode(data)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    items: list[dict[str, Any]] = []
    paragraph: list[str] = []
    in_fence = False

    def flush() -> None:
        block = "\n".join(paragraph).strip()
        paragraph.clear()
        if block:
            items.append({"text": block, "doc_type_kwd": "text"})

    lines = text.split("\n")
    index = 0
    while index < len(lines):
        line = lines[index]
        if line.startswith("```"):
            flush()
            in_fence = not in_fence
            index += 1
            continue
        if in_fence:
            paragraph.append(line)
            index += 1
            continue
        if _is_table_row(line) and index + 1 < len(lines) and re.match(r"^\s*\|?\s*:?-{3,}", lines[index + 1]):
            flush()
            table_lines = [line]
            index += 2
            while index < len(lines) and _is_table_row(lines[index]):
                table_lines.append(lines[index])
                index += 1
            items.append({"text": _markdown_table_html(table_lines), "doc_type_kwd": "table"})
            continue
        if not line.strip():
            flush()
        else:
            paragraph.append(line.strip())
        index += 1
    flush()
    if not items:
        items = [{"text": "", "doc_type_kwd": "text"}]
    return items, [], encoding


def _is_table_row(line: str) -> bool:
    stripped = line.strip()
    return stripped.startswith("|") and stripped.count("|") >= 2


def _markdown_table_html(lines: list[str]) -> str:
    rows = [_split_md_row(line) for line in lines]
    return _html_table(rows)


def _split_md_row(line: str) -> list[str]:
    cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
    return cells


def _html_items(data: bytes) -> tuple[list[dict[str, Any]], list[str], str]:
    text, encoding = _decode(data)
    extractor = _HTMLBlockExtractor()
    extractor.feed(text)
    extractor.close()
    items = extractor.items or [{"text": "", "doc_type_kwd": "text"}]
    return items, [], encoding


class _HTMLBlockExtractor(HTMLParser):
    _SKIP = {"script", "style", "noscript", "template", "head"}
    _BREAKS = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "br", "section", "article"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.items: list[dict[str, Any]] = []
        self._skip = 0
        self._text: list[str] = []
        self._table_depth = 0
        self._rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self._SKIP:
            self._skip += 1
        if self._skip:
            return
        if tag == "table":
            self._flush_text()
            self._table_depth += 1
            if self._table_depth == 1:
                self._rows = []
        elif self._table_depth and tag == "tr":
            self._row = []
        elif self._table_depth and tag in {"td", "th"}:
            self._cell = []
        elif tag in self._BREAKS and self._table_depth == 0:
            self._flush_text()

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP and self._skip:
            self._skip -= 1
            return
        if self._skip:
            return
        if tag in {"td", "th"} and self._cell is not None and self._row is not None:
            self._row.append("".join(self._cell).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self._rows.append(self._row)
            self._row = None
        elif tag == "table" and self._table_depth:
            self._table_depth -= 1
            if self._table_depth == 0:
                self.items.append({"text": _html_table(self._rows), "doc_type_kwd": "table"})
                self._rows = []
        elif tag in self._BREAKS and self._table_depth == 0:
            self._flush_text()

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        if self._cell is not None:
            self._cell.append(data)
        elif self._table_depth == 0:
            self._text.append(data)

    def close(self) -> None:
        super().close()
        self._flush_text()

    def _flush_text(self) -> None:
        block = re.sub(r"\s+", " ", "".join(self._text)).strip()
        self._text = []
        if block:
            self.items.append({"text": block, "doc_type_kwd": "text"})


def _json_items(data: bytes) -> tuple[list[dict[str, Any]], list[str], str]:
    text, encoding = _decode(data)
    trimmed = text.strip()
    if not trimmed:
        return [{"text": "", "doc_type_kwd": "text"}], [], encoding
    if trimmed.startswith("["):
        return _json_array(trimmed), [], encoding
    if trimmed.startswith("{"):
        try:
            json.loads(trimmed)
        except json.JSONDecodeError:
            if _looks_like_jsonl(trimmed):
                return _json_lines(trimmed), [], encoding
            return [{"text": trimmed, "doc_type_kwd": "text"}], [], encoding
        return [_json_text_item(json.loads(trimmed))], [], encoding
    if _looks_like_jsonl(trimmed):
        return _json_lines(trimmed), [], encoding
    return [{"text": trimmed, "doc_type_kwd": "text"}], [], encoding


def _json_array(text: str) -> list[dict[str, Any]]:
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return [{"text": text, "doc_type_kwd": "text"}]
    if not isinstance(value, list) or not value:
        return [{"text": "", "doc_type_kwd": "text"}]
    return [_json_text_item(element) for element in value]


def _json_lines(text: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            items.append(_json_text_item(json.loads(stripped)))
        except json.JSONDecodeError:
            continue
    return items or [{"text": "", "doc_type_kwd": "text"}]


def _looks_like_jsonl(text: str) -> bool:
    objects = 0
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            objects += 1
            if objects >= 2:
                return True
    return False


def _json_text_item(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        return {"text": value, "doc_type_kwd": "text"}
    return {"text": json.dumps(value, ensure_ascii=False), "doc_type_kwd": "text"}


def _parse_csv(filename: str, data: bytes) -> dict[str, Any]:
    text, encoding = _decode(data)
    if not text.strip():
        return _payload(filename, data, "CSVParser", "csv", encoding, [], [])
    delimiter = "\t" if Path(filename).suffix.lower() == ".tsv" else _detect_delimiter(text)
    rows = _read_csv(text, delimiter)
    if not rows:
        return _payload(filename, data, "CSVParser", "csv", encoding, [], [])
    return _payload(filename, data, "CSVParser", "csv", encoding, _table_segments(rows), [])


def _detect_delimiter(text: str) -> str:
    sample = text
    truncated = False
    if len(text.encode("utf-8")) > CSV_SAMPLE_BYTES:
        sample = text[:CSV_SAMPLE_BYTES]
        truncated = True
    best, best_columns = ",", 0
    for delimiter in CSV_DELIMITERS:
        columns = _consistent_columns(sample, delimiter, truncated)
        if columns > best_columns:
            best, best_columns = delimiter, columns
    return best


def _consistent_columns(sample: str, delimiter: str, truncated: bool) -> int:
    rows: list[list[str]] = []
    reader = csv.reader(io.StringIO(sample), delimiter=delimiter, skipinitialspace=delimiter != "\t")
    for row in reader:
        if len(rows) >= CSV_SAMPLE_ROWS:
            break
        if any(cell.strip() for cell in row):
            rows.append(row)
    if truncated and len(rows) > 1:
        rows = rows[:-1]
    count = 0
    for row in rows:
        if count and len(row) != count:
            return 0
        count = len(row)
    return count if count > 1 else 0


def _read_csv(text: str, delimiter: str) -> list[list[str]]:
    reader = csv.reader(io.StringIO(text), delimiter=delimiter, skipinitialspace=delimiter != "\t")
    return [[_clean_cell(cell) for cell in row] for row in reader if any(cell.strip() for cell in row)]


def _clean_cell(value: str) -> str:
    return "".join(ch if ch >= " " or ch in "\t" else " " for ch in value).strip()


def _parse_docx(filename: str, data: bytes) -> dict[str, Any]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as package:
            xml = package.read("word/document.xml")
    except (zipfile.BadZipFile, KeyError) as exc:
        return _error(filename, "DOCXParser", "docx", f"DOCXParser: {exc}")
    items = _docx_items(xml)
    return _payload(filename, data, "DOCXParser", "docx", "utf-8", items or [{"text": "", "doc_type_kwd": "text"}], [])


def _docx_items(xml: bytes) -> list[dict[str, Any]]:
    root = ET.fromstring(xml)
    body = root.find(f"{{{_W_NS}}}body")
    if body is None:
        return []
    items: list[dict[str, Any]] = []
    for child in list(body):
        if child.tag == f"{{{_W_NS}}}p":
            text = "".join(node.text or "" for node in child.iter(f"{{{_W_NS}}}t")).strip()
            if text:
                items.append({"text": text, "doc_type_kwd": "text"})
        elif child.tag == f"{{{_W_NS}}}tbl":
            rows = []
            for row in child.findall(f"{{{_W_NS}}}tr"):
                cells = [
                    "".join(node.text or "" for node in cell.iter(f"{{{_W_NS}}}t")).strip()
                    for cell in row.findall(f"{{{_W_NS}}}tc")
                ]
                rows.append(cells)
            items.append({"text": _html_table(rows), "doc_type_kwd": "table"})
    return items


def _parse_xlsx(filename: str, data: bytes) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as package:
            shared = _shared_strings(package)
            for index, (sheet_name, part) in enumerate(_sheet_parts(package), start=1):
                rows = _xlsx_rows(package.read(part), shared)
                items.extend(_table_segments(rows, caption=sheet_name, sheet_index=index))
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as exc:
        return _error(filename, "XLSXParser", "xlsx", f"XLSXParser: {exc}")
    return _payload(filename, data, "XLSXParser", "xlsx", "utf-8", items, [])


def _shared_strings(package: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in package.namelist():
        return []
    root = ET.fromstring(package.read("xl/sharedStrings.xml"))
    values = []
    for item in root.findall(f"{{{_X_NS}}}si"):
        values.append("".join(node.text or "" for node in item.iter(f"{{{_X_NS}}}t")))
    return values


def _sheet_parts(package: zipfile.ZipFile) -> list[tuple[str, str]]:
    """Return ``(sheet name, zip part)`` pairs in workbook tab order."""
    names = set(package.namelist())
    sheets: list[tuple[str, str]] = []
    if "xl/workbook.xml" in names and "xl/_rels/workbook.xml.rels" in names:
        rels = ET.fromstring(package.read("xl/_rels/workbook.xml.rels"))
        targets = {
            rel.attrib.get("Id", ""): rel.attrib.get("Target", "")
            for rel in rels.iter(f"{{{_PKG_REL_NS}}}Relationship")
        }
        workbook = ET.fromstring(package.read("xl/workbook.xml"))
        for sheet in workbook.iter(f"{{{_X_NS}}}sheet"):
            target = targets.get(sheet.attrib.get(f"{{{_R_NS}}}id", ""), "")
            part = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
            if part in names:
                sheets.append((sheet.attrib.get("name", ""), part))
    if sheets:
        return sheets
    parts = [name for name in names if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name)]
    if not parts:
        raise KeyError("xl/worksheets/sheet")
    parts.sort(key=lambda name: int(re.search(r"(\d+)\.xml$", name).group(1)))
    return [(Path(name).stem, name) for name in parts]


def _column_index(ref: str) -> int | None:
    match = _CELL_REF.match(ref)
    if not match:
        return None
    index = 0
    for letter in match.group(1):
        index = index * 26 + ord(letter) - ord("A") + 1
    return index - 1


def _xlsx_rows(xml: bytes, shared: list[str]) -> list[list[str]]:
    root = ET.fromstring(xml)
    rows: list[list[str]] = []
    for row in root.iter(f"{{{_X_NS}}}row"):
        cells: list[str] = []
        for cell in row.findall(f"{{{_X_NS}}}c"):
            column = _column_index(cell.attrib.get("r", ""))
            if column is not None and column > len(cells):
                cells.extend([""] * (column - len(cells)))
            kind = cell.attrib.get("t", "")
            value_node = cell.find(f"{{{_X_NS}}}v")
            if kind == "s" and value_node is not None and value_node.text:
                index = int(value_node.text)
                cells.append(shared[index] if 0 <= index < len(shared) else "")
            elif kind == "inlineStr":
                cells.append("".join(node.text or "" for node in cell.iter(f"{{{_X_NS}}}t")))
            elif value_node is not None and value_node.text:
                cells.append(value_node.text)
            else:
                cells.append("")
        if any(cell.strip() for cell in cells):
            rows.append(cells)
    return rows


def _table_segments(
    rows: list[list[str]],
    caption: str = "",
    sheet_index: int | None = None,
    budget: int = TABLE_CHUNK_CHARS,
) -> list[dict[str, Any]]:
    """Split a table into header-repeating segments of at most ``budget`` data characters."""
    if not rows:
        return []
    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]
    header, body = rows[0], rows[1:]
    groups: list[list[list[str]]] = []
    current: list[list[str]] = []
    size = 0
    for row in body:
        row_size = sum(len(cell) for cell in row)
        if current and size + row_size > budget:
            groups.append(current)
            current, size = [], 0
        current.append(row)
        size += row_size
    if current or not groups:
        groups.append(current)
    items: list[dict[str, Any]] = []
    for group in groups:
        item: dict[str, Any] = {"text": _html_table([header, *group], caption), "doc_type_kwd": "table"}
        if sheet_index is not None:
            item["sheet_index"] = sheet_index
            item["sheet"] = caption
        items.append(item)
    return items


def _parse_pdf(filename: str, data: bytes) -> dict[str, Any]:
    try:
        import pdfplumber
    except ImportError:
        return _error(
            filename,
            "PDFParser",
            "pdf",
            "PDFParser needs pdfplumber. Install the explorer extra: pip install semantica[explorer].",
        )
    items = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            extracted = page.extract_text() or ""
            items.append({"text": extracted.replace("\r\n", "\n").replace("\r", "\n"), "doc_type_kwd": "text"})
    return _payload(filename, data, "PDFParser", "pdf", "utf-8", items or [{"text": "", "doc_type_kwd": "text"}], [])


def _html_table(rows: list[list[str]], caption: str = "") -> str:
    if not rows:
        return "<table></table>"
    caption_html = f"<caption>{escape(caption)}</caption>" if caption else ""
    head, body = rows[0], rows[1:]
    header = "".join(f"<th>{escape(cell)}</th>" for cell in head)
    body_html = "".join(
        "<tr>" + "".join(f"<td>{escape(cell)}</td>" for cell in row) + "</tr>"
        for row in body
    )
    return f"<table>{caption_html}<thead><tr>{header}</tr></thead><tbody>{body_html}</tbody></table>"
