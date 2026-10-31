import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useDropzone } from "react-dropzone";
import { AlertCircle, CheckCircle2, FileText, Loader2, Network, Trash2, UploadCloud } from "lucide-react";
import { useI18n } from "../../i18n";
import type { MessageKey } from "../../i18n/messages";

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
  graph_name: string | null;
  method: ExtractionMethod | null;
  stage: string | null;
  steps: { id: BuildStepId; state: BuildStepState }[];
  processed: number;
  total: number;
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
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buildOptions, setBuildOptions] = useState<BuildOptions | null>(null);
  const [method, setMethod] = useState<ExtractionMethod | null>(null);
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [job, setJob] = useState<BuildJob | null>(null);
  const [targetGraphName, setTargetGraphName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/graphs")
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ active_id: string | null; graphs: { id: string; name: string }[] }>;
      })
      .then((listing) => {
        if (!active || !listing) return;
        setTargetGraphName(listing.graphs.find((graph) => graph.id === listing.active_id)?.name ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

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

  const loadDocuments = useCallback(async () => {
    const response = await fetch("/api/documents");
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const body = await response.json() as { documents: DocumentSummary[] };
    setDocuments(body.documents);
    return body.documents;
  }, []);

  useEffect(() => {
    let active = true;
    void loadDocuments().catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Request failed");
    });
    return () => {
      active = false;
    };
  }, [loadDocuments]);

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
  }, [loadDocuments]);

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
    setPending(accepted);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    maxFiles: 20,
  });

  async function handleUpload() {
    if (pending.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      pending.forEach((file) => body.append("files", file));
      const response = await fetch("/api/documents/upload", { method: "POST", body });
      if (!response.ok) throw new Error(await readError(response));
      const uploaded = await response.json() as { documents: DocumentSummary[] };
      setPending([]);
      await loadDocuments();
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
  }

  async function handleBuildGraph(documentId: string) {
    if (!method || job?.active) return;
    setBuildingId(documentId);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/build-graph`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      if (response.status === 409) throw new Error(t("docs.buildBusy"));
      if (!response.ok) throw new Error(await readError(response));
      const graph = await response.json() as GraphBuildSummary;
      setDetail((current) => (current && current.id === documentId ? { ...current, graph } : current));
      await loadDocuments();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Request failed");
    } finally {
      setBuildingId(null);
    }
  }

  return (
    <div className="ws-page">
      <div className="ws-split ws-split--2col" style={{ gridTemplateColumns: "380px 1fr" }}>
        <div className="ws-scroll" style={{ borderRight: "1px solid var(--ws-border)", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <h2 className="ws-title" style={{ fontSize: 18 }}>{t("docs.title")}</h2>
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
            {pending.length > 0 ? (
              <div className="ws-body" style={{ marginTop: 8 }}>{pending.map((file) => file.name).join(" · ")}</div>
            ) : null}
          </div>

          <button className="ws-btn ws-btn--primary" onClick={handleUpload} disabled={pending.length === 0 || uploading} style={{ justifyContent: "center" }}>
            {uploading ? <><Loader2 size={15} className="ws-spin" />{t("docs.uploading")}</> : <><UploadCloud size={15} />{t("docs.upload")}</>}
          </button>

          {error ? (
            <div style={{ display: "flex", gap: 8, color: "var(--ws-red)", fontSize: 12 }}>
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          ) : null}

          {job?.document_id ? <BuildStatusCard job={job} /> : null}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {documents.length === 0 ? <div className="ws-body">{t("docs.empty")}</div> : null}
            {documents.map((document) => (
              <button
                key={document.id}
                onClick={() => setSelectedId(document.id)}
                className="ws-card"
                style={{
                  textAlign: "left",
                  padding: 12,
                  cursor: "pointer",
                  borderColor: selectedId === document.id ? "var(--ws-accent)" : undefined,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <FileText size={14} color="var(--ws-accent)" />
                  <span style={{ color: "var(--ws-text)", fontWeight: 650, flex: 1 }}>{document.name}</span>
                  {document.status === "done"
                    ? <CheckCircle2 size={14} color="var(--ws-green)" />
                    : <AlertCircle size={14} color="var(--ws-red)" />}
                </div>
                <div className="ws-body" style={{ fontSize: 11, marginTop: 6 }}>
                  {document.parser || document.format} · {document.status === "done" ? t("docs.items", { count: document.item_count }) : t("docs.failed")}
                  {job?.active && job.document_id === document.id ? ` · ${t("docs.buildingDocument")}` : ""}
                  {document.graph
                    ? ` · ${document.graph.graph_name ? t("docs.inNamedGraph", { name: document.graph.graph_name }) : t("docs.inGraph")}`
                    : ""}
                </div>
              </button>
            ))}
          </div>
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
              {detail.status === "done" && buildOptions ? (
                <section className="ws-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="ws-body" style={{ marginRight: 4 }}>{t("docs.method")}</span>
                    {buildOptions.methods.map((option) => (
                      <button
                        key={option.id}
                        className={`ws-btn ${method === option.id ? "ws-btn--primary" : "ws-btn--ghost"}`}
                        disabled={!option.available || Boolean(job?.active) || buildingId === detail.id}
                        title={option.available ? undefined : t("docs.methodUnavailable")}
                        onClick={() => setMethod(option.id)}
                      >
                        {t(methodLabels[option.id])}
                      </button>
                    ))}
                    <span style={{ flex: 1 }} />
                    <button className="ws-btn ws-btn--primary" disabled={!method || Boolean(job?.active) || buildingId !== null} onClick={() => void handleBuildGraph(detail.id)}>
                      {(job?.active && job.document_id === detail.id) || buildingId === detail.id
                        ? <><Loader2 size={14} className="ws-spin" />{t("docs.building")}</>
                        : <><Network size={14} />{t("docs.buildGraph")}</>}
                    </button>
                  </div>
                  <div className="ws-body" style={{ fontSize: 11 }}>{t("docs.buildHint")}</div>
                  {targetGraphName ? (
                    <div className="ws-body" style={{ fontSize: 11 }}>{t("docs.targetGraph", { name: targetGraphName })}</div>
                  ) : null}
                  {detail.graph ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--ws-green)", fontSize: 12 }}>
                      <CheckCircle2 size={14} />
                      <span>
                        {t("docs.built", {
                          entities: detail.graph.entities,
                          relationships: detail.graph.relationships,
                          nodes: detail.graph.nodes_added,
                          edges: detail.graph.edges_added,
                        })}
                      </span>
                    </div>
                  ) : null}
                </section>
              ) : null}
              {detail.items.map((item, index) => (
                <article key={`${detail.id}-${index}`} className="ws-card" style={{ padding: 14 }}>
                  <div className="ws-pill ws-pill--mono" style={{ marginBottom: 8 }}>{item.doc_type_kwd}</div>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: "var(--ws-text)", fontFamily: "inherit", fontSize: 13 }}>{item.text}</pre>
                </article>
              ))}
            </div>
          ) : (
            <div className="ws-body">{t("docs.select")}</div>
          )}
        </div>
      </div>
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
        {job.document_name}
        {job.graph_name ? ` → ${job.graph_name}` : ""}
      </div>
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
