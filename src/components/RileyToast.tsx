import React from "react";
import { ShieldAlert, CheckCircle2, X, Bot, AlertTriangle, ArrowRight } from "lucide-react";
import { RileyEvaluationResult } from "../services/rileyAgent";

interface RileyToastProps {
  evaluation: RileyEvaluationResult | null;
  onApplySuggestedResolution?: (suggested: string) => void;
  onDismiss?: () => void;
  onClose?: () => void;
}

export default function RileyToast({
  evaluation,
  onApplySuggestedResolution,
  onDismiss,
  onClose
}: RileyToastProps) {
  if (!evaluation) return null;

  const isCheck = evaluation.status === "CHECK";

  return (
    <div
      className={`fixed bottom-5 right-5 z-50 max-w-lg w-full p-4 rounded-2xl border shadow-2xl backdrop-blur-xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-5 ${
        isCheck
          ? "bg-amber-950/95 border-amber-500/60 text-amber-100 shadow-amber-950/50"
          : "bg-emerald-950/95 border-emerald-500/60 text-emerald-100 shadow-emerald-950/50"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Agent Avatar Badge */}
        <div
          className={`p-2.5 rounded-xl border flex items-center justify-center shrink-0 ${
            isCheck
              ? "bg-amber-500/20 border-amber-400/40 text-amber-300 animate-pulse"
              : "bg-emerald-500/20 border-emerald-400/40 text-emerald-300"
          }`}
        >
          {isCheck ? <ShieldAlert className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
        </div>

        {/* Content */}
        <div className="flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-white/10 border border-white/20 flex items-center gap-1">
                <Bot className="w-3.5 h-3.5 text-amber-400" /> Agente Riley
              </span>
              {evaluation.ruleId && (
                <span className="text-[10px] font-mono text-amber-300 bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-500/30">
                  {evaluation.ruleId}
                </span>
              )}
            </div>
            {(onClose || onDismiss) && (
              <button
                onClick={onClose || onDismiss}
                className="text-white/60 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <h4 className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5 pt-0.5">
            {evaluation.title}
          </h4>

          <p className="text-xs text-white/85 leading-relaxed">
            {evaluation.description}
          </p>

          {evaluation.details && (
            <div className="text-[11px] font-mono bg-black/40 p-2 rounded-lg border border-white/10 text-amber-200/90 mt-2">
              {evaluation.details}
            </div>
          )}

          {/* Action Bar */}
          <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] text-amber-300/80 font-mono flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              Verifica el motivo y comentarios antes de guardar.
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {evaluation.suggestedResolution && onApplySuggestedResolution && (
                <button
                  onClick={() => onApplySuggestedResolution(evaluation.suggestedResolution!)}
                  className="py-1 px-3 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl flex items-center gap-1 transition-all shadow-md cursor-pointer"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  Cambiar a {evaluation.suggestedResolution}
                </button>
              )}

              <button
                onClick={onDismiss || onClose}
                className="py-1 px-3 bg-white/10 hover:bg-white/20 text-white font-semibold text-xs rounded-xl border border-white/20 transition-all cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
