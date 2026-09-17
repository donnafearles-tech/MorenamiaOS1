import React, { useState } from "react";
import { 
  RefreshCw, 
  Loader2, 
  FileSpreadsheet, 
  Check, 
  X, 
  AlertCircle,
  HelpCircle,
  Search,
  Copy,
  ExternalLink,
  ArrowRight,
  Filter,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Layers,
  Sparkles,
  Download
} from "lucide-react";
import { DisputeResult, InvoiceCheckResponse, InvoiceCheckDetail } from "../types";

export default function DisputesSync() {
  // Tab state: "checker" for invoice verification in ClickUp, "sheets" for syncing to Google Sheets
  const [activeTab, setActiveTab] = useState<"checker" | "sheets">("checker");

  // --- CHECKER STATE ---
  const [checkerInput, setCheckerInput] = useState("");
  const [checkerScope, setCheckerScope] = useState<"all" | "disputes" | "cs">("all");
  const [checkerLoading, setCheckerLoading] = useState(false);
  const [checkerData, setCheckerData] = useState<InvoiceCheckResponse | null>(null);
  const [filterMode, setFilterMode] = useState<"all" | "found" | "notFound">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedState, setCopiedState] = useState<string | null>(null);

  // --- SHEETS SYNC STATE ---
  const [invoiceInput, setInvoiceInput] = useState("");
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResults, setSyncResults] = useState<DisputeResult[] | null>(null);
  const [syncSummary, setSyncSummary] = useState({ total: 0, saved: 0, notFound: 0, failed: 0 });

  // Handle invoice check in ClickUp
  const handleCheckInvoices = async (forceRefresh: boolean = false) => {
    const rawInvoices = checkerInput
      .split(/[\n,;]+/)
      .map(inv => inv.trim().toUpperCase())
      .filter(inv => inv.length > 0);

    if (rawInvoices.length === 0) {
      alert("Por favor ingresa al menos una factura / invoice para verificar.");
      return;
    }

    setCheckerLoading(true);

    try {
      const res = await fetch("/api/check-invoices-clickup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoices: rawInvoices,
          scope: checkerScope,
          forceRefresh
        })
      });

      const data: InvoiceCheckResponse = await res.json();

      if (res.ok) {
        setCheckerData(data);
      } else {
        alert(`Error al consultar ClickUp: ${(data as any).error || "Ocurrió un error inesperado"}`);
      }
    } catch (err: any) {
      alert(`Error de conexión con el servidor: ${err.message}`);
    } finally {
      setCheckerLoading(false);
    }
  };

  // Copy helper
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedState(label);
    setTimeout(() => setCopiedState(null), 2500);
  };

  // Transfer found invoices to sheets sync tab
  const handleTransferToSheets = () => {
    if (!checkerData || checkerData.foundInvoices.length === 0) return;
    setInvoiceInput(checkerData.foundInvoices.join("\n"));
    setActiveTab("sheets");
  };

  // Export results to CSV
  const handleExportCSV = () => {
    if (!checkerData) return;
    const header = "Invoice,ExisteEnClickUp,Lista,NombreTarea,Estatus,Motivo,Asignados,FechaVencimiento,URL\n";
    const rows = checkerData.details.map(d => {
      const exists = d.exists ? "SI" : "NO";
      const list = d.task?.listName || "";
      const name = `"${(d.task?.name || "").replace(/"/g, '""')}"`;
      const status = d.task?.status || "";
      const reason = `"${(d.task?.reason || "").replace(/"/g, '""')}"`;
      const assignees = `"${(d.task?.assignees || []).join(", ")}"`;
      const due = d.task?.dueDate || "";
      const url = d.task?.url || "";
      return `${d.invoice},${exists},${list},${name},${status},${reason},${assignees},${due},${url}`;
    }).join("\n");

    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `verificacion_clickup_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Handle Google Sheets batch sync
  const handleSync = async () => {
    const invoices = invoiceInput
      .split(/[\n,;]+/)
      .map(inv => inv.trim().toUpperCase())
      .filter(inv => inv.length > 0);

    if (invoices.length === 0) {
      alert("Por favor ingresa al menos una factura / invoice para sincronizar.");
      return;
    }

    setSyncLoading(true);
    setSyncResults(null);

    try {
      const res = await fetch("/api/batch-disputes-sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoices })
      });
      const data = await res.json();
      
      if (res.ok) {
        const listResults: DisputeResult[] = data.resultados || [];
        setSyncResults(listResults);

        let saved = 0;
        let notFound = 0;
        let failed = 0;

        listResults.forEach(r => {
          if (r.status.includes("Guardado")) saved++;
          else if (r.status.includes("No en Disputes") || r.status.includes("No encontrado")) notFound++;
          else failed++;
        });

        setSyncSummary({
          total: listResults.length,
          saved,
          notFound,
          failed
        });
      } else {
        alert(`Error del sincronizador: ${data.error || "Ocurrió un error"}`);
      }
    } catch (err: any) {
      alert(`Error de red: ${err.message}`);
    } finally {
      setSyncLoading(false);
    }
  };

  // Filter checker details based on tabs and search query
  const filteredDetails = (checkerData?.details || []).filter(detail => {
    if (filterMode === "found" && !detail.exists) return false;
    if (filterMode === "notFound" && detail.exists) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchInv = detail.invoice.toLowerCase().includes(q);
      const matchName = detail.task?.name?.toLowerCase().includes(q);
      const matchList = detail.task?.listName?.toLowerCase().includes(q);
      const matchStatus = detail.task?.status?.toLowerCase().includes(q);
      return matchInv || matchName || matchList || matchStatus;
    }
    return true;
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-12">
      
      {/* Top Navigation & Header */}
      <div className="glass-card p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl md:text-3xl font-bold font-serif tracking-tight text-white">
              Sincronizador y Verificador de Disputas
            </h2>
            <span className="px-2.5 py-0.5 text-[11px] font-mono font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full">
              ClickUp v2
            </span>
          </div>
          <p className="text-sm text-white/70 font-sans mt-1">
            Verifica qué facturas ya existen en ClickUp y sincroniza resoluciones masivamente a Google Sheets.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-black/40 p-1.5 rounded-2xl border border-white/10 shrink-0">
          <button
            id="tab-checker"
            onClick={() => setActiveTab("checker")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === "checker"
                ? "bg-white text-slate-950 shadow-md"
                : "text-white/70 hover:text-white hover:bg-white/5"
            }`}
          >
            <Search className="w-4 h-4" />
            <span>Verificador en ClickUp</span>
            {checkerData && (
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                activeTab === "checker" ? "bg-slate-900 text-white" : "bg-white/20 text-white"
              }`}>
                {checkerData.foundCount}/{checkerData.totalInput}
              </span>
            )}
          </button>

          <button
            id="tab-sheets"
            onClick={() => setActiveTab("sheets")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === "sheets"
                ? "bg-white text-slate-950 shadow-md"
                : "text-white/70 hover:text-white hover:bg-white/5"
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Sincronizar a Sheets</span>
          </button>
        </div>
      </div>

      {/* TAB 1: VERIFICADOR EN CLICKUP */}
      {activeTab === "checker" && (
        <div className="space-y-6 animate-fade-in">
          
          {/* Main Grid: Inputs + Instructions */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Input Card (Left / Top) */}
            <div className="lg:col-span-5 space-y-4">
              <div className="glass-card p-5 space-y-4 shadow-xl">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-white/80 uppercase tracking-wider flex items-center gap-2">
                    <Search className="w-3.5 h-3.5 text-cyan-400" />
                    Invoices a Comprobar
                  </label>
                  <span className="text-[11px] text-white/50 font-mono">
                    {checkerInput.split(/[\n,;]+/).filter(x => x.trim().length > 0).length} ingresadas
                  </span>
                </div>

                <textarea
                  id="checker-invoices-input"
                  placeholder="Ingresa las facturas / invoices para verificar si ya existen en ClickUp...&#10;Ejemplo:&#10;228632&#10;197474&#10;229911&#10;M10500"
                  value={checkerInput}
                  onChange={(e) => setCheckerInput(e.target.value)}
                  rows={7}
                  className="w-full bg-white/5 border border-white/15 rounded-xl p-3.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-cyan-400/50 focus:bg-white/10 transition-all font-mono leading-relaxed"
                />

                {/* Scope selector */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-semibold text-white/60 uppercase tracking-wider block">
                    Alcance de Búsqueda:
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: "all", label: "🌐 Todas", sub: "Disputas + CS" },
                      { id: "disputes", label: "🛡️ Disputas", sub: "Lista 48493938" },
                      { id: "cs", label: "👥 Casos CS", sub: "Lista 48494459" }
                    ].map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setCheckerScope(opt.id as any)}
                        className={`p-2 rounded-xl text-left border transition-all cursor-pointer ${
                          checkerScope === opt.id
                            ? "bg-cyan-500/20 border-cyan-400/50 text-white shadow-sm"
                            : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        <span className="block text-xs font-bold">{opt.label}</span>
                        <span className="block text-[10px] text-white/40">{opt.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    id="btn-verify-clickup"
                    onClick={() => handleCheckInvoices(false)}
                    disabled={checkerLoading || !checkerInput.trim()}
                    className="col-span-2 py-3 bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-slate-950 disabled:opacity-40 font-bold text-xs flex items-center justify-center gap-2 rounded-xl transition-all cursor-pointer shadow-lg shadow-cyan-500/20"
                  >
                    {checkerLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                        Verificando en ClickUp...
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4 text-slate-950" />
                        Verificar si Existen en ClickUp
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleCheckInvoices(true)}
                    disabled={checkerLoading || !checkerInput.trim()}
                    title="Forzar actualización sin usar la memoria caché"
                    className="py-2 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 rounded-lg border border-white/10 transition-all cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${checkerLoading ? "animate-spin" : ""}`} />
                    Forzar Refresco
                  </button>

                  <button
                    onClick={() => {
                      setCheckerInput("");
                      setCheckerData(null);
                    }}
                    disabled={checkerLoading || (!checkerInput && !checkerData)}
                    className="py-2 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 rounded-lg border border-white/10 transition-all cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    Limpiar Todo
                  </button>
                </div>
              </div>

              {/* Instructions badge */}
              <div className="glass-card p-4 flex gap-3 items-start text-xs text-white/70">
                <ShieldCheck className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-white">¿Cómo funciona esta comprobación?</p>
                  <p className="text-white/60 leading-relaxed text-[11px]">
                    El motor busca cada número de factura en los nombres de tareas y campos personalizados de ClickUp. Te indicará con precisión cuáles ya cuentan con tarea registrada, su estatus actual, lista y fecha, para que evites duplicar casos.
                  </p>
                </div>
              </div>
            </div>

            {/* Results Panel (Right / Bottom) */}
            <div className="lg:col-span-7 space-y-4">
              {checkerLoading ? (
                <div className="glass-card p-16 flex flex-col items-center justify-center space-y-4 text-center">
                  <div className="relative">
                    <div className="w-14 h-14 rounded-full border-2 border-cyan-400/20 border-t-cyan-400 animate-spin" />
                    <Search className="w-6 h-6 text-cyan-300 absolute inset-0 m-auto" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Consultando API de ClickUp...</h4>
                    <p className="text-xs text-white/60 mt-1 font-mono">
                      Analizando tareas activas y cerradas para cruzar con tus facturas
                    </p>
                  </div>
                </div>
              ) : checkerData ? (
                <div className="space-y-4 animate-fade-in">
                  
                  {/* Metric Summary Cards */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="glass-card p-4 border border-white/10 bg-white/5">
                      <span className="text-[10px] text-white/50 uppercase font-bold tracking-wider block">
                        Total Facturas
                      </span>
                      <span className="text-2xl font-bold font-mono text-white mt-1 block">
                        {checkerData.totalInput}
                      </span>
                      <span className="text-[10px] text-white/40 block mt-0.5">
                        {checkerData.totalTasksChecked} tareas revisadas
                      </span>
                    </div>

                    <div className="glass-card p-4 border border-emerald-500/30 bg-emerald-500/10">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-emerald-300 uppercase font-bold tracking-wider">
                          Ya en ClickUp
                        </span>
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      </div>
                      <span className="text-2xl font-bold font-mono text-emerald-300 mt-1 block">
                        {checkerData.foundCount}
                      </span>
                      <span className="text-[10px] text-emerald-400/80 block mt-0.5 font-semibold">
                        {checkerData.totalInput > 0 
                          ? `${Math.round((checkerData.foundCount / checkerData.totalInput) * 100)}% encontradas`
                          : "0%"}
                      </span>
                    </div>

                    <div className="glass-card p-4 border border-amber-500/30 bg-amber-500/10">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-amber-300 uppercase font-bold tracking-wider">
                          No Encontradas
                        </span>
                        <XCircle className="w-4 h-4 text-amber-400" />
                      </div>
                      <span className="text-2xl font-bold font-mono text-amber-300 mt-1 block">
                        {checkerData.notFoundCount}
                      </span>
                      <span className="text-[10px] text-amber-400/80 block mt-0.5 font-semibold">
                        {checkerData.totalInput > 0 
                          ? `${Math.round((checkerData.notFoundCount / checkerData.totalInput) * 100)}% faltantes`
                          : "0%"}
                      </span>
                    </div>
                  </div>

                  {/* Batch Action Toolbar */}
                  <div className="glass-card p-3 flex flex-wrap items-center justify-between gap-2 border border-white/10">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copyToClipboard(checkerData.foundInvoices.join("\n"), "found")}
                        disabled={checkerData.foundInvoices.length === 0}
                        className="px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-30"
                      >
                        {copiedState === "found" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        Copiar Encontradas ({checkerData.foundCount})
                      </button>

                      <button
                        onClick={() => copyToClipboard(checkerData.notFoundInvoices.join("\n"), "notFound")}
                        disabled={checkerData.notFoundInvoices.length === 0}
                        className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-30"
                      >
                        {copiedState === "notFound" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        Copiar Faltantes ({checkerData.notFoundCount})
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      {checkerData.foundCount > 0 && (
                        <button
                          onClick={handleTransferToSheets}
                          className="px-3 py-1.5 bg-white text-slate-950 hover:bg-white/90 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                        >
                          <span>Transferir a Sheets</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        onClick={handleExportCSV}
                        title="Descargar reporte en formato CSV"
                        className="p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white rounded-lg transition-all cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Filter & Search Bar */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5 bg-black/30 p-1 rounded-xl border border-white/10">
                      <button
                        onClick={() => setFilterMode("all")}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          filterMode === "all" ? "bg-white/20 text-white" : "text-white/50 hover:text-white"
                        }`}
                      >
                        Todas ({checkerData.totalInput})
                      </button>
                      <button
                        onClick={() => setFilterMode("found")}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          filterMode === "found" ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/30" : "text-white/50 hover:text-emerald-300"
                        }`}
                      >
                        ✅ En ClickUp ({checkerData.foundCount})
                      </button>
                      <button
                        onClick={() => setFilterMode("notFound")}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          filterMode === "notFound" ? "bg-amber-500/25 text-amber-300 border border-amber-500/30" : "text-white/50 hover:text-amber-300"
                        }`}
                      >
                        ❌ No en ClickUp ({checkerData.notFoundCount})
                      </button>
                    </div>

                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Filtrar por factura o estatus..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/20 w-full sm:w-56"
                      />
                    </div>
                  </div>

                  {/* Details List */}
                  <div className="glass-card overflow-hidden border border-white/10 shadow-2xl">
                    <div className="max-h-[380px] overflow-y-auto divide-y divide-white/10">
                      {filteredDetails.length === 0 ? (
                        <div className="p-8 text-center text-xs text-white/50">
                          No se encontraron elementos con el filtro aplicado.
                        </div>
                      ) : (
                        filteredDetails.map((item, idx) => (
                          <div 
                            key={idx} 
                            className="p-3.5 hover:bg-white/5 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          >
                            <div className="flex items-start gap-3 min-w-0">
                              <div className={`w-3 h-3 rounded-full mt-1 shrink-0 ${
                                item.exists 
                                  ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" 
                                  : "bg-amber-400/80 shadow-[0_0_8px_rgba(251,191,36,0.3)]"
                              }`} />
                              
                              <div className="min-w-0 space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono font-bold text-white text-sm">
                                    {item.invoice}
                                  </span>

                                  {item.exists ? (
                                    <>
                                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                        Existe en ClickUp
                                      </span>
                                      <span className="px-2 py-0.5 rounded text-[10px] font-mono text-cyan-300 bg-cyan-500/10 border border-cyan-500/20">
                                        {item.task?.listName}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                      No Registrada
                                    </span>
                                  )}
                                </div>

                                {item.exists && item.task && (
                                  <div className="text-xs text-white/80 truncate font-sans">
                                    {item.task.name}
                                  </div>
                                )}

                                {item.exists && item.task && (
                                  <div className="flex items-center gap-2 text-[10px] text-white/50 flex-wrap">
                                    {item.task.reason && (
                                      <span className="text-purple-300 font-medium">
                                        Motivo: {item.task.reason}
                                      </span>
                                    )}
                                    {item.task.assignees && item.task.assignees.length > 0 && (
                                      <span>
                                        Asig: {item.task.assignees.join(", ")}
                                      </span>
                                    )}
                                    {item.task.dateUpdated && (
                                      <span>
                                        Act: {item.task.dateUpdated}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Right side status / open button */}
                            <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                              {item.exists && item.task ? (
                                <>
                                  <span 
                                    className="px-2 py-1 rounded-md text-[11px] font-mono font-bold uppercase tracking-wide border border-white/10"
                                    style={{
                                      backgroundColor: `${item.task.statusColor || "#64748b"}20`,
                                      color: item.task.statusColor || "#94a3b8"
                                    }}
                                  >
                                    {item.task.status}
                                  </span>
                                  <a
                                    href={item.task.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    title="Abrir tarea directamente en ClickUp"
                                    className="p-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all cursor-pointer flex items-center gap-1 text-xs"
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    <span className="hidden md:inline">Abrir</span>
                                  </a>
                                </>
                              ) : (
                                <button
                                  onClick={() => copyToClipboard(item.invoice, item.invoice)}
                                  className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-[11px] rounded-lg border border-white/10 transition-all cursor-pointer flex items-center gap-1"
                                >
                                  {copiedState === item.invoice ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                  <span>Copiar</span>
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                </div>
              ) : (
                <div className="glass-card p-16 text-center space-y-3">
                  <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-cyan-400">
                    <Search className="w-7 h-7" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Esperando consulta de facturas</h4>
                    <p className="text-xs text-white/50 max-w-sm mx-auto mt-1">
                      Pega tu lista de invoices a la izquierda y pulsa el botón para saber exactamente cuáles ya existen en ClickUp.
                    </p>
                  </div>
                </div>
              )}
            </div>

          </div>

        </div>
      )}

      {/* TAB 2: SINCRONIZADOR A GOOGLE SHEETS */}
      {activeTab === "sheets" && (
        <div className="space-y-6 animate-fade-in">
          
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            
            {/* Input Panel */}
            <div className="md:col-span-5 space-y-4">
              <div className="glass-card p-5 space-y-3 shadow-xl">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-white/80 uppercase tracking-wide">
                    Invoices a Sincronizar con Sheets
                  </label>
                  {checkerData && checkerData.foundInvoices.length > 0 && (
                    <button
                      onClick={() => setInvoiceInput(checkerData.foundInvoices.join("\n"))}
                      className="text-[11px] text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer underline"
                    >
                      Cargar ({checkerData.foundCount}) del Verificador
                    </button>
                  )}
                </div>

                <textarea
                  placeholder="Ingresa las facturas separadas por comas o saltos de línea...&#10;Ej.&#10;M10500&#10;M10501&#10;M10502"
                  value={invoiceInput}
                  onChange={(e) => setInvoiceInput(e.target.value)}
                  rows={8}
                  className="w-full bg-white/5 border border-white/15 rounded-xl p-4 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-400/50 focus:bg-white/10 transition-all leading-relaxed font-mono"
                />

                <button
                  onClick={handleSync}
                  disabled={syncLoading || !invoiceInput.trim()}
                  className="w-full py-3.5 bg-gradient-to-r from-emerald-400 to-teal-500 hover:from-emerald-300 hover:to-teal-400 text-slate-950 disabled:opacity-40 font-bold text-xs flex items-center justify-center gap-2 rounded-xl transition-all cursor-pointer shadow-lg shadow-emerald-500/20"
                >
                  {syncLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-slate-950" /> Sincronizando en Lote...
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="w-4 h-4 text-slate-950" /> Sincronizar con Google Sheets
                    </>
                  )}
                </button>
              </div>

              {/* Quick info guides */}
              <div className="glass-card p-4 flex gap-2.5 items-start text-xs text-white/70">
                <HelpCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed font-sans text-[11px]">
                  <strong>Flujo de Sincronización:</strong> Lee las disputas de ClickUp actualizadas, extrae el motivo y resolución asignados, y llama al webhook de Google Apps Script para actualizar la hoja de cálculo.
                </p>
              </div>
            </div>

            {/* Results Panel */}
            <div className="md:col-span-7 space-y-6">
              {syncLoading ? (
                <div className="glass-card p-20 flex flex-col items-center justify-center space-y-4">
                  <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
                  <p className="text-sm text-white/70 font-mono text-center leading-relaxed">
                    Conectando con ClickUp API v2...<br />
                    Paginando disputas y llamando webhook de Google Sheets...
                  </p>
                </div>
              ) : syncResults ? (
                <div className="space-y-6 animate-fade-in">
                  {/* Summary stats */}
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: "Procesados", val: syncSummary.total, color: "text-white bg-white/5 border border-white/10" },
                      { label: "Sincronizados", val: syncSummary.saved, color: "text-emerald-300 bg-emerald-500/10 border border-emerald-500/20" },
                      { label: "No en Disputas", val: syncSummary.notFound, color: "text-amber-300 bg-amber-500/10 border border-amber-500/20" },
                      { label: "Fallidos", val: syncSummary.failed, color: "text-rose-300 bg-rose-500/10 border border-rose-500/20" }
                    ].map((stat, idx) => (
                      <div key={idx} className={`p-3.5 rounded-xl text-center ${stat.color}`}>
                        <span className="block text-[10px] text-white/50 uppercase font-bold tracking-tight">{stat.label}</span>
                        <span className="block text-xl font-bold font-mono mt-1">{stat.val}</span>
                      </div>
                    ))}
                  </div>

                  {/* Table details */}
                  <div className="glass-card overflow-hidden shadow-2xl">
                    <div className="px-5 py-4 border-b border-white/10 bg-white/5 flex items-center justify-between">
                      <span className="text-xs font-bold text-white/70 uppercase tracking-wider">Bitácora de Transacciones</span>
                      <span className="text-[11px] font-mono text-white/50">{syncResults.length} resultados</span>
                    </div>
                    
                    <div className="max-h-[340px] overflow-y-auto divide-y divide-white/10">
                      {syncResults.map((res, idx) => {
                        const isSuccess = res.status.includes("Guardado");
                        const isNotFound = res.status.includes("No en Disputes") || res.status.includes("No encontrado");

                        return (
                          <div key={idx} className="px-5 py-3.5 flex items-center justify-between text-xs hover:bg-white/5 transition-all">
                            <div className="flex items-center gap-3">
                              <div className={`w-2.5 h-2.5 rounded-full ${
                                isSuccess ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" : isNotFound ? "bg-amber-400" : "bg-rose-400"
                              }`} />
                              <span className="font-mono font-bold text-white text-sm">{res.invoice}</span>
                            </div>

                            <div className="text-right">
                              <span className={`block font-semibold ${
                                isSuccess ? "text-emerald-300" : isNotFound ? "text-amber-300" : "text-rose-300"
                              }`}>
                                {res.status}
                              </span>
                              {res.leyenda && (
                                <span className="block text-[10px] text-white/50 font-mono mt-0.5">{res.leyenda}</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="glass-card p-16 text-center">
                  <FileSpreadsheet className="w-12 h-12 text-white/30 mx-auto mb-4 animate-pulse" />
                  <p className="text-sm font-semibold text-white/80">Esperando listado de facturas...</p>
                  <p className="text-xs text-white/50 mt-1">Inserta las facturas y ejecuta la sincronización masiva para ver resultados.</p>
                </div>
              )}
            </div>

          </div>

        </div>
      )}

    </div>
  );
}
