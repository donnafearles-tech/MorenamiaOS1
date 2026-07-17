import React, { useState, useEffect } from "react";
import { 
  ClipboardList, 
  RotateCw, 
  Loader2, 
  ExternalLink, 
  Check, 
  AlertTriangle,
  User,
  Calendar
} from "lucide-react";

export default function RefundsList() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRefunds = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v2/list/223500803");
      const data = await res.json();
      if (res.ok) {
        setTasks(data.tasks || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRefunds();
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
      
      {/* Header */}
      <div className="glass-card p-6 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold font-serif tracking-tight text-white mb-1">Reembolsos de Lorenzo</h2>
          <p className="text-sm text-white/70 font-sans">
            Sincronización en vivo de la Carpeta #223500803. Registra tareas listas para procesamiento bancario de Lorenzo.
          </p>
        </div>

        <button
          onClick={fetchRefunds}
          disabled={loading}
          className={`p-3.5 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-all cursor-pointer ${loading ? "animate-spin" : ""}`}
        >
          <RotateCw className="w-4.5 h-4.5" />
        </button>
      </div>

      {loading ? (
        <div className="glass-card p-24 flex flex-col items-center justify-center space-y-4">
          <Loader2 className="w-8 h-8 text-white/60 animate-spin" />
          <p className="text-xs text-white/60 font-mono">Conectando con la carpeta de Lorenzo...</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="glass-card p-20 text-center">
          <ClipboardList className="w-12 h-12 text-white/30 mx-auto mb-4" />
          <p className="text-base font-semibold text-white/80">No hay tareas pendientes en reembolsos</p>
          <p className="text-xs text-white/50 mt-1">¡Lorenzo está al día con todos los pagos bancarios y cheques!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {tasks.map(task => {
            const hasCheck = task.name.toUpperCase().includes("CHECK") || task.name.toUpperCase().includes("CHEQUE");
            const hasWire = task.name.toUpperCase().includes("WIRE") || task.name.toUpperCase().includes("TRANSFER");

            return (
              <div
                key={task.id}
                className="glass-card p-6 flex flex-col justify-between hover:border-white/25 hover:bg-white/10 transition-all group shadow-lg"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className={`px-2.5 py-1 rounded-lg text-[9px] font-extrabold uppercase font-mono tracking-wider ${
                      hasCheck 
                        ? "bg-amber-500/20 text-amber-200 border border-amber-500/30" 
                        : hasWire 
                        ? "bg-cyan-500/20 text-cyan-200 border border-cyan-500/30" 
                        : "bg-white/20 text-white border border-white/30"
                    }`}>
                      {hasCheck ? "✉️ CHECK RECONCILIATION" : hasWire ? "🏦 BANK WIRE TRANSFER" : "💸 REFUND ACTION"}
                    </span>

                    <span className="text-[10px] font-bold font-mono text-white/50 uppercase tracking-tight">
                      {task.status}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-white group-hover:text-white transition-colors mb-4 line-clamp-2">
                    {task.name}
                  </h3>

                  <div className="bg-white/5 border border-white/10 p-3.5 rounded-xl space-y-2 mb-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/60">Asignado:</span>
                      <span className="text-white/95 font-medium flex items-center gap-1">
                        <User className="w-3.5 h-3.5 text-white/40" /> Lorenzo R.
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/60">Vencimiento:</span>
                      <span className="text-white/90 font-mono flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-white/40" /> {task.due_date}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <a
                    href={task.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 text-xs text-white border border-white/15 hover:border-white/25 rounded-xl transition-all font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    Abrir en ClickUp <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
