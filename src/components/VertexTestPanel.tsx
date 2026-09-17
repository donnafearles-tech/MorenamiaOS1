import React, { useState, useEffect } from "react";
import { Sparkles, Play, CheckCircle2, AlertTriangle, Loader2, Server, ShieldCheck, Terminal, Cpu } from "lucide-react";

export default function VertexTestPanel() {
  const [prompt, setPrompt] = useState("Hola Donna AI, realiza un diagnóstico corto confirmando que estás conectada exitosamente a Vertex AI en Google Cloud.");
  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [statusInfo, setStatusInfo] = useState<any>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const fetchStatus = async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch("/api/keys/status");
      if (res.ok) {
        const data = await res.json();
        setStatusInfo(data.vertex || null);
      }
    } catch (err) {
      console.error("Error al cargar estado de Vertex:", err);
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleRunTest = async () => {
    setLoading(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/test-vertex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({
        success: false,
        error: err.message || "Error de red al intentar conectar con el servidor.",
      });
    } finally {
      setLoading(false);
      fetchStatus();
    }
  };

  return (
    <div className="glass-card p-6 space-y-6 shadow-xl border border-white/10">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div className="flex items-center space-x-3">
          <div className="p-3 rounded-xl bg-indigo-500/20 border border-indigo-400/30 text-indigo-300">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold font-serif text-white flex items-center gap-2">
              Prueba de Conexión Vertex AI
              <span className="px-2 py-0.5 text-[10px] font-mono rounded-full bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                Gemini 2.5 Flash
              </span>
            </h3>
            <p className="text-xs text-white/60 font-sans mt-0.5">
              Valida la comunicación en vivo entre Donna AI y tu infraestructura en Google Cloud Vertex AI.
            </p>
          </div>
        </div>

        <button
          onClick={handleRunTest}
          disabled={loading}
          className="inline-flex items-center justify-center space-x-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-lg transition-all disabled:opacity-50 cursor-pointer"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Conectando a Vertex...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>Ejecutar Prueba</span>
            </>
          )}
        </button>
      </div>

      {/* Config Badges */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center space-x-2.5">
          <Server className="w-4 h-4 text-white/60 shrink-0" />
          <div className="overflow-hidden">
            <span className="block text-[10px] text-white/40 uppercase font-mono">Proyecto GCP</span>
            <span className="font-mono text-white font-semibold truncate block">
              {loadingStatus ? "Cargando..." : statusInfo?.project || "No detectado"}
            </span>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center space-x-2.5">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <div className="overflow-hidden">
            <span className="block text-[10px] text-white/40 uppercase font-mono">Autenticación</span>
            <span className="font-mono text-white font-semibold truncate block">
              {statusInfo?.hasServiceAccountJson
                ? "Service Account JSON (Secrets)"
                : statusInfo?.hasApiKey
                ? "API Key Configurada"
                : "Credencial predeterminada Cloud Run"}
            </span>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center space-x-2.5">
          <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
          <div className="overflow-hidden">
            <span className="block text-[10px] text-white/40 uppercase font-mono">Región</span>
            <span className="font-mono text-white font-semibold truncate block">
              {statusInfo?.location || "global"}
            </span>
          </div>
        </div>
      </div>

      {/* Interactive Prompt Input */}
      <div className="space-y-2">
        <label className="block text-xs font-semibold text-white/80 font-mono">
          Prompt de Diagnóstico de Prueba:
        </label>
        <div className="relative">
          <textarea
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Escribe un mensaje para probar Vertex AI..."
            className="w-full bg-black/30 border border-white/15 rounded-xl px-4 py-2.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-indigo-500/50 transition-all font-sans"
          />
        </div>
      </div>

      {/* Test Output Panel */}
      {testResult && (
        <div
          className={`p-4 rounded-xl border transition-all ${
            testResult.success
              ? "bg-emerald-950/30 border-emerald-500/40"
              : "bg-red-950/30 border-red-500/40"
          }`}
        >
          <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
            <div className="flex items-center space-x-2">
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-400" />
              )}
              <span className="text-xs font-bold font-mono text-white">
                {testResult.success ? "Conexión Exitosa con Vertex AI" : "Error de Conexión a Vertex AI"}
              </span>
            </div>

            {testResult.latencyMs && (
              <span className="text-[10px] font-mono text-white/60 bg-white/10 px-2 py-0.5 rounded">
                {testResult.latencyMs} ms
              </span>
            )}
          </div>

          {testResult.success ? (
            <div className="space-y-2">
              <p className="text-xs text-white/90 leading-relaxed font-sans bg-black/20 p-3 rounded-lg border border-white/5">
                {testResult.response}
              </p>
              <div className="flex flex-wrap gap-2 text-[10px] font-mono text-white/50">
                <span>Modelo: {testResult.modelUsed}</span>
                <span>•</span>
                <span>Proveedor: {testResult.provider}</span>
                <span>•</span>
                <span>Proyecto: {testResult.project}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-red-300 font-mono bg-black/40 p-3 rounded-lg border border-red-500/20">
                {testResult.error}
              </p>
              {testResult.helpTip && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200">
                  <strong>💡 Sugerencia:</strong> {testResult.helpTip}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
