import React, { useState, useEffect } from "react";
import { 
  BarChart2, 
  Loader2, 
  RotateCw, 
  Cpu, 
  CheckCircle, 
  AlertCircle,
  Clock,
  Sparkles,
  MapPin,
  TrendingUp,
  History,
  Users,
  Phone
} from "lucide-react";
import { Metric } from "../types";

export default function MetricsPanel() {
  const [metrics, setMetrics] = useState<Metric | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoClosedLogs, setAutoClosedLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const fetchAutoClosedLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await fetch("/api/auto-closed-logs");
      if (res.ok && (res.headers.get("content-type") || "").includes("application/json")) {
        const data = await res.json();
        setAutoClosedLogs(data.logs || []);
      }
    } catch (err) {
      console.error("Error fetching auto-closed logs:", err);
    } finally {
      setLoadingLogs(false);
    }
  };

  const fetchMetrics = async (retries = 3, delay = 1000) => {
    setLoading(true);
    fetchAutoClosedLogs();
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetch("/api/metrics");
        if (res.ok) {
          const contentType = res.headers.get("content-type") || "";
          if (!contentType.includes("application/json")) {
            throw new Error("Respuesta del servidor no es JSON válido");
          }
          const data = await res.json();
          setMetrics(data.metrics);
          setLoading(false);
          return;
        } else {
          throw new Error(`HTTP error ${res.status}`);
        }
      } catch (err: any) {
        console.warn(`[Attempt ${attempt}/${retries}] Error fetching metrics:`, err.message);
        if (attempt === retries) {
          console.error("All retries failed for metrics fetch:", err);
        } else {
          await new Promise((resolve) => setTimeout(resolve, delay * attempt));
        }
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
      
      {/* Header */}
      <div className="glass-card p-6 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold font-serif tracking-tight text-white mb-1">Métricas de Rendimiento</h2>
          <p className="text-sm text-white/70 font-sans">
            Estadísticas internas en tiempo real sobre la automatización del Morena OS y procesamiento de Donna IA.
          </p>
        </div>

        <button
          onClick={fetchMetrics}
          disabled={loading}
          className={`p-3.5 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-all cursor-pointer ${loading ? "animate-spin" : ""}`}
        >
          <RotateCw className="w-4.5 h-4.5" />
        </button>
      </div>

      {loading ? (
        <div className="glass-card p-24 flex flex-col items-center justify-center space-y-4">
          <Loader2 className="w-8 h-8 text-white/60 animate-spin" />
          <p className="text-xs text-white/60 font-mono">Compilando estadísticas de rendimiento...</p>
        </div>
      ) : metrics ? (
        <div className="space-y-8">
          
          {/* Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            
            {/* Created Tickets */}
            <div className="glass-card p-6 flex items-center justify-between shadow-lg">
              <div>
                <span className="block text-xs font-bold text-white/50 uppercase tracking-wide">Tickets Creados</span>
                <span className="block text-4xl font-bold font-mono text-white mt-2">{metrics.tasks_created}</span>
                <span className="block text-[10px] text-white/60 font-mono mt-1">Registrados en ClickUp</span>
              </div>
              <div className="w-12 h-12 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white shadow-[0_4px_12px_rgba(255,255,255,0.05)]">
                <CheckCircle className="w-6 h-6" />
              </div>
            </div>

            {/* AI Search Calls */}
            <div className="glass-card p-6 flex items-center justify-between shadow-lg">
              <div>
                <span className="block text-xs font-bold text-white/50 uppercase tracking-wide">Consultas Donna IA</span>
                <span className="block text-4xl font-bold font-mono text-white mt-2">{metrics.ai_search_calls}</span>
                <span className="block text-[10px] text-white/60 font-mono mt-1">Búsquedas Semánticas</span>
              </div>
              <div className="w-12 h-12 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white shadow-[0_4px_12px_rgba(255,255,255,0.05)]">
                <Sparkles className="w-6 h-6" />
              </div>
            </div>

            {/* Logs Pushed */}
            <div className="glass-card p-6 flex items-center justify-between shadow-lg">
              <div>
                <span className="block text-xs font-bold text-white/50 uppercase tracking-wide">Traducciones (Logs)</span>
                <span className="block text-4xl font-bold font-mono text-white mt-2">{metrics.logs_pushed}</span>
                <span className="block text-[10px] text-white/60 font-mono mt-1">Sincronizaciones ClickUp</span>
              </div>
              <div className="w-12 h-12 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white shadow-[0_4px_12px_rgba(255,255,255,0.05)]">
                <Clock className="w-6 h-6" />
              </div>
            </div>

          </div>

          {/* Detailed Diagnosis Card */}
          <div className="glass-card p-8 space-y-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white flex items-center gap-2.5">
              <Cpu className="w-5 h-5 text-white/80" />
              Diagnóstico del Sistema y Latencia
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 divide-y md:divide-y-0 md:divide-x divide-white/10">
              
              {/* Left Column */}
              <div className="space-y-4 pr-0 md:pr-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60">Tiempo Promedio Búsqueda IA:</span>
                  <span className="font-mono font-bold text-white">{metrics.ai_search_avg_time_ms.toFixed(1)} ms</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60">Tiempo Total de Cómputo IA:</span>
                  <span className="font-mono font-bold text-white">{(metrics.total_ai_time_ms / 1000).toFixed(2)} s</span>
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-4 pl-0 md:pl-6 pt-4 md:pt-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60">Servidor Node.js / Express:</span>
                  <span className="font-mono font-bold text-emerald-300 flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" /> ACTIVO
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60">Conexión ClickUp API:</span>
                  <span className="font-mono font-bold text-emerald-300 flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" /> CONECTADO
                  </span>
                </div>
              </div>

            </div>
          </div>

          {/* Distribución Geográfica por Área */}
          <div className="glass-card p-8 space-y-6 shadow-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2.5">
                <MapPin className="w-5 h-5 text-indigo-400" />
                Distribución Geográfica de Clientes (EE.UU.)
              </h3>
              <span className="text-xs font-mono bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 px-2.5 py-1 rounded-full flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                Clientes Activos: {metrics.total_active_clients || 0}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Coverage Cards */}
              <div className="space-y-4 md:col-span-1">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-300">
                    <Phone className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="block text-[10px] text-white/50 uppercase font-mono">Con Teléfono</span>
                    <span className="block text-xl font-bold text-white font-mono">{metrics.total_with_phone || 0}</span>
                  </div>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-300">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="block text-[10px] text-white/50 uppercase font-mono">Estado EE.UU. Detectado</span>
                    <span className="block text-xl font-bold text-white font-mono">{metrics.total_with_us_state || 0}</span>
                  </div>
                </div>

                <p className="text-xs text-white/50 leading-relaxed pt-2">
                  La ubicación de cada cliente se diagnostica automáticamente a partir del código de área de su número telefónico registrado en ClickUp.
                </p>
              </div>

              {/* Geographic Distribution Bars */}
              <div className="md:col-span-2 space-y-4 bg-white/5 border border-white/10 rounded-2xl p-6">
                <span className="block text-xs font-bold text-white/70 uppercase tracking-wide mb-3">
                  Porcentaje de Clientes por Estado
                </span>

                {metrics.state_distribution && Object.keys(metrics.state_distribution).length > 0 ? (
                  <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {Object.entries(metrics.state_distribution)
                      .sort((a, b) => Number(b[1]) - Number(a[1]))
                      .map(([state, percentage]) => {
                        // Generate dynamic colors or standard styling
                        const isMainState = state !== "Otros / No US" && state !== "Sin teléfono";
                        const barColorClass = isMainState ? "bg-gradient-to-r from-indigo-500 to-purple-500" : "bg-white/20";
                        const textColorClass = isMainState ? "text-white" : "text-white/60";

                        return (
                          <div key={state} className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs font-medium">
                              <span className={textColorClass}>{state}</span>
                              <span className="font-mono text-white/90">{percentage}%</span>
                            </div>
                            <div className="h-2.5 w-full bg-white/5 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-1000 ${barColorClass}`}
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <div className="py-12 text-center text-white/40 text-xs">
                    No hay suficientes datos geográficos disponibles. Registre números de teléfono con códigos de área válidos de EE.UU.
                  </div>
                )}
              </div>

            </div>
          </div>

          {/* Historial Estadístico */}
          <div className="glass-card p-8 space-y-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white flex items-center gap-2.5 border-b border-white/10 pb-4">
              <History className="w-5 h-5 text-purple-400" />
              Historial Estadístico y Tendencias
            </h3>

            {metrics.history && metrics.history.length > 0 ? (
              <div className="space-y-4">
                <span className="block text-xs font-bold text-white/70 uppercase tracking-wide">
                  Logs Históricos Registrados
                </span>

                <div className="overflow-x-auto max-h-[280px] overflow-y-auto pr-2 custom-scrollbar border border-white/10 rounded-2xl">
                  <table className="w-full text-left text-xs text-white/80 border-collapse">
                    <thead>
                      <tr className="bg-white/10 text-white/60 font-mono uppercase tracking-wider text-[10px]">
                        <th className="p-4 border-b border-white/10">Fecha / Hora</th>
                        <th className="p-4 border-b border-white/10 text-center">Clientes</th>
                        <th className="p-4 border-b border-white/10">Distribución Geográfica</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 bg-white/5">
                      {metrics.history
                        .slice()
                        .reverse()
                        .map((entry, idx) => {
                          const dateStr = (() => {
                            try {
                              return new Date(entry.timestamp).toLocaleString("es-ES", {
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit"
                              });
                            } catch (e) {
                              return entry.timestamp;
                            }
                          })();

                          return (
                            <tr key={idx} className="hover:bg-white/10 transition-colors">
                              <td className="p-4 font-mono font-bold text-white">{dateStr}</td>
                              <td className="p-4 text-center font-mono">{entry.total_clients}</td>
                              <td className="p-4">
                                <div className="flex flex-wrap gap-1.5 max-w-lg">
                                  {Object.entries(entry.distribution)
                                    .filter(([_, pct]) => Number(pct) > 0)
                                    .slice(0, 5)
                                    .map(([state, pct]) => {
                                      const isSpecial = state !== "Otros / No US" && state !== "Sin teléfono";
                                      return (
                                        <span
                                          key={state}
                                          className={`text-[9px] px-2 py-0.5 rounded-md font-mono ${
                                            isSpecial
                                              ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                                              : "bg-white/5 text-white/40 border border-white/10"
                                          }`}
                                        >
                                          {state}: {pct}%
                                        </span>
                                      );
                                    })}
                                  {Object.entries(entry.distribution).filter(([_, pct]) => Number(pct) > 0).length > 5 && (
                                    <span className="text-[9px] text-white/40 px-2 py-0.5">...</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-white/40 text-xs">
                No se han registrado datos históricos todavía. Refresque las métricas para generar la primera muestra.
              </div>
            )}
          </div>

          {/* Registro de Cierres Automáticos por Deadline */}
          <div className="glass-card p-8 space-y-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white flex items-center gap-2.5 border-b border-white/10 pb-4">
              <Clock className="w-5 h-5 text-emerald-400" />
              Cierres Automáticos por Deadline Pasado
            </h3>

            <p className="text-xs text-white/60 font-sans leading-relaxed">
              Registro histórico de las tareas que han sido cerradas automáticamente por Donna OS tras permanecer más de 4 días hábiles (excluyendo sábados y domingos) en estatus de aviso límite o deadline.
            </p>

            {loadingLogs ? (
              <div className="py-8 text-center flex flex-col items-center justify-center space-y-2">
                <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
                <span className="text-xs text-white/40 font-mono">Cargando registros...</span>
              </div>
            ) : autoClosedLogs && autoClosedLogs.length > 0 ? (
              <div className="overflow-x-auto max-h-[300px] overflow-y-auto pr-2 custom-scrollbar border border-white/10 rounded-2xl">
                <table className="w-full text-left text-xs text-white/80 border-collapse">
                  <thead>
                    <tr className="bg-white/10 text-white/60 font-mono uppercase tracking-wider text-[10px]">
                      <th className="p-4 border-b border-white/10">ID de Tarea</th>
                      <th className="p-4 border-b border-white/10">Nombre de la Tarea</th>
                      <th className="p-4 border-b border-white/10 text-center">Días en Deadline</th>
                      <th className="p-4 border-b border-white/10">Mensaje de Cierre / Log</th>
                      <th className="p-4 border-b border-white/10 text-right">Fecha de Cierre</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 bg-white/5">
                    {autoClosedLogs
                      .slice()
                      .reverse()
                      .map((log: any, idx: number) => {
                        const dateStr = (() => {
                          try {
                            return new Date(log.closedAt).toLocaleString("es-ES", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit"
                            });
                          } catch (e) {
                            return log.closedAt;
                          }
                        })();

                        return (
                          <tr key={idx} className="hover:bg-white/10 transition-colors">
                            <td className="p-4 font-mono text-white/60">{log.id}</td>
                            <td className="p-4 font-medium text-white">{log.name}</td>
                            <td className="p-4 text-center font-mono text-emerald-400 font-bold">{log.daysPassed || 4} d</td>
                            <td className="p-4 italic text-white/70">"{log.message}"</td>
                            <td className="p-4 text-right font-mono text-white/50">{dateStr}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center text-white/40 text-xs">
                No se han registrado cierres automáticos de tareas por deadline vencido todavía.
              </div>
            )}
          </div>

        </div>
      ) : (
        <div className="glass-card p-16 text-center">
          <AlertCircle className="w-12 h-12 text-white/30 mx-auto mb-4 animate-pulse" />
          <p className="text-sm font-semibold text-white/80">No se pudieron descargar las métricas.</p>
        </div>
      )}

    </div>
  );
}
