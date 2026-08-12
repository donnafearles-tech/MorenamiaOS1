import React, { useState, useEffect } from "react";
import { 
  UserCheck, 
  Search, 
  Mail, 
  Phone, 
  User, 
  ExternalLink, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Copy, 
  Check, 
  Ticket, 
  Loader2, 
  ShieldAlert, 
  Sparkles,
  RefreshCw,
  Plus,
  Zap,
  ArrowRight
} from "lucide-react";
import { checkZendeskUser, CheckZendeskUserResponse, ZendeskUserResult, ZendeskTicketSummary } from "../services/zendesk";

interface ZendeskUserCheckerProps {
  initialEmail?: string;
  initialPhone?: string;
  initialName?: string;
  initialQuery?: string;
  isModalMode?: boolean;
  taskId?: string;
  tasksList?: any[];
  onTaskUpdated?: () => void;
  onClose?: () => void;
  onSelectUser?: (user: ZendeskUserResult, ticket?: ZendeskTicketSummary) => void;
}

export default function ZendeskUserChecker({
  initialEmail = "",
  initialPhone = "",
  initialName = "",
  initialQuery = "",
  isModalMode = false,
  taskId,
  tasksList = [],
  onTaskUpdated,
  onClose,
  onSelectUser
}: ZendeskUserCheckerProps) {
  const [searchType, setSearchType] = useState<"email" | "phone" | "name" | "query">(() => {
    if (initialEmail) return "email";
    if (initialPhone) return "phone";
    if (initialName) return "name";
    return "query";
  });

  const [emailInput, setEmailInput] = useState(initialEmail);
  const [phoneInput, setPhoneInput] = useState(initialPhone);
  const [nameInput, setNameInput] = useState(initialName);
  const [queryInput, setQueryInput] = useState(initialQuery);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckZendeskUserResponse | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Active target task state for automatic association
  const [selectedTaskId, setSelectedTaskId] = useState<string>(taskId || "");
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<{ id: string; message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (taskId) {
      setSelectedTaskId(taskId);
    } else if (tasksList && tasksList.length > 0 && !selectedTaskId) {
      setSelectedTaskId(tasksList[0].id);
    }
  }, [taskId, tasksList]);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoading(true);
    setResult(null);
    setSyncFeedback(null);

    const payload: { email?: string; phone?: string; name?: string; query?: string } = {};
    if (searchType === "email" && emailInput.trim()) payload.email = emailInput.trim();
    else if (searchType === "phone" && phoneInput.trim()) payload.phone = phoneInput.trim();
    else if (searchType === "name" && nameInput.trim()) payload.name = nameInput.trim();
    else if (queryInput.trim()) payload.query = queryInput.trim();
    else if (emailInput.trim()) payload.email = emailInput.trim();
    else if (phoneInput.trim()) payload.phone = phoneInput.trim();
    else if (nameInput.trim()) payload.name = nameInput.trim();

    if (Object.keys(payload).length === 0) {
      setLoading(false);
      return;
    }

    const res = await checkZendeskUser(payload);
    setResult(res);
    setLoading(false);
  };

  useEffect(() => {
    if (initialEmail || initialPhone || initialName || initialQuery) {
      handleSearch();
    }
  }, []);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Helper to get active Zendesk ticket for a user
  const getActiveTicket = (user: ZendeskUserResult): ZendeskTicketSummary | undefined => {
    if (!user.recent_tickets || user.recent_tickets.length === 0) return undefined;
    return user.recent_tickets.find(t => 
      ["open", "pending", "new", "hold"].includes((t.status || "").toLowerCase())
    ) || user.recent_tickets[0];
  };

  // Automatic one-click sync handler (NO MODAL DIALOGS)
  const handleAutoUpdateUserAndTicket = async (user: ZendeskUserResult, ticket?: ZendeskTicketSummary) => {
    const targetTaskId = taskId || selectedTaskId;
    const activeTicket = ticket || getActiveTicket(user);
    const targetTicketId = activeTicket ? String(activeTicket.id) : "";

    if (onSelectUser) {
      onSelectUser(user, activeTicket);
    }

    if (!targetTaskId) {
      setSyncFeedback({
        id: String(user.id),
        message: "⚠️ Usuario cargado en formulario. Para asociar a la Base de Datos selecciona una tarea activa.",
        type: "success"
      });
      return;
    }

    setUpdatingTaskId(String(user.id));
    setSyncFeedback(null);

    try {
      const res = await fetch("/api/update-client-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: targetTaskId,
          email: user.email || undefined,
          phone: user.phone || undefined,
          zendesk_ticket_id: targetTicketId || undefined
        })
      });

      if (res.ok) {
        setSyncFeedback({
          id: String(user.id),
          message: `✅ ¡Datos actualizados automáticamente! Correo (${user.email || 'N/A'}) y Ticket Zendesk #${targetTicketId || 'sin ticket'} asociados a la Tarea #${targetTaskId}.`,
          type: "success"
        });
        if (onTaskUpdated) onTaskUpdated();
      } else {
        const err = await res.json().catch(() => ({}));
        setSyncFeedback({
          id: String(user.id),
          message: `❌ Error al actualizar la tarea #${targetTaskId}: ${err.error || 'Respuesta inválida'}`,
          type: "error"
        });
      }
    } catch (err: any) {
      setSyncFeedback({
        id: String(user.id),
        message: `❌ Error de conexión: ${err.message}`,
        type: "error"
      });
    }
    setUpdatingTaskId(null);
  };

  const getStatusBadge = (status: string) => {
    const s = (status || "").toLowerCase();
    switch (s) {
      case "new":
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30">NUEVO</span>;
      case "open":
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30">ABIERTO</span>;
      case "pending":
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30">PENDIENTE</span>;
      case "solved":
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">RESUELTO</span>;
      case "closed":
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-slate-500/20 text-slate-300 border border-slate-500/30">CERRADO</span>;
      default:
        return <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-white/10 text-white/70 border border-white/20">{s.toUpperCase()}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      {!isModalMode && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-md">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide">Verificador de Usuarios y Tickets Zendesk</h2>
              <p className="text-xs text-white/60">
                Consulta perfiles reales en Zendesk y actualiza automáticamente los correos y tickets activos.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Task Context Selector Bar if standalone */}
      {!taskId && tasksList && tasksList.length > 0 && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
            <Zap className="w-4 h-4 text-emerald-400" />
            <span>Tarea Activa para Actualización Automática:</span>
          </div>
          <select
            value={selectedTaskId}
            onChange={(e) => setSelectedTaskId(e.target.value)}
            className="bg-slate-900 border border-emerald-500/40 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-400 cursor-pointer font-mono"
          >
            {tasksList.map((t) => (
              <option key={t.id} value={t.id}>
                #{t.id} - {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Search Form Card */}
      <div className="glass-card p-5 rounded-2xl border border-white/10 bg-white/5 space-y-4">
        {/* Search Type Tabs */}
        <div className="grid grid-cols-4 gap-1.5 p-1 bg-black/40 rounded-xl border border-white/10 text-xs font-semibold">
          {[
            { type: "email", label: "Correo", icon: Mail },
            { type: "phone", label: "Teléfono", icon: Phone },
            { type: "name", label: "Nombre", icon: User },
            { type: "query", label: "General", icon: Search },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = searchType === tab.type;
            return (
              <button
                key={tab.type}
                type="button"
                onClick={() => setSearchType(tab.type as any)}
                className={`py-2 px-2 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer text-[11px] ${
                  active
                    ? "bg-emerald-500 text-slate-950 font-bold shadow-md"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Input Form */}
        <form onSubmit={handleSearch} className="space-y-3">
          {searchType === "email" && (
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3.5 top-3 text-white/40 pointer-events-none" />
              <input
                type="email"
                placeholder="Ingresa el correo electrónico exacto en Zendesk..."
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="w-full bg-white/5 border border-white/15 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-emerald-400 font-mono"
              />
            </div>
          )}

          {searchType === "phone" && (
            <div className="relative">
              <Phone className="w-4 h-4 absolute left-3.5 top-3 text-white/40 pointer-events-none" />
              <input
                type="text"
                placeholder="Ingresa el número telefónico (ej. +13215441550 o 3215441550)..."
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                className="w-full bg-white/5 border border-white/15 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-emerald-400 font-mono"
              />
            </div>
          )}

          {searchType === "name" && (
            <div className="relative">
              <User className="w-4 h-4 absolute left-3.5 top-3 text-white/40 pointer-events-none" />
              <input
                type="text"
                placeholder="Ingresa el nombre del cliente (ej. Zitia Castillo)..."
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="w-full bg-white/5 border border-white/15 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-emerald-400"
              />
            </div>
          )}

          {searchType === "query" && (
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-3 text-white/40 pointer-events-none" />
              <input
                type="text"
                placeholder="Búsqueda libre por cualquier término, ID de usuario o ticket..."
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                className="w-full bg-white/5 border border-white/15 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-emerald-400"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Buscando en Zendesk API...
              </>
            ) : (
              <>
                <Search className="w-4 h-4" /> Buscar Usuario en Zendesk
              </>
            )}
          </button>
        </form>
      </div>

      {/* Results Section */}
      {result && (
        <div className="space-y-4 animate-fade-in">
          {/* Unconfigured Credentials Warning */}
          {result.isConfigured === false && (
            <div className="glass-card p-5 rounded-2xl border border-amber-500/40 bg-amber-500/10 text-amber-200 space-y-2">
              <div className="flex items-center gap-3 font-bold text-sm text-amber-300">
                <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
                Credenciales de Zendesk No Configuradas
              </div>
              <p className="text-xs text-amber-200/90 leading-relaxed">
                {result.message || "Para verificar usuarios directamente en tu cuenta de Zendesk, configura tu ZENDESK_EMAIL y ZENDESK_API_TOKEN en los ajustes de Morena OS."}
              </p>
            </div>
          )}

          {/* User FOUND */}
          {result.success && result.exists && result.users && result.users.length > 0 && (
            <div className="space-y-4">
              <div className="p-3 bg-emerald-500/15 border border-emerald-500/40 rounded-xl flex items-center justify-between text-xs font-semibold text-emerald-300">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>{result.message}</span>
                </div>
                <span className="font-mono text-[10px] bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-200">
                  {result.count} coincidencia{result.count && result.count > 1 ? "s" : ""}
                </span>
              </div>

              {/* Loop through found users */}
              {result.users.map((u) => {
                const activeTicket = getActiveTicket(u);
                const feedbackForUser = syncFeedback?.id === String(u.id) ? syncFeedback : null;
                const isUpdatingThisUser = updatingTaskId === String(u.id);

                return (
                  <div key={u.id} className="glass-card p-6 rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/20 via-black/50 to-black/80 space-y-5 shadow-lg relative">
                    
                    {/* Instant Feedback Message */}
                    {feedbackForUser && (
                      <div className={`p-3.5 rounded-xl border text-xs font-bold leading-relaxed flex items-center gap-2.5 ${
                        feedbackForUser.type === "success"
                          ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-200 animate-fade-in"
                          : "bg-rose-500/20 border-rose-500/50 text-rose-200 animate-fade-in"
                      }`}>
                        {feedbackForUser.type === "success" ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                        )}
                        <span>{feedbackForUser.message}</span>
                      </div>
                    )}

                    {/* User Profile Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
                      <div className="flex items-center gap-3.5">
                        <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300 font-bold font-mono text-lg shrink-0">
                          {u.name ? u.name.charAt(0).toUpperCase() : "U"}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-bold text-white font-sans">{u.name}</h3>
                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-white/10 text-white/80 border border-white/20 uppercase font-mono">
                              {u.role || "end-user"}
                            </span>
                          </div>
                          <p className="text-xs text-white/50 font-mono mt-0.5">
                            Zendesk User ID: #{u.id}
                          </p>
                        </div>
                      </div>

                      {/* Primary One-Click Action Button (NO MODALS) */}
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={isUpdatingThisUser}
                          onClick={() => handleAutoUpdateUserAndTicket(u, activeTicket)}
                          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-lg disabled:opacity-50"
                          title="Actualizar la tarea en la app con este correo y el ticket activo"
                        >
                          {isUpdatingThisUser ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin text-slate-950" /> Actualizando...
                            </>
                          ) : (
                            <>
                              <Zap className="w-4 h-4 text-slate-950 fill-slate-950" /> Actualizar Datos de Usuario
                            </>
                          )}
                        </button>

                        <a
                          href={u.zendesk_profile_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3.5 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-emerald-400" /> Profil Zendesk
                        </a>
                      </div>
                    </div>

                    {/* Highlighted Active Zendesk Ticket Banner */}
                    {activeTicket ? (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-white/90 min-w-0">
                          <Ticket className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span className="font-bold text-emerald-300 uppercase tracking-wider text-[10px] shrink-0">Ticket Principal Activo:</span>
                          <span className="font-mono font-bold text-emerald-400 shrink-0">#{activeTicket.id}</span>
                          <span className="text-white/60 truncate">— {activeTicket.subject}</span>
                          {getStatusBadge(activeTicket.status)}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAutoUpdateUserAndTicket(u, activeTicket)}
                          className="px-3 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <Zap className="w-3 h-3 text-emerald-400" /> Usar este Ticket
                        </button>
                      </div>
                    ) : (
                      <div className="p-2.5 bg-white/5 border border-white/10 rounded-xl text-xs text-white/50 flex items-center gap-2">
                        <Ticket className="w-3.5 h-3.5 text-white/30" />
                        <span>Sin tickets activos recientes registrados en Zendesk para este perfil.</span>
                      </div>
                    )}

                    {/* Grid details */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                      <div className="p-3 bg-white/5 border border-white/10 rounded-xl space-y-1">
                        <span className="text-[10px] font-bold text-white/40 uppercase block">Correo Electrónico</span>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-white/90 truncate mr-2">{u.email || "No registrado"}</span>
                          {u.email && (
                            <button
                              type="button"
                              onClick={() => copyToClipboard(u.email || "", `email-${u.id}`)}
                              className="text-white/40 hover:text-white p-1 cursor-pointer"
                              title="Copiar Correo"
                            >
                              {copiedField === `email-${u.id}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="p-3 bg-white/5 border border-white/10 rounded-xl space-y-1">
                        <span className="text-[10px] font-bold text-white/40 uppercase block">Teléfono Registrado</span>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-white/90 truncate mr-2">{u.phone || "No registrado"}</span>
                          {u.phone && (
                            <button
                              type="button"
                              onClick={() => copyToClipboard(u.phone || "", `phone-${u.id}`)}
                              className="text-white/40 hover:text-white p-1 cursor-pointer"
                              title="Copiar Teléfono"
                            >
                              {copiedField === `phone-${u.id}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="p-3 bg-white/5 border border-white/10 rounded-xl space-y-1">
                        <span className="text-[10px] font-bold text-white/40 uppercase block">Estado de la Cuenta</span>
                        <div className="flex items-center gap-2 pt-0.5">
                          {u.active !== false ? (
                            <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded">Activo</span>
                          ) : (
                            <span className="px-2 py-0.5 text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded">Inactivo</span>
                          )}
                          {u.verified && (
                            <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded">Verificado</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Recent Tickets section */}
                    {u.recent_tickets && u.recent_tickets.length > 0 && (
                      <div className="space-y-2.5 pt-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white/60 uppercase tracking-wider flex items-center gap-1.5">
                            <Ticket className="w-3.5 h-3.5 text-emerald-400" /> Todos los Tickets ({u.recent_tickets.length})
                          </span>
                        </div>

                        <div className="space-y-1.5">
                          {u.recent_tickets.map((t) => (
                            <div
                              key={t.id}
                              className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl flex items-center justify-between gap-3 transition-all"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="text-xs font-mono font-bold text-emerald-300">#{t.id}</span>
                                  {getStatusBadge(t.status)}
                                  {t.priority && (
                                    <span className="text-[10px] uppercase font-mono text-white/50">
                                      • {t.priority}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs font-medium text-white truncate">{t.subject}</p>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleAutoUpdateUserAndTicket(u, t)}
                                  className="px-2.5 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-all"
                                  title="Seleccionar este ticket específico como el ticket principal de la tarea"
                                >
                                  <Zap className="w-3 h-3 text-emerald-400" /> Vincular este Ticket
                                </button>

                                <a
                                  href={t.zendesk_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white/90 border border-white/20 rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                                >
                                  Abrir <ExternalLink className="w-3 h-3 text-emerald-400" />
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* User NOT FOUND */}
          {result.success && !result.exists && (
            <div className="glass-card p-6 rounded-2xl border border-rose-500/30 bg-gradient-to-br from-rose-950/20 via-black/50 to-black/80 space-y-4">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0">
                  <XCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-rose-200">Usuario No Registrado en Zendesk</h3>
                  <p className="text-xs text-white/70 mt-1 leading-relaxed">
                    No se encontró ningún usuario que coincida con los criterios de búsqueda especificados en Zendesk.
                  </p>
                </div>
              </div>

              <div className="p-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white/60 space-y-2">
                <p className="font-semibold text-white/80">Recomendaciones para verificar:</p>
                <ul className="list-disc list-inside space-y-1 text-[11px] text-white/60 pl-1">
                  <li>Asegúrate de ingresar el correo exacto asociado al ticket de compra.</li>
                  <li>Prueba buscando únicamente por el número de teléfono (sin código de país o formato especial).</li>
                  <li>Intenta una búsqueda libre por el apellido del cliente.</li>
                </ul>
              </div>
            </div>
          )}

          {/* Error Response */}
          {!result.success && result.error && (
            <div className="p-4 bg-rose-500/15 border border-rose-500/30 rounded-xl text-xs font-semibold text-rose-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{result.error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
