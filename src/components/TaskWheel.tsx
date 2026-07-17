import React, { useState, useEffect } from "react";
import { Task } from "../types";
import { 
  Clock, 
  RotateCw, 
  MapPin, 
  ChevronRight, 
  Calendar, 
  AlertTriangle,
  Flame,
  ArrowRight,
  TrendingUp,
  SlidersHorizontal,
  LayoutGrid,
  Disc,
  CheckCircle2
} from "lucide-react";

interface TaskWheelProps {
  tasks: Task[];
  loading: boolean;
  onRefresh: () => void;
  onSelectTask: (taskId: string) => void;
}

export default function TaskWheel({ tasks, loading, onRefresh, onSelectTask }: TaskWheelProps) {
  const [rotation, setRotation] = useState(0);
  const [selectedFilter, setSelectedFilter] = useState<string>("TODOS");
  const [viewMode, setViewMode] = useState<"wheel" | "grid">("wheel");
  const [sortBy, setSortBy] = useState<"priority" | "timezone">("priority");
  const [time, setTime] = useState(new Date());

  // Update live clock every second
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const rotate = () => {
    setRotation(prev => prev + 45);
  };

  // Timezone Tags mapping to Client Region
  const tzMap: { [key: string]: string } = {
    "NST": "Canada",
    "AST": "Puerto Rico",
    "EST": "Costa Este (NY/Miami)",
    "CST": "Centro (TX/Chicago)",
    "MST": "Montaña (Denver)",
    "PHX": "Arizona",
    "PST": "Pacífico (LA/LV)",
    "AKST": "Alaska",
    "HST": "Hawái"
  };

  // Helper to format live local time based on timezone tag
  const getLiveLocalTime = (tzTag?: string) => {
    const tzOficiales: any = {
      "NST": "America/St_Johns",
      "AST": "America/Puerto_Rico",
      "EST": "America/New_York", 
      "CST": "America/Chicago", 
      "MST": "America/Denver", 
      "PHX": "America/Phoenix",  
      "PST": "America/Los_Angeles", 
      "AKST": "America/Anchorage",
      "HST": "Pacific/Honolulu"
    };
    const zone = tzOficiales[tzTag || "EST"] || "America/New_York";
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
      }).format(time);
    } catch (e) {
      return "N/A";
    }
  };

  const getFormattedClientTime = (timestampISO?: string, tzTag?: string) => {
    if (!timestampISO) return null;
    const tzOficiales: any = {
      "NST": "America/St_Johns",
      "AST": "America/Puerto_Rico",
      "EST": "America/New_York", 
      "CST": "America/Chicago", 
      "MST": "America/Denver", 
      "PHX": "America/Phoenix",  
      "PST": "America/Los_Angeles", 
      "AKST": "America/Anchorage",
      "HST": "Pacific/Honolulu"
    };
    const zone = tzOficiales[tzTag || "EST"] || "America/New_York";
    try {
      const dateObj = new Date(timestampISO);
      const systemTimeStr = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      }).format(dateObj);

      const clientTimeStr = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      }).format(dateObj);

      return { system: systemTimeStr, client: clientTimeStr };
    } catch (e) {
      return null;
    }
  };

  // Helper to resolve priority details & urgency indicator mapping
  const getPriorityInfo = (priority?: string) => {
    const p = (priority || "normal").toLowerCase();
    if (p === "urgent" || p === "high") {
      return {
        label: "Alta",
        colorClass: "text-rose-400 border-rose-500/30 bg-rose-500/10",
        badgeClass: "bg-rose-500/20 text-rose-300 border border-rose-500/30",
        nodeColor: "bg-rose-500/25 backdrop-blur-md border-rose-400/40 text-white shadow-[0_0_15px_rgba(244,63,94,0.25)]",
        glow: "shadow-[0_0_15px_rgba(244,63,94,0.3)]",
        icon: <Flame className="w-3 h-3 text-rose-400 shrink-0" />,
        isUrgent: true,
        rank: 1
      };
    } else if (p === "normal" || p === "medium") {
      return {
        label: "Media",
        colorClass: "text-amber-400 border-amber-500/30 bg-amber-500/10",
        badgeClass: "bg-amber-500/15 text-amber-300 border border-amber-500/20",
        nodeColor: "bg-amber-500/15 backdrop-blur-md border-amber-400/30 text-white/95 hover:bg-amber-500/25",
        glow: "",
        icon: <TrendingUp className="w-3 h-3 text-amber-400 shrink-0" />,
        isUrgent: false,
        rank: 2
      };
    } else {
      return {
        label: "Baja",
        colorClass: "text-slate-400 border-slate-500/20 bg-slate-500/5",
        badgeClass: "bg-slate-500/10 text-slate-300 border border-slate-500/20",
        nodeColor: "bg-white/5 backdrop-blur-md border-white/10 text-white/60 hover:bg-white/10",
        glow: "",
        icon: <Clock className="w-3 h-3 text-slate-400 shrink-0" />,
        isUrgent: false,
        rank: 3
      };
    }
  };

  // Filtering tasks
  const filteredTasks = tasks.filter(t => {
    if (selectedFilter === "TODOS") return true;
    if (selectedFilter === "ALERTAS" && t.status.toLowerCase() === "deadline") return true;
    if (selectedFilter === "ESPERANDO" && t.status.toLowerCase() === "cs reply") return true;
    if (selectedFilter === "PAUSA" && t.status.toLowerCase().includes("waiting")) return true;
    return true;
  });

  // Sorting tasks by chosen criteria (priority vs timezone)
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (sortBy === "priority") {
      const rankA = getPriorityInfo(a.priority).rank;
      const rankB = getPriorityInfo(b.priority).rank;
      if (rankA !== rankB) {
        return rankA - rankB;
      }
    }
    // Fallback/Default is the backend-provided timezone sorting
    return 0;
  });

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Upper Toolbar Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-card p-6">
        <div>
          <h2 className="text-3xl font-bold font-serif tracking-tight text-white mb-1.5">Fila de Tareas en Vivo</h2>
          <p className="text-sm text-white/70 font-sans">
            Optimizado para ordenar las tareas de este a oeste según el huso horario local de cada cliente o por nivel de prioridad.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-white/10 border border-white/20 px-4 py-2 rounded-xl flex items-center gap-2 backdrop-blur-md">
            <Clock className="w-4 h-4 text-white" />
            <span className="text-xs font-mono font-bold text-white">
              LOCAL: {time.toLocaleTimeString()}
            </span>
          </div>

          <button
            onClick={onRefresh}
            disabled={loading}
            className={`px-4 py-2.5 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 cursor-pointer flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${loading ? "opacity-75" : ""}`}
            title="Sincronizar ClickUp"
          >
            <RotateCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            <span>Sincronizar ClickUp</span>
          </button>
        </div>
      </div>

      {/* Filter and View/Sorting Toggles */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 glass-card p-4">
        {/* State filters */}
        <div className="flex flex-wrap gap-1.5">
          {["TODOS", "ALERTAS", "ESPERANDO", "PAUSA"].map(filter => (
            <button
              key={filter}
              onClick={() => setSelectedFilter(filter)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold tracking-wide transition-all duration-300 ${
                selectedFilter === filter
                  ? "bg-white/20 border border-white/30 text-white shadow-md font-bold"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              {filter}
            </button>
          ))}
        </div>

        {/* Sorting Toggles + View Mode Toggles */}
        <div className="flex flex-wrap items-center gap-3 self-stretch lg:self-auto justify-between lg:justify-end">
          {/* Sorting Control */}
          <div className="flex items-center gap-1 p-1 bg-white/5 border border-white/15 rounded-xl">
            <button
              onClick={() => setSortBy("priority")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                sortBy === "priority" ? "bg-white/15 text-white border border-white/20" : "text-white/40 hover:text-white"
              }`}
              title="Ordenar por nivel de Prioridad"
            >
              <Flame className="w-3.5 h-3.5 text-rose-400" /> Prioridad
            </button>
            <button
              onClick={() => setSortBy("timezone")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                sortBy === "timezone" ? "bg-white/15 text-white border border-white/20" : "text-white/40 hover:text-white"
              }`}
              title="Ordenar por huso horario (Este a Oeste)"
            >
              <MapPin className="w-3.5 h-3.5 text-cyan-400" /> Husos Horarios
            </button>
          </div>

          {/* View Toggles */}
          <div className="flex items-center gap-1 p-1 bg-white/5 border border-white/15 rounded-xl">
            <button
              onClick={() => setViewMode("wheel")}
              className={`p-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                viewMode === "wheel" ? "bg-white/15 text-white border border-white/20" : "text-white/40 hover:text-white"
              }`}
            >
              <Disc className="w-4 h-4" /> Radial OS
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                viewMode === "grid" ? "bg-white/15 text-white border border-white/20" : "text-white/40 hover:text-white"
              }`}
            >
              <LayoutGrid className="w-4 h-4" /> Bento Grid
            </button>
          </div>
        </div>
      </div>

      {/* Main Wheel View Mode */}
      {viewMode === "wheel" ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center min-h-[500px]">
          {/* Radial Wheel Stage */}
          <div className="lg:col-span-7 flex justify-center py-6">
            <div className="relative w-[380px] h-[380px] sm:w-[420px] sm:h-[420px] flex items-center justify-center bg-white/[0.02] rounded-full border border-white/10 shadow-[0_4px_30px_rgba(255,255,255,0.03)] backdrop-blur-sm">
              {/* Circuit board aesthetic connections */}
              <div className="absolute inset-0 rounded-full border border-white/5 pointer-events-none scale-90"></div>
              <div className="absolute inset-0 rounded-full border border-white/10 pointer-events-none scale-75 border-dashed"></div>
              <div className="absolute inset-0 rounded-full border border-white/5 pointer-events-none scale-50"></div>

              {/* Central Core */}
              <div className="absolute w-36 h-36 rounded-full bg-white/10 backdrop-blur-xl border border-white/25 shadow-[0_8px_32px_rgba(255,255,255,0.1)] flex flex-col items-center justify-center p-4 z-10">
                <span className="text-[10px] tracking-widest text-white/80 font-bold uppercase mb-1">Donna Core</span>
                <span className="text-3xl font-bold font-display text-white">{sortedTasks.length}</span>
                <span className="text-[9px] text-white/60 font-mono tracking-wide mt-1 uppercase">Casos en Fila</span>
              </div>

              {/* Circular items mapping */}
              <div 
                className="absolute inset-0 transition-transform duration-1000 ease-out"
                style={{ transform: `rotate(${rotation}deg)` }}
              >
                {sortedTasks.slice(0, 12).map((task, idx) => {
                  const angle = (idx * 360) / Math.min(sortedTasks.length, 12);
                  const radius = 160; // distance from center
                  const radians = (angle * Math.PI) / 180;
                  const x = radius * Math.cos(radians);
                  const y = radius * Math.sin(radians);

                  const pInfo = getPriorityInfo(task.priority);
                  const isFirst = idx === 0;
                  const isDeadline = task.status.toLowerCase() === "deadline" || pInfo.isUrgent;

                  let nodeColor = pInfo.nodeColor;
                  if (isFirst) {
                    nodeColor = "bg-white/25 backdrop-blur-xl border-white/40 text-white shadow-[0_0_20px_rgba(255,255,255,0.25)]";
                  } else if (isDeadline) {
                    nodeColor = "bg-rose-500/25 backdrop-blur-lg border-rose-400/40 text-white shadow-[0_0_15px_rgba(244,63,94,0.3)] animate-pulse border";
                  }

                  return (
                    <button
                      key={task.id}
                      onClick={() => onSelectTask(task.id)}
                      className={`absolute w-18 h-18 rounded-full border flex flex-col items-center justify-center transition-all duration-300 hover:scale-110 cursor-pointer z-10 ${nodeColor}`}
                      style={{
                        left: `calc(50% + ${x}px - 2.25rem)`,
                        top: `calc(50% + ${y}px - 2.25rem)`,
                        transform: `rotate(${-rotation}deg)`,
                      }}
                    >
                      <span className="text-[10px] font-bold font-mono tracking-tight text-center truncate w-14">
                        {task.name.split("-")[0]?.trim().slice(0, 10) || "CASO"}
                      </span>
                      <span className="text-[8px] font-semibold text-white/60 font-mono mt-0.5">
                        {task.tz_tag || "EST"}
                      </span>
                      {isDeadline && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 rounded-full border border-slate-900 flex items-center justify-center animate-bounce shadow-md">
                          <Flame className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Detailed Bento list of active tasks on the right */}
          <div className="lg:col-span-5 space-y-4 max-h-[500px] overflow-y-auto pr-2">
            <div className="flex items-center justify-between px-2">
              <span className="text-xs font-bold text-white/60 uppercase tracking-wider">Orden de Trabajo ({sortBy === "priority" ? "Prioridad" : "Huso Horario"})</span>
              <button 
                onClick={rotate}
                className="text-xs font-semibold text-white/80 hover:text-white flex items-center gap-1 transition-all"
              >
                Rotar Fila ➔
              </button>
            </div>

            {sortedTasks.length === 0 ? (
              <div className="glass-card p-10 text-center">
                <AlertTriangle className="w-10 h-10 text-white/40 mx-auto mb-3" />
                <p className="text-sm font-semibold text-white/80">No hay tareas que coincidan con el filtro</p>
                <p className="text-xs text-white/50 mt-1">¡Buen trabajo en mantener tu bandeja limpia!</p>
              </div>
            ) : (
              sortedTasks.map((task, idx) => {
                const pInfo = getPriorityInfo(task.priority);
                const isFirst = idx === 0;
                const isDeadline = task.status.toLowerCase() === "deadline" || pInfo.isUrgent;
                const isWaiting = task.status.toLowerCase().includes("waiting");

                return (
                  <div
                    key={task.id}
                    onClick={() => onSelectTask(task.id)}
                    className={`p-4 rounded-xl border transition-all duration-300 hover:translate-x-1 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 group ${
                      isFirst 
                        ? "bg-white/15 border-white/30 shadow-[0_4px_12px_rgba(255,255,255,0.05)]"
                        : isDeadline 
                        ? "bg-rose-500/15 border-rose-500/35 hover:border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.08)]"
                        : "bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/10"
                    }`}
                  >
                    <div className="flex items-start gap-3.5 min-w-0 flex-1">
                      {/* Priority position indicator */}
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-mono font-bold text-xs shrink-0 ${
                        isFirst 
                          ? "bg-white/20 text-white border border-white/30" 
                          : isDeadline
                          ? "bg-rose-500/20 text-rose-200 border border-rose-500/30 animate-pulse"
                          : "bg-white/5 text-white/60 border border-white/10"
                      }`}>
                        {idx + 1}
                      </div>

                      <div className="min-w-0 flex-1">
                        {/* Hour/Time at the top of details */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-mono text-white/50 mb-1">
                          <span className="flex items-center gap-1 text-cyan-400 font-bold bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-500/15">
                            <Clock className="w-3 h-3 text-cyan-300" />
                            {getLiveLocalTime(task.tz_tag)}
                          </span>
                          <span className="text-white/20">|</span>
                          <span className="flex items-center gap-1 text-white/70">
                            <MapPin className="w-3 h-3 text-white/40" />
                            {task.tz_tag || "EST"}
                          </span>
                        </div>

                        <h4 className="text-sm font-bold text-white truncate group-hover:text-white transition-colors">
                          {task.name}
                        </h4>
                        
                        {task.answered_at && (() => {
                          const formatted = getFormattedClientTime(task.answered_at, task.tz_tag);
                          if (!formatted) return null;
                          return (
                            <div className="text-[10px] text-emerald-400 font-mono font-semibold mt-1.5 flex flex-wrap items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/15 w-fit">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              <span>Contestó: {formatted.client} ({task.tz_tag}) | Sis: {formatted.system}</span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0 w-full sm:w-auto pt-2 sm:pt-0 border-t border-white/5 sm:border-0">
                      <div className="flex items-center gap-2">
                        {/* Priority Level Badge */}
                        <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold uppercase font-mono tracking-wider flex items-center gap-1 ${pInfo.badgeClass}`}>
                          {pInfo.icon}
                          <span>{pInfo.label}</span>
                        </span>

                        {/* Status Badge */}
                        <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold uppercase font-mono tracking-wider ${
                          isFirst
                            ? "bg-white/20 text-white border border-white/30"
                            : isDeadline
                            ? "bg-rose-500/20 text-rose-200 border border-rose-500/30 animate-pulse"
                            : isWaiting
                            ? "bg-amber-500/15 text-amber-200 border border-amber-500/30"
                            : "bg-white/10 text-white/70 border border-white/10"
                        }`}>
                          {task.status}
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-white/40 group-hover:text-white group-hover:translate-x-0.5 transition-all duration-300" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        /* Bento Grid View Mode */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {sortedTasks.map((task, idx) => {
            const pInfo = getPriorityInfo(task.priority);
            const isFirst = idx === 0;
            const isDeadline = task.status.toLowerCase() === "deadline" || pInfo.isUrgent;

            return (
              <div
                key={task.id}
                onClick={() => onSelectTask(task.id)}
                className={`p-6 rounded-2xl border transition-all duration-300 hover:-translate-y-1 cursor-pointer flex flex-col justify-between group ${
                  isFirst
                    ? "bg-white/15 border-white/30 shadow-lg"
                    : isDeadline
                    ? "bg-rose-500/10 border-rose-500/30 hover:border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.06)]"
                    : "bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/10"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-bold font-mono text-white/50">#{idx + 1} EN FILA</span>
                    <div className="flex items-center gap-1.5">
                      {/* Priority Level Badge */}
                      <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold uppercase font-mono tracking-wider flex items-center gap-1 ${pInfo.badgeClass}`}>
                        {pInfo.icon}
                        <span>{pInfo.label}</span>
                      </span>

                      {/* Status Badge */}
                      <span className={`px-2.5 py-0.5 rounded-lg text-[9px] font-extrabold font-mono tracking-wider uppercase ${
                        isFirst ? "bg-white/20 text-white border border-white/30" : "bg-white/10 text-white/75 border border-white/15"
                      }`}>
                        {task.status}
                      </span>
                    </div>
                  </div>

                  <h4 className="text-base font-bold text-white mb-3 truncate group-hover:text-white transition-colors">
                    {task.name}
                  </h4>

                  <div className="bg-white/5 border border-white/10 p-3.5 rounded-xl space-y-2 mb-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/60">Cliente Local:</span>
                      <span className="font-mono font-bold text-white flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {getLiveLocalTime(task.tz_tag)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/60">Región:</span>
                      <span className="font-mono text-white/80 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-white/40" />
                        {task.tz_tag || "EST"} ({tzMap[task.tz_tag || "EST"] || "USA"})
                      </span>
                    </div>
                    {task.answered_at && (() => {
                      const formatted = getFormattedClientTime(task.answered_at, task.tz_tag);
                      if (!formatted) return null;
                      return (
                        <div className="flex flex-col gap-1 mt-2 pt-2 border-t border-white/10">
                          <div className="flex items-center justify-between text-xs text-emerald-400">
                            <span>Cliente Contestó:</span>
                            <span className="font-mono font-bold flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              {formatted.client}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-white/40 font-mono">
                            <span>Hora de Sistema:</span>
                            <span>{formatted.system}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-white/10 pt-4 text-xs font-semibold text-white/60 group-hover:text-white transition-colors">
                  <span>Procesar Avance</span>
                  <ArrowRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
