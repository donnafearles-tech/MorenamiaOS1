import React, { useState } from "react";
import { 
  RefreshCw, 
  Loader2, 
  FileSpreadsheet, 
  Check, 
  X, 
  AlertCircle,
  HelpCircle
} from "lucide-react";
import { DisputeResult } from "../types";

export default function DisputesSync() {
  const [invoiceInput, setInvoiceInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<DisputeResult[] | null>(null);
  const [summary, setSummary] = useState({ total: 0, saved: 0, notFound: 0, failed: 0 });

  const handleSync = async () => {
    // Extract separate invoices, cleaning up whitespace and separators
    const invoices = invoiceInput
      .split(/[\n,;]+/)
      .map(inv => inv.trim().toUpperCase())
      .filter(inv => inv.length > 0);

    if (invoices.length === 0) {
      alert("Por favor ingresa al menos una factura / invoice para sincronizar.");
      return;
    }

    setLoading(true);
    setResults(null);

    try {
      const res = await fetch("/api/batch-disputes-sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoices })
      });
      const data = await res.json();
      
      if (res.ok) {
        const listResults: DisputeResult[] = data.resultados || [];
        setResults(listResults);

        // Compute summary metrics
        let saved = 0;
        let notFound = 0;
        let failed = 0;

        listResults.forEach(r => {
          if (r.status.includes("Guardado")) saved++;
          else if (r.status.includes("No en Disputes") || r.status.includes("No encontrado")) notFound++;
          else failed++;
        });

        setSummary({
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
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
      
      {/* Header */}
      <div className="glass-card p-6 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold font-serif tracking-tight text-white mb-1">Sincronizador Masivo de Disputas</h2>
          <p className="text-sm text-white/70 font-sans">
            Compara listados de facturas con la carpeta de Disputas en ClickUp y registra de forma masiva en Google Sheets.
          </p>
        </div>
        <div className="w-12 h-12 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white shadow-[0_4px_12px_rgba(255,255,255,0.05)]">
          <FileSpreadsheet className="w-6 h-6" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        
        {/* Input Panel */}
        <div className="md:col-span-5 space-y-4">
          <div className="glass-card p-5 space-y-3">
            <label className="text-xs font-bold text-white/60 uppercase tracking-wide">Invoices a Sincronizar</label>
            <textarea
              placeholder="Ingresa las facturas separadas por comas o saltos de línea...&#10;Ej.&#10;M10500&#10;M10501&#10;M10502"
              value={invoiceInput}
              onChange={(e) => setInvoiceInput(e.target.value)}
              rows={8}
              className="w-full bg-white/5 border border-white/15 rounded-xl p-4 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all leading-relaxed font-mono"
            />
            <button
              onClick={handleSync}
              disabled={loading || !invoiceInput.trim()}
              className="w-full py-3.5 bg-white text-slate-950 hover:bg-white/90 disabled:opacity-40 font-bold text-xs flex items-center justify-center gap-2 rounded-xl transition-all cursor-pointer shadow-[0_4px_15px_rgba(255,255,255,0.15)]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-slate-950" /> Sincronizando en Lote...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 text-slate-950" /> Sincronizar Ahora
                </>
              )}
            </button>
          </div>

          {/* Quick info guides */}
          <div className="glass-card p-4 flex gap-2.5 items-start text-xs text-white/70">
            <HelpCircle className="w-5 h-5 text-white/50 shrink-0" />
            <p className="leading-relaxed font-sans">
              <strong>Cómo funciona:</strong> Donna lee las disputas de ClickUp actualizadas este año, extrae el motivo final asignado por ti y envía el webhook a Google Apps Script para actualizar la columna de control en Sheets.
            </p>
          </div>
        </div>

        {/* Results Panel */}
        <div className="md:col-span-7 space-y-6">
          {loading ? (
            <div className="glass-card p-20 flex flex-col items-center justify-center space-y-4">
              <Loader2 className="w-10 h-10 text-white/60 animate-spin" />
              <p className="text-sm text-white/70 font-mono text-center leading-relaxed">
                Conectando con ClickUp API v2...<br />
                Paginando disputas y llamando webhook de Google Sheets...
              </p>
            </div>
          ) : results ? (
            <div className="space-y-6 animate-fade-in">
              {/* Summary stats */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Procesados", val: summary.total, color: "text-white bg-white/5 border border-white/10" },
                  { label: "Sincronizados", val: summary.saved, color: "text-emerald-300 bg-emerald-500/10 border border-emerald-500/20" },
                  { label: "No en Disputas", val: summary.notFound, color: "text-amber-300 bg-amber-500/10 border border-amber-500/20" },
                  { label: "Fallidos", val: summary.failed, color: "text-rose-300 bg-rose-500/10 border border-rose-500/20" }
                ].map((stat, idx) => (
                  <div key={idx} className={`p-3.5 rounded-xl text-center ${stat.color}`}>
                    <span className="block text-[10px] text-white/50 uppercase font-bold tracking-tight">{stat.label}</span>
                    <span className="block text-xl font-bold font-mono mt-1">{stat.val}</span>
                  </div>
                ))}
              </div>

              {/* Table details */}
              <div className="glass-card overflow-hidden shadow-2xl">
                <div className="px-5 py-4 border-b border-white/10 bg-white/5">
                  <span className="text-xs font-bold text-white/70 uppercase tracking-wider">Bitácora de Transacciones</span>
                </div>
                
                <div className="max-h-[340px] overflow-y-auto divide-y divide-white/10">
                  {results.map((res, idx) => {
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
  );
}
