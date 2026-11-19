import { useCallback, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useDropzone } from "react-dropzone";
import { AlertCircle, CheckCircle2, FileText, Loader2, Network, Trash2, UploadCloud, X } from "lucide-react";
import { useI18n } from "../../i18n";
import type { MessageKey } from "../../i18n/messages";
import { DataWorkspace } from "../DataWorkspace/DataWorkspace";

type ExtractionMethod = "llm" | "ml" | "pattern";

type GraphBuildSummary = {
  method: ExtractionMethod;
  chunks: number;
  entities: number;
  relationships: number;
  nodes_added: number;
  edges_added: number;
  built_at: string;
  graph_name?: string;
};

type DocumentSummary = {
  id: string;
  name: string;
  status: "done" | "failed";
  format: string;
  parser: string;
  item_count: number;
  error: string | null;
  graph?: GraphBuildSummary;
};

type DocumentLibrary = {
  id: string;
  name: string;
  graph_id: string | null;
  graph_name: string | null;
  document_count: number;
  active: boolean;
};

type BuildOptions = {
  methods: { id: ExtractionMethod; available: boolean }[];
  default: ExtractionMethod;
};

const methodLabels: Record<ExtractionMethod, MessageKey> = {
  llm: "docs.methodLlm",
  ml: "docs.methodMl",
  pattern: "docs.methodPattern",
};

type ParsedItem = {
  text: string;
  doc_type_kwd: string;
  sheet?: string;
  sheet_index?: number;
};

type DocumentDetail = DocumentSummary & {
  items: ParsedItem[];
};

type BuildStepId = "ingest" | "parse" | "extract" | "build" | "write";
type BuildStepState = "done" | "running" | "pending" | "failed";

type BuildJob = {
  active: boolean;
  document_id: string | null;
  document_name: string | null;
  library_id: string | null;
  library_name: string | null;
  graph_name: string | null;
  method: ExtractionMethod | null;
  stage: string | null;
  steps: { id: BuildStepId; state: BuildStepState }[];
  processed: number;
  total: number;
  documents_processed: number;
  documents_total: number;
  entities: number;
  relationships: number;
  triplets: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
};

const stepLabels: Record<BuildStepId, MessageKey> = {
  ingest: "docs.stepIngest",
  parse: "docs.stepParse",
  extract: "docs.stepExtract",
  build: "docs.stepBuild",
  write: "docs.stepWrite",
};

const extractStageLabels: Record<string, MessageKey> = {
  extract_entities: "docs.extractEntities",
  extract_relations: "docs.extractRelations",
  extract_triplets: "docs.extractTriplets",
};

const stepColor: Record<BuildStepState, string> = {
  done: "var(--ws-green)",
  running: "var(--ws-accent)",
  failed: "var(--ws-red)",
  pending: "var(--ws-text)",
};

function stageDetail(job: BuildJob, translate: (key: MessageKey, vars?: Record<string, string | number>) => string): string {
  if (job.stage === "build") return translate("docs.stageBuilding");
  if (job.stage === "write") return translate("docs.stageWriting");
  const key = job.stage ? extractStageLabels[job.stage] : undefined;
  if (!key) return "";
  if (!job.total) return translate("docs.extractPending");
  return translate(key, { processed: job.processed, total: job.total });
}

const MAX_PENDING_FILES = 20;
const VISIBLE_FILE_COUNT = 5;

const fileChipStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  minWidth: 0,
  padding: "2px 6px",
  border: "1px solid var(--ws-border)",
  borderRadius: 6,
  background: "rgba(255,255,255,0.03)",
};

const fieldStyle: CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid var(--ws-border)",
  background: "rgba(0,0,0,0.18)",
  color: "var(--ws-text)",
  fontSize: 12,
};

const fileStackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 4,
  width: "min(100%, 248px)",
  minWidth: 0,
};

function fileKey(file: File): string {
  return `${file.name}\0${file.size}\0${file.lastModified}`;
}

function mergePending(current: File[], accepted: File[]): File[] {
  const seen = new Set(current.map(fileKey));
  const next = [...current];
  for (const file of accepted) {
    const key = fileKey(file);
    if (seen.has(key) || next.length >= MAX_PENDING_FILES) continue;
    seen.add(key);
    next.push(file);
  }
  return next;
}

function documentMeta(
  document: DocumentSummary,
  job: BuildJob | null,
  translate: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  const graphLabel = document.graph
    ? document.graph.graph_name
      ? translate("docs.inNamedGraph", { name: document.graph.graph_name })
      : translate("docs.inGraph")
    : "";
  return [
    document.parser || document.format,
    document.status === "done" ? translate("docs.items", { count: document.item_count }) : translate("docs.failed"),
    job?.active && job.document_id === document.id ? translate("docs.buildingDocument") : "",
    graphLabel,
  ].filter(Boolean).join(" · ");
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { detail?: string };
    return body.detail || "Request failed";
  } catch {
    return "Request failed";
  }
}

export function DocumentsWorkspace() {
  const { t } = useI18n();
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [pending, setPending] = useState<File[]>([]);
  const [openList, setOpenList] = useState<null | "pending" | "uploaded">(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buildOptions, setBuildOptions] = useState<BuildOptions | null>(null);
  const [method, setMethod] = useState<ExtractionMethod | null>(null);
  const [building, setBuilding] = useState(false);
  const [job, setJob] = useState<BuildJob | null>(null);
  const [libraries, setLibraries] = useState<DocumentLibrary[]>([]);
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null);
  const [newLibraryName, setNewLibraryName] = useState("");
  const [screen, setScreen] = useState<"gallery" | "guide" | "library">("gallery");
  const [namingLibrary, setNamingLibrary] = useState(false);

  const loadLibraries = useCallback(async () => {
    const response = await fetch("/api/document-libraries");
    if (!response.ok) throw new Error(await readError(response));
    const body = await response.json() as { active_id: string | null; libraries: DocumentLibrary[] };
    setLibraries(body.libraries);
    setActiveLibraryId(body.active_id);
    return body;
  }, []);

  const loadDocuments = useCallback(async (libraryId?: string) => {
    const id = libraryId ?? activeLibraryId;
    if (!id) return [];
    const response = await fetch(`/api/documents?library_id=${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(await readError(response));
    const body = await response.json() as { documents: DocumentSummary[] };
    setDocuments(body.documents);
    setSelectedId((current) => body.documents.some((document) => document.id === current) ? current : null);
    return body.documents;
  }, [activeLibraryId]);

  useEffect(() => {
    let active = true;
    void loadLibraries().catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Request failed");
    });
    return () => {
      active = false;
    };
  }, [loadLibraries]);

  useEffect(() => {
    let active = true;
    void fetch("/api/documents/build-options")
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json() as Promise<BuildOptions>;
      })
      .then((options) => {
        if (!active) return;
        setBuildOptions(options);
        setMethod(options.default);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Request failed");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!activeLibraryId) return;
    let active = true;
    void loadDocuments(activeLibraryId).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Request failed");
    });
    return () => {
      active = false;
    };
  }, [activeLibraryId, loadDocuments]);

  useEffect(() => {
    let stop = false;
    let timer = 0;
    async function tick() {
      try {
        const response = await fetch("/api/documents/build-status");
        if (!response.ok || stop) return;
        const next = await response.json() as BuildJob;
        setJob((previous) => {
          if (previous?.active && !next.active) {
            void loadDocuments();
            void loadLibraries();
          }
          return next;
        });
        if (!stop) {
          timer = window.setTimeout(() => void tick(), next.active ? 1000 : 3000);
        }
      } catch {
        if (!stop) timer = window.setTimeout(() => void tick(), 3000);
      }
    }
    void tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [loadDocuments, loadLibraries]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    void fetch(`/api/documents/${selectedId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json() as Promise<DocumentDetail>;
      })
      .then((document) => {
        if (active) setDetail(document);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Request failed");
      });
    return () => {
      active = false;
    };
  }, [selectedId, job?.finished_at]);

  const onDrop = useCallback((accepted: File[]) => {
    setPending((current) => mergePending(current, accepted));
  }, []);

  function removePending(key: string) {
    setPending((current) => current.filter((file) => fileKey(file) !== key));
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    maxFiles: 20,
  });

  async function handleUpload() {
    if (pending.length === 0 || !activeLibraryId) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("library_id", activeLibraryId);
      pending.forEach((file) => body.append("files", file));
      const response = await fetch("/api/documents/upload", { method: "POST", body });
      if (!response.ok) throw new Error(await readError(response));
      const uploaded = await response.json() as { documents: DocumentSummary[] };
      setPending([]);
      await loadDocuments();
      await loadLibraries();
      if (uploaded.documents[0]) setSelectedId(uploaded.documents[0].id);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Request failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(documentId: string) {
    const response = await fetch(`/api/documents/${documentId}`, { method: "DELETE" });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    if (selectedId === documentId) setSelectedId(null);
    await loadDocuments();
    await loadLibraries();
  }

  async function handleCreateLibrary(event: FormEvent) {
    event.preventDefault();
    const name = newLibraryName.trim();
    if (!name) return;
    setError(null);
    const response = await fetch("/api/document-libraries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    setNewLibraryName("");
    setNamingLibrary(false);
    setPending([]);
    await loadLibraries();
  }

  async function openLibrary(libraryId: string) {
    if (libraryId !== activeLibraryId) {
      const response = await fetch(`/api/document-libraries/${libraryId}/activate`, { method: "POST" });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      setPending([]);
      await loadLibraries();
    }
    setScreen("library");
  }

  async function handleBuildLibrary() {
    if (!method || !activeLibraryId || job?.active) return;
    setBuilding(true);
    setError(null);
    try {
      const response = await fetch(`/api/document-libraries/${activeLibraryId}/build-graph`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      if (response.status === 409) throw new Error(t("docs.buildBusy"));
      if (!response.ok) throw new Error(await readError(response));
      await loadDocuments();
      await loadLibraries();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Request failed");
    } finally {
      setBuilding(false);
    }
  }

  const activeLibrary = libraries.find((library) => library.id === activeLibraryId) ?? null;
  const parsedCount = documents.filter((document) => document.status === "done").length;

  const listDialogs = {
    pending: {
      title: t("docs.selectedFiles"),
      body: pending.map((file) => (
        <PendingFileRow key={fileKey(file)} file={file} disabled={uploading} removeLabel={t("docs.remove")} onRemove={removePending} />
      )),
    },
    uploaded: {
      title: t("docs.allUploads"),
      body: documents.map((document) => (
        <UploadedFileRow
          key={document.id}
          document={document}
          selected={selectedId === document.id}
          meta={documentMeta(document, job, t)}
          removeLabel={t("docs.remove")}
          showMeta
          onSelect={() => {
            setSelectedId(document.id);
            setOpenList(null);
          }}
          onRemove={() => void handleDelete(document.id)}
        />
      )),
    },
  };
  const dialog = openList ? listDialogs[openList] : null;

  if (screen === "guide") {
    return (
      <div className="ws-page" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ padding: "12px 16px 0" }}>
          <button type="button" className="ws-btn ws-btn--ghost" onClick={() => setScreen("gallery")}>
            {t("docs.backToLibraries")}
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <DataWorkspace />
        </div>
      </div>
    );
  }

  if (screen === "gallery") {
    return (
      <div className="ws-page ws-scroll" style={{ padding: 20 }}>
        {error ? (
          <div style={{ display: "flex", gap: 8, color: "var(--ws-red)", fontSize: 12, marginBottom: 12 }}>
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          <section className="ws-card" style={{ padding: 16, minHeight: 168, display: "flex", flexDirection: "column", gap: 10 }}>
            {namingLibrary ? (
              <form onSubmit={(event) => void handleCreateLibrary(event)} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input
                  autoFocus
                  value={newLibraryName}
                  onChange={(event) => setNewLibraryName(event.target.value)}
                  placeholder={t("docs.libraryNew")}
                  maxLength={80}
                  style={fieldStyle}
                />
                <button type="submit" className="ws-btn ws-btn--primary" disabled={!newLibraryName.trim()} style={{ justifyContent: "center" }}>
                  {t("docs.libraryCreate")}
                </button>
                <button type="button" className="ws-btn ws-btn--ghost" onClick={() => { setNamingLibrary(false); setNewLibraryName(""); }} style={{ justifyContent: "center" }}>
                  {t("docs.close")}
                </button>
              </form>
            ) : (
              <>
                <button type="button" className="ws-btn ws-btn--primary" onClick={() => setNamingLibrary(true)} style={{ justifyContent: "center" }}>
                  {t("docs.createLibrary")}
                </button>
                <button type="button" className="ws-btn ws-btn--ghost" onClick={() => setScreen("guide")} style={{ justifyContent: "center" }}>
                  {t("docs.viewGuide")}
                </button>
              </>
            )}
          </section>
          {libraries.map((library) => (
            <button
              key={library.id}
              type="button"
              className="ws-card"
              onClick={() => void openLibrary(library.id)}
              style={{ padding: 16, minHeight: 168, textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 8, width: "100%", font: "inherit", color: "inherit" }}
            >
              <span style={{ color: "var(--ws-text)", fontWeight: 700 }}>{library.name}</span>
              <span className="ws-body" style={{ fontSize: 12 }}>{t("docs.libraryFiles", { count: library.document_count })}</span>
              {library.graph_name ? <span className="ws-body" style={{ fontSize: 12 }}>{library.graph_name}</span> : null}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="ws-page">
      <div className="ws-split ws-split--2col" style={{ gridTemplateColumns: "380px 1fr" }}>
        <div className="ws-scroll" style={{ borderRight: "1px solid var(--ws-border)", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <button type="button" className="ws-btn ws-btn--ghost" onClick={() => setScreen("gallery")} style={{ marginBottom: 10 }}>
              {t("docs.backToLibraries")}
            </button>
            <h2 className="ws-title" style={{ fontSize: 18 }}>{activeLibrary?.name ?? t("docs.title")}</h2>
            <div className="ws-body" style={{ marginTop: 4 }}>{t("docs.subtitle")}</div>
          </div>

          <div
            {...getRootProps()}
            style={{
              border: `2px dashed ${isDragActive ? "var(--ws-accent)" : "var(--ws-border)"}`,
              borderRadius: "var(--ws-radius)",
              background: isDragActive ? "var(--ws-accent-soft)" : "rgba(0,0,0,0.18)",
              padding: 22,
              textAlign: "center",
              cursor: "pointer",
            }}
          >
            <input {...getInputProps()} />
            <UploadCloud size={28} color="var(--ws-accent)" />
            <div style={{ color: "var(--ws-text)", fontWeight: 600, marginTop: 8 }}>{t("docs.drop")}</div>
            <div className="ws-body" style={{ fontSize: 11, marginTop: 6 }}>{t("docs.formats")}</div>
          </div>

          {pending.length > 0 ? (
            <div style={fileStackStyle}>
              {pending.slice(0, VISIBLE_FILE_COUNT).map((file) => (
                <PendingFileRow key={fileKey(file)} file={file} disabled={uploading} removeLabel={t("docs.remove")} onRemove={removePending} />
              ))}
              {pending.length > VISIBLE_FILE_COUNT ? (
                <MoreFilesButton label={t("docs.showAllSelected")} onClick={() => setOpenList("pending")} />
              ) : null}
            </div>
          ) : null}

          <button className="ws-btn ws-btn--primary" onClick={handleUpload} disabled={pending.length === 0 || uploading || !activeLibraryId} style={{ justifyContent: "center" }}>
            {uploading ? <><Loader2 size={15} className="ws-spin" />{t("docs.uploading")}</> : <><UploadCloud size={15} />{t("docs.upload")}</>}
          </button>

          {error ? (
            <div style={{ display: "flex", gap: 8, color: "var(--ws-red)", fontSize: 12 }}>
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          ) : null}

          {documents.length === 0 && pending.length === 0 ? <div className="ws-body">{t("docs.empty")}</div> : null}
          {documents.length > 0 ? (
            <div style={fileStackStyle}>
              {documents.slice(0, VISIBLE_FILE_COUNT).map((document) => (
                <UploadedFileRow
                  key={document.id}
                  document={document}
                  selected={selectedId === document.id}
                  meta={documentMeta(document, job, t)}
                  removeLabel={t("docs.remove")}
                  onSelect={() => setSelectedId(document.id)}
                  onRemove={() => void handleDelete(document.id)}
                />
              ))}
              {documents.length > VISIBLE_FILE_COUNT ? (
                <MoreFilesButton label={t("docs.showAllUploads")} onClick={() => setOpenList("uploaded")} />
              ) : null}
            </div>
          ) : null}

          {buildOptions ? (
            <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {buildOptions.methods.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`ws-btn ${method === option.id ? "ws-btn--primary" : "ws-btn--ghost"}`}
                    disabled={!option.available || Boolean(job?.active) || building}
                    title={option.available ? undefined : t("docs.methodUnavailable")}
                    onClick={() => setMethod(option.id)}
                    style={{ padding: "6px 10px" }}
                  >
                    {t(methodLabels[option.id])}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="ws-btn ws-btn--primary"
                disabled={!method || Boolean(job?.active) || building || parsedCount === 0}
                onClick={() => void handleBuildLibrary()}
                style={{ justifyContent: "center" }}
              >
                {building || job?.active
                  ? <><Loader2 size={14} className="ws-spin" />{t("docs.building")}</>
                  : <><Network size={14} />{t("docs.buildGraph")}</>}
              </button>
              <div className="ws-body" style={{ fontSize: 11 }}>{t("docs.buildHint")}</div>
              {activeLibrary ? (
                <div className="ws-body" style={{ fontSize: 11 }}>{t("docs.libraryGraph", { name: activeLibrary.graph_name || activeLibrary.name })}</div>
              ) : null}
              {parsedCount === 0 ? <div className="ws-body" style={{ fontSize: 11 }}>{t("docs.noParsed")}</div> : null}
            </section>
          ) : null}

          {job?.document_id ? <BuildStatusCard job={job} /> : null}
        </div>

        <div className="ws-scroll" style={{ padding: 24 }}>
          {detail ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 860 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <h2 className="ws-title" style={{ fontSize: 18 }}>{detail.name}</h2>
                  <div className="ws-body" style={{ marginTop: 4 }}>{t("docs.preview")}</div>
                </div>
                <button className="ws-btn ws-btn--ghost" onClick={() => void handleDelete(detail.id)}>
                  <Trash2 size={14} />{t("docs.remove")}
                </button>
              </div>
              {detail.error ? (
                <div className="ws-card" style={{ color: "var(--ws-red)" }}>{detail.error}</div>
              ) : null}
              {detail.items.map((item, index) => (
                <article key={`${detail.id}-${index}`} className="ws-card" style={{ padding: 14 }}>
                  <div className="ws-pill ws-pill--mono" style={{ marginBottom: 8 }}>
                    {item.doc_type_kwd} · #{index + 1}{item.sheet ? ` · ${item.sheet}` : ""}
                  </div>
                  {item.doc_type_kwd === "table" && item.text.trimStart().startsWith("<table") ? (
                    <div className="ws-parsed-table" dangerouslySetInnerHTML={{ __html: item.text }} />
                  ) : (
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: "var(--ws-text)", fontFamily: "inherit", fontSize: 13 }}>{item.text}</pre>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="ws-body">{t("docs.select")}</div>
          )}
        </div>
      </div>
      {dialog ? (
        <FileListDialog title={dialog.title} closeLabel={t("docs.close")} onClose={() => setOpenList(null)}>
          {dialog.body}
        </FileListDialog>
      ) : null}
    </div>
  );
}

function BuildStatusCard({ job }: { job: BuildJob }) {
  const { t } = useI18n();
  const detail = job.active ? stageDetail(job, t) : "";
  return (
    <section className="ws-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {job.active
          ? <Loader2 size={14} className="ws-spin" color="var(--ws-accent)" />
          : job.error
            ? <AlertCircle size={14} color="var(--ws-red)" />
            : <CheckCircle2 size={14} color="var(--ws-green)" />}
        <span style={{ color: "var(--ws-text)", fontWeight: 650 }}>{t("docs.buildStatus")}</span>
      </div>
      <div className="ws-body" style={{ fontSize: 12 }}>
        {job.library_name ? `${job.library_name} · ` : ""}
        {job.document_name}
        {job.graph_name ? ` → ${job.graph_name}` : ""}
      </div>
      {job.library_name && job.documents_total > 0 ? (
        <div className="ws-body" style={{ fontSize: 11 }}>
          {t("docs.libraryProgress", { processed: job.documents_processed, total: job.documents_total })}
        </div>
      ) : null}
      {job.steps.map((step) => (
        <div
          key={step.id}
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            fontSize: 12,
            color: stepColor[step.state],
            opacity: step.state === "pending" ? 0.55 : 1,
          }}
        >
          <StepMark state={step.state} />
          <div>
            <div>{t(stepLabels[step.id])}</div>
            {step.state === "running" && detail ? (
              <div className="ws-body" style={{ fontSize: 11, marginTop: 2 }}>{detail}</div>
            ) : null}
          </div>
        </div>
      ))}
      <div className="ws-body" style={{ fontSize: 11 }}>
        {t("docs.extractCounts", {
          entities: job.entities,
          relationships: job.relationships,
          triplets: job.triplets,
        })}
      </div>
      {job.error ? (
        <div style={{ color: "var(--ws-red)", fontSize: 12 }}>{t("docs.buildFailed", { error: job.error })}</div>
      ) : null}
      {!job.active && !job.error ? (
        <div className="ws-body" style={{ fontSize: 11 }}>{t("docs.buildDone")}</div>
      ) : null}
    </section>
  );
}

function StepMark({ state }: { state: BuildStepState }) {
  const marks: Record<BuildStepState, ReactNode> = {
    running: <Loader2 size={13} className="ws-spin" />,
    done: <CheckCircle2 size={13} />,
    failed: <AlertCircle size={13} />,
    pending: <span style={{ width: 13, height: 13, marginTop: 1, borderRadius: 99, border: "1px solid currentColor", display: "inline-block", boxSizing: "border-box" }} />,
  };
  return marks[state];
}

const removeButtonStyle: CSSProperties = { padding: "1px 6px", minHeight: 0 };

function MoreFilesButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="ws-btn ws-btn--ghost"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{ alignSelf: "flex-start", padding: "0 8px", minHeight: 22, letterSpacing: "0.08em" }}
    >
      ...
    </button>
  );
}

function PendingFileRow({ file, disabled, removeLabel, onRemove }: { file: File; disabled: boolean; removeLabel: string; onRemove: (key: string) => void }) {
  const key = fileKey(file);
  return (
    <div style={fileChipStyle}>
      <FileText size={13} color="var(--ws-accent)" />
      <span style={{ flex: 1, minWidth: 0, color: "var(--ws-text)", fontSize: 12, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
      <button
        type="button"
        className="ws-btn ws-btn--ghost"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={() => onRemove(key)}
        disabled={disabled}
        style={removeButtonStyle}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function UploadedFileRow({
  document,
  selected,
  meta,
  removeLabel,
  showMeta = false,
  onSelect,
  onRemove,
}: {
  document: DocumentSummary;
  selected: boolean;
  meta: string;
  removeLabel: string;
  showMeta?: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      style={{ ...fileChipStyle, cursor: "pointer", borderColor: selected ? "var(--ws-accent)" : undefined }}
    >
      <FileText size={13} color="var(--ws-accent)" />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", color: "var(--ws-text)", fontSize: 12, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{document.name}</span>
        {showMeta ? <span className="ws-body" style={{ display: "block", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta}</span> : null}
      </span>
      {document.status === "done"
        ? <CheckCircle2 size={13} color="var(--ws-green)" />
        : <AlertCircle size={13} color="var(--ws-red)" />}
      <button
        type="button"
        className="ws-btn ws-btn--ghost"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        style={removeButtonStyle}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function FileListDialog({ title, closeLabel, onClose, children }: { title: string; closeLabel: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 40, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "rgba(0,0,0,0.62)" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        style={{ width: "min(440px, 100%)", maxHeight: "min(70vh, 560px)", display: "flex", flexDirection: "column", gap: 12, padding: 16, background: "var(--ws-facet)", border: "1px solid var(--ws-border)", borderRadius: 12 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 className="ws-title" style={{ margin: 0, flex: 1, fontSize: 16 }}>{title}</h3>
          <button type="button" className="ws-btn ws-btn--ghost" aria-label={closeLabel} title={closeLabel} onClick={onClose} style={{ padding: "4px 8px" }}>
            <X size={14} />
          </button>
        </div>
        <div style={{ overflow: "auto", display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
