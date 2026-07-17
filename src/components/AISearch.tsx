import React, { useState } from "react";
import { 
  Search, 
  Sparkles, 
  Loader2, 
  ArrowRight, 
  ExternalLink, 
  HelpCircle,
  FileText,
  Bookmark
} from "lucide-react";

export default function AISearch() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const suggestions = [
    "política de devolución de productos",
    "requisitos para reembolso GBK",
    "Como iniciar mi primera llamada con un cliente ",
    "protocolo para caso de reacción alérgica"
  ];

  const handleSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setResult(null);
    setQuery(searchQuery);

    try {
      const res = await fetch("/api/ai-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery })
      });
      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setResult({ found: false, answer: `Error de conexión: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
      
      {/* Header */}
      <div className="glass-card p-6 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold font-serif tracking-tight text-white mb-1">Buscador Operativo Donna IA</h2>
          <p className="text-sm text-white/70 font-sans">
            Realiza búsquedas semánticas sobre el manual corporativo, políticas de reembolso y resoluciones de ClickUp.
          </p>
        </div>
        <div className="w-12 h-12 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white shadow-[0_4px_12px_rgba(255,255,255,0.05)]">
          <Search className="w-6 h-6" />
        </div>
      </div>

      {/* Suggestion Chips */}
      <div className="space-y-2">
        <span className="text-[10px] font-bold font-mono text-white/50 uppercase tracking-widest block">Sugerencias de Consulta</span>
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s, idx) => (
            <button
              key={idx}
              onClick={() => handleSearch(s)}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl text-xs text-white/75 hover:text-white transition-all cursor-pointer flex items-center gap-1.5"
            >
              <HelpCircle className="w-3.5 h-3.5 text-white/60" />
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Main Input Area */}
      <div className="bg-white/5 border border-white/15 p-4 rounded-2xl flex gap-3 shadow-lg focus-within:border-white/30 focus-within:bg-white/10 transition-all">
        <input
          type="text"
          placeholder="Ej. ¿Cuáles son los requisitos de reembolso si el cliente tiene dermatitis?..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch(query)}
          className="flex-1 bg-transparent border-none text-sm text-white placeholder-white/35 focus:outline-none px-2"
        />
        <button
          onClick={() => handleSearch(query)}
          disabled={loading || !query.trim()}
          className="px-5 py-3 rounded-xl bg-white text-slate-950 hover:bg-white/90 disabled:opacity-40 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all shrink-0 shadow-[0_4px_15px_rgba(255,255,255,0.15)]"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
          ) : (
            <>
              Preguntar <ArrowRight className="w-4 h-4 text-slate-950" />
            </>
          )}
        </button>
      </div>

      {/* Search results rendering */}
      {loading && (
        <div className="glass-card p-12 flex flex-col items-center justify-center space-y-3.5">
          <Loader2 className="w-8 h-8 text-white/60 animate-spin" />
          <p className="text-xs text-white/60 font-mono">Buscando en el manual operativo y mapeando con ClickUp...</p>
        </div>
      )}

      {result && (
        <div className="glass-card p-8 space-y-6 shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-2.5 text-white font-bold text-sm tracking-wide font-mono">
              <Sparkles className="w-4.5 h-4.5 text-white/80 animate-pulse" />
              Donna IA: Dictamen Técnico y Referencia
            </div>

            {result.task_url && (
              <a
                href={result.task_url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 bg-white/10 border border-white/20 text-white rounded-lg text-xs font-mono font-bold hover:bg-white/20 transition-all flex items-center gap-1"
              >
                Ver Ticket ClickUp <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* Render Markdown Response elegantly */}
          <div className="text-sm text-white/80 leading-relaxed font-sans whitespace-pre-wrap space-y-4">
            {result.answer}
          </div>

          {/* Reference block */}
          <div className="border-t border-white/10 pt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs text-white/40 font-mono gap-3">
            <span className="flex items-center gap-1.5">
              <Bookmark className="w-4 h-4 text-white/40" />
              Fuente: {result.source_file ? `Base de conocimiento (${result.source_file})` : "Base de conocimiento consolidada (conocimiento.json)"}
            </span>
            <span>Búsqueda semántica procesada por Groq LLM</span>
          </div>
        </div>
      )}

    </div>
  );
}
