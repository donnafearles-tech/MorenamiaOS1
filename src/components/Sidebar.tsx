import React from "react";
import { 
  FileText, 
  RotateCw, 
  Search, 
  RefreshCw, 
  BarChart2, 
  User, 
  Settings,
  Sparkles,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  UserCheck
} from "lucide-react";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  userEmail?: string;
  tasksCount: number;
}

export default function Sidebar({ activeTab, setActiveTab, userEmail, tasksCount }: SidebarProps) {
  const [isPinned, setIsPinned] = React.useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("sidebar-pinned");
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });
  const [isHovered, setIsHovered] = React.useState<boolean>(false);

  const isExpanded = isPinned || isHovered;

  const handlePinToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPinned((prev) => {
      const newVal = !prev;
      try {
        localStorage.setItem("sidebar-pinned", JSON.stringify(newVal));
      } catch (err) {
        console.error("Error saving sidebar-pinned preference", err);
      }
      return newVal;
    });
  };

  const menuItems = [
    { id: "new-case", label: "Nuevo Caso", icon: FileText, color: "text-amber-400" },
    { id: "task-wheel", label: "Fila de Tareas (ClickUp)", icon: RotateCw, color: "text-purple-400", badge: tasksCount },
    { id: "ai-search", label: "Buscador Donna IA", icon: Search, color: "text-cyan-400" },
    { id: "refund-list", label: "Lista de Reembolsos", icon: ClipboardList, color: "text-rose-400" },
    { id: "disputes-sync", label: "Sincronizar Disputas", icon: RefreshCw, color: "text-emerald-400" },
    { id: "zendesk-check", label: "Verificar Zendesk", icon: UserCheck, color: "text-emerald-400" },
    { id: "metrics", label: "Métricas y Diagnóstico", icon: BarChart2, color: "text-blue-400" },
  ];

  return (
    <aside 
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`${
        isExpanded ? "w-72 p-6" : "w-20 px-3.5 py-6"
      } bg-white/5 backdrop-blur-xl border-r border-white/10 flex flex-col justify-between h-screen sticky top-0 shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.2)] z-20 transition-all duration-300 ease-in-out`}
    >
      <div>
        {/* Brand Header */}
        <div className="flex items-center justify-between mb-10 px-1 relative">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-white/10 border border-white/20 shadow-[0_4px_12px_rgba(255,255,255,0.05)] shrink-0">
              <Sparkles className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div className={`transition-all duration-300 ${isExpanded ? "opacity-100 max-w-[150px]" : "opacity-0 max-w-0 pointer-events-none"}`}>
              <h1 className="text-xl font-bold font-display tracking-tight bg-gradient-to-r from-white via-white/90 to-white/70 bg-clip-text text-transparent truncate">
                Morena OS
              </h1>
              <span className="text-[10px] uppercase font-mono tracking-widest text-white/50 font-semibold block truncate">
                Donna Zavala V1.5
              </span>
            </div>
          </div>

          {/* Pin/Unpin Toggle Button */}
          <button
            onClick={handlePinToggle}
            className={`p-1.5 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 transition-all duration-300 text-white/60 hover:text-white ${
              isExpanded ? "opacity-100 scale-100" : "opacity-0 scale-75 pointer-events-none absolute right-0"
            }`}
            title={isPinned ? "Colapsar Sidebar" : "Fijar Sidebar"}
          >
            {isPinned ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation Menu */}
        <nav className="space-y-1.5">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center ${
                  isExpanded ? "justify-between px-4" : "justify-center px-0"
                } py-3.5 rounded-xl text-sm font-medium transition-all duration-300 group ${
                  isActive 
                    ? "bg-white/15 border border-white/25 text-white shadow-[0_4px_12px_rgba(255,255,255,0.08)]" 
                    : "text-white/60 hover:text-white hover:bg-white/5"
                }`}
                title={!isExpanded ? item.label : undefined}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <Icon className={`w-4.5 h-4.5 transition-transform duration-300 group-hover:scale-110 text-white/80 shrink-0`} />
                  <span className={`font-sans tracking-wide text-left transition-all duration-300 truncate ${
                    isExpanded ? "opacity-100 w-auto" : "opacity-0 w-0 pointer-events-none"
                  }`}>
                    {item.label}
                  </span>
                </div>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className={`px-2 py-0.5 text-[10px] font-bold font-mono rounded-full bg-white/15 text-white border border-white/25 shadow-[0_0_10px_rgba(255,255,255,0.1)] animate-pulse ${
                    isExpanded ? "scale-100 opacity-100" : "scale-0 opacity-0 absolute"
                  } transition-all duration-300`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* User Session Info */}
      <div className="border-t border-white/10 pt-5 space-y-4">
        <div className={`flex items-center ${isExpanded ? "gap-3 px-2 py-1.5" : "justify-center p-0"} rounded-xl bg-white/5 border border-white/10 transition-all duration-300`}>
          <div className="w-9 h-9 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white font-semibold font-mono text-sm shrink-0">
            DZ
          </div>
          <div className={`min-w-0 flex-1 transition-all duration-300 ${isExpanded ? "opacity-100 w-auto" : "opacity-0 w-0 pointer-events-none"}`}>
            <p className="text-xs font-semibold text-white truncate font-sans">Donna Zavala</p>
            <p className="text-[10px] text-white/60 truncate font-mono">{userEmail || "donna.zavalaperez@gmail.com"}</p>
          </div>
        </div>

        <div className={`flex items-center justify-between text-[11px] text-white/40 font-mono px-2 transition-all duration-300 ${
          isExpanded ? "opacity-100 h-4" : "opacity-0 h-0 pointer-events-none overflow-hidden"
        }`}>
          <span>STATUS: ONLINE</span>
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white/40 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-white/80"></span>
          </span>
        </div>
      </div>
    </aside>
  );
}
