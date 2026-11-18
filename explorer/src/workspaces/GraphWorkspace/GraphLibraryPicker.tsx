import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Database, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useI18n } from "../../i18n";
import { GRAPH_THEME } from "./graphTheme";
import {
  GRAPH_LIBRARY_QUERY_KEY,
  requestGraphLibrary as requestJson,
  useGraphLibrary,
  type GraphLibraryEntry,
} from "./graphLibrary";

const jsonHeaders = { "Content-Type": "application/json" };

export function GraphLibraryPicker({ disabled = false }: { disabled?: boolean }) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelBox, setPanelBox] = useState<{ top: number; left: number } | null>(null);
  const { data, isLoading } = useGraphLibrary();

  const placePanel = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 340;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    setPanelBox({ top: rect.bottom + 8, left });
  }, []);

  const activeGraph = data?.graphs.find((graph) => graph.id === data.active_id) ?? null;

  useEffect(() => {
    if (!open) return;
    placePanel();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", placePanel);
    window.addEventListener("scroll", placePanel, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", placePanel);
      window.removeEventListener("scroll", placePanel, true);
    };
  }, [open, placePanel]);

  const reloadEverything = () => queryClient.invalidateQueries(undefined, { cancelRefetch: false });
  const refreshListing = () => queryClient.invalidateQueries({ queryKey: GRAPH_LIBRARY_QUERY_KEY });
  const onFailure = (reason: unknown) => setError(reason instanceof Error ? reason.message : t("graphs.failed"));

  const activate = useMutation({
    mutationFn: (graphId: string) => requestJson<GraphLibraryEntry>(`/api/graphs/${graphId}/activate`, { method: "POST" }),
    onSuccess: () => {
      setOpen(false);
      void reloadEverything();
    },
    onError: onFailure,
  });

  const create = useMutation({
    mutationFn: (name: string) => requestJson<GraphLibraryEntry>("/api/graphs", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ name, activate: true }),
    }),
    onSuccess: () => {
      setNewName("");
      setOpen(false);
      void reloadEverything();
    },
    onError: onFailure,
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => requestJson<GraphLibraryEntry>(`/api/graphs/${id}`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ name }),
    }),
    onSuccess: () => {
      setEditingId(null);
      void refreshListing();
    },
    onError: onFailure,
  });

  const remove = useMutation({
    mutationFn: (graphId: string) => requestJson<{ status: string }>(`/api/graphs/${graphId}`, { method: "DELETE" }),
    onSuccess: () => void refreshListing(),
    onError: onFailure,
  });

  const busy = activate.isPending || create.isPending || rename.isPending || remove.isPending;

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    setError(null);
    create.mutate(name);
  };

  const handleRename = (event: FormEvent, graphId: string) => {
    event.preventDefault();
    const name = editingName.trim();
    if (!name || busy) return;
    setError(null);
    rename.mutate({ id: graphId, name });
  };

  const handleDelete = (graph: GraphLibraryEntry) => {
    if (!window.confirm(t("graphs.deleteConfirm", { name: graph.name }))) return;
    setError(null);
    remove.mutate(graph.id);
  };

  const formatDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleString(locale === "zh" ? "zh-CN" : "en", { dateStyle: "short", timeStyle: "short" });
  };

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <style>{GRAPH_LIBRARY_PICKER_CSS}</style>
      <button
        type="button"
        className="explore-graph-picker-trigger"
        disabled={disabled || isLoading}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("graphs.pickerTitle")}
        onClick={() => {
          setError(null);
          setOpen((current) => !current);
        }}
      >
        {activate.isPending || create.isPending ? <Loader2 size={13} className="explore-graph-picker-spin" /> : <Database size={13} />}
        <span className="explore-graph-picker-name">{activeGraph?.name ?? t("graphs.loading")}</span>
        <ChevronDown size={13} />
      </button>

      {open && panelBox ? createPortal(
        <div
          ref={panelRef}
          className="explore-graph-picker-panel"
          role="dialog"
          aria-label={t("graphs.pickerTitle")}
          style={{ top: panelBox.top, left: panelBox.left }}
        >
          <div className="explore-graph-picker-heading">{t("graphs.heading", { count: data?.graphs.length ?? 0 })}</div>
          <ul className="explore-graph-picker-list">
            {(data?.graphs ?? []).map((graph) => (
              <li key={graph.id} data-active={graph.active}>
                {editingId === graph.id ? (
                  <form className="explore-graph-picker-row" onSubmit={(event) => handleRename(event, graph.id)}>
                    <input
                      autoFocus
                      className="explore-graph-picker-input"
                      value={editingName}
                      maxLength={80}
                      onChange={(event) => setEditingName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.stopPropagation();
                          setEditingId(null);
                        }
                      }}
                    />
                    <button type="submit" className="explore-graph-picker-icon" disabled={busy || !editingName.trim()} title={t("graphs.save")}>
                      <Check size={13} />
                    </button>
                  </form>
                ) : (
                  <div className="explore-graph-picker-row">
                    <button
                      type="button"
                      className="explore-graph-picker-select"
                      disabled={busy || graph.active}
                      onClick={() => {
                        setError(null);
                        activate.mutate(graph.id);
                      }}
                    >
                      <span className="explore-graph-picker-mark">{graph.active ? <Check size={13} /> : null}</span>
                      <span className="explore-graph-picker-copy">
                        <span className="explore-graph-picker-title">{graph.name}</span>
                        <span className="explore-graph-picker-meta">
                          {t("graphs.counts", {
                            nodes: graph.node_count.toLocaleString(),
                            edges: graph.edge_count.toLocaleString(),
                          })}
                          {formatDate(graph.updated_at) ? ` · ${t("graphs.updated", { time: formatDate(graph.updated_at) })}` : ""}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="explore-graph-picker-icon"
                      disabled={busy}
                      title={t("graphs.rename")}
                      onClick={() => {
                        setEditingId(graph.id);
                        setEditingName(graph.name);
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      className="explore-graph-picker-icon"
                      disabled={busy || graph.active}
                      title={graph.active ? t("graphs.deleteActive") : t("graphs.delete")}
                      onClick={() => handleDelete(graph)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <form className="explore-graph-picker-create" onSubmit={handleCreate}>
            <input
              className="explore-graph-picker-input"
              value={newName}
              maxLength={80}
              placeholder={t("graphs.newPlaceholder")}
              onChange={(event) => setNewName(event.target.value)}
            />
            <button type="submit" className="explore-graph-picker-create-btn" disabled={busy || !newName.trim()}>
              <Plus size={13} />
              {t("graphs.create")}
            </button>
          </form>
          <div className="explore-graph-picker-hint">{t("graphs.hint")}</div>
          {error ? <div className="explore-graph-picker-error">{error}</div> : null}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

const GRAPH_LIBRARY_PICKER_CSS = `
  .explore-graph-picker-trigger {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    max-width: 260px;
    height: 28px;
    padding: 0 10px;
    border-radius: 999px;
    border: 1px solid ${GRAPH_THEME.ui.control.activeBorder};
    background: rgba(74, 181, 166, 0.12);
    color: ${GRAPH_THEME.ui.control.activeText};
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
  }
  .explore-graph-picker-trigger:disabled { opacity: 0.6; cursor: default; }
  .explore-graph-picker-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .explore-graph-picker-spin { animation: explore-graph-picker-rotate 0.9s linear infinite; }
  @keyframes explore-graph-picker-rotate { to { transform: rotate(360deg); } }
  .explore-graph-picker-panel {
    position: fixed;
    z-index: 80;
    width: 340px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-radius: 14px;
    border: 1px solid rgba(232, 234, 237, 0.32);
    background: ${GRAPH_THEME.ui.surface.app};
    box-shadow:
      0 0 6px rgba(232, 234, 237, 0.18),
      0 18px 40px rgba(0, 0, 0, 0.5);
    color: ${GRAPH_THEME.ui.text.body};
  }
  .explore-graph-picker-heading {
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.04em;
    color: ${GRAPH_THEME.ui.text.muted};
    padding: 0 4px;
  }
  .explore-graph-picker-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 300px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .explore-graph-picker-list li { border-radius: 10px; }
  .explore-graph-picker-list li[data-active="true"] { background: rgba(74, 181, 166, 0.12); }
  .explore-graph-picker-row { display: flex; align-items: center; gap: 4px; padding: 2px; }
  .explore-graph-picker-select {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .explore-graph-picker-select:hover:not(:disabled) { background: ${GRAPH_THEME.ui.control.hoverBg}; }
  .explore-graph-picker-select:disabled { cursor: default; }
  .explore-graph-picker-mark {
    width: 14px;
    flex: none;
    display: inline-flex;
    color: ${GRAPH_THEME.ui.control.activeText};
  }
  .explore-graph-picker-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .explore-graph-picker-title {
    font-size: 13px;
    font-weight: 600;
    color: ${GRAPH_THEME.ui.text.strong};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .explore-graph-picker-meta { font-size: 11px; color: ${GRAPH_THEME.ui.text.muted}; }
  .explore-graph-picker-icon {
    flex: none;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    color: ${GRAPH_THEME.ui.text.muted};
    cursor: pointer;
  }
  .explore-graph-picker-icon:hover:not(:disabled) {
    background: ${GRAPH_THEME.ui.control.hoverBg};
    color: ${GRAPH_THEME.ui.text.strong};
  }
  .explore-graph-picker-icon:disabled { opacity: 0.35; cursor: default; }
  .explore-graph-picker-create {
    display: flex;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid ${GRAPH_THEME.ui.control.defaultBorder};
  }
  .explore-graph-picker-input {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 9px;
    border-radius: 8px;
    border: 1px solid ${GRAPH_THEME.ui.control.inputBorder};
    background: rgba(0, 0, 0, 0.22);
    color: ${GRAPH_THEME.ui.text.strong};
    font-size: 12px;
  }
  .explore-graph-picker-create-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid ${GRAPH_THEME.ui.control.activeBorder};
    background: rgba(74, 181, 166, 0.18);
    color: ${GRAPH_THEME.ui.control.activeText};
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .explore-graph-picker-create-btn:disabled { opacity: 0.45; cursor: default; }
  .explore-graph-picker-hint { font-size: 11px; color: ${GRAPH_THEME.ui.text.muted}; padding: 0 2px; }
  .explore-graph-picker-error { font-size: 12px; color: #ff8f8f; padding: 0 2px; }
`;
