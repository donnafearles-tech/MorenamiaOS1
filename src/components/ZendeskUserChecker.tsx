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
  Clock, 
  ShieldAlert, 
  Sparkles,
  RefreshCw,
  Plus
} from "lucide-react";
import { checkZendeskUser, CheckZendeskUserResponse, ZendeskUserResult } from "../services/zendesk";

interface ZendeskUserCheckerProps {
  initialEmail?: string;
  initialPhone?: string;
  initialName?: string;
  initialQuery?: string;
  isModalMode?: boolean;
  onClose?: () => void;
  onSelectUser?: (user: ZendeskUserResult) => void;
}

export default function ZendeskUserChecker({
  initialEmail = "",
  initialPhone = "",
  initialName = "",
  initialQuery = "",
  isModalMode = false,
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

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoading(true);
    setResult(null);

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
    <div className={`w-full ${isModalMode ? "p-0" : "max-w-5xl mx-auto space-y-6"}`}>
      {/* Header Banner */}
      {!isModalMode && (
        <div className="glass-card p-6 rounded-2xl relative overflow-hidden border border-white/10 bg-gradient-to-r from-emerald-950/40 via-black/60 to-black/80">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                <UserCheck className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                  Verificador de Usuarios Zendesk
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono font-semibold">
                    Zendesk API v2
                  </span>
                </h2>
                <p className="text-xs text-white/60">
                  Comprueba al instante si un cliente o usuario ya existe en tu cuenta de Zendesk por Email, Teléfono o Nombre.
                </p>
              </div>
            </div>

            <button
              onClick={() => handleSearch()}
              disabled={loading}
              className="px-4 py-2 bg-white/10 hover:bg-white/15 border border-white/20 rounded-xl text-xs font-semibold text-white flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-emerald-400" : ""}`} />
              Actualizar Búsqueda
            </button>
          </div>
        </div>
      )}

      {/* Search Card Container */}
      <div className="glass-card p-6 rounded-2xl border border-white/15 space-y-5 bg-black/40 backdrop-blur-md">
        {/* Search Type Selector Tabs */}
        <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-white/10">
          <span className="text-xs font-bold text-white/50 uppercase tracking-wider mr-2">Buscar por:</span>
          
          <button
            onClick={() => setSearchType("email")}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              searchType === "email"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                : "bg-white/5 text-white/60 hover:text-white hover:bg-white/10 border border-white/10"
            }`}
          >
            <Mail className="w-3.5 h-3.5" /> Correo Electrónico
          </button>

          <button
            onClick={() => setSearchType("phone")}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              searchType === "phone"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                : "bg-white/5 text-white/60 hover:text-white hover:bg-white/10 border border-white/10"
            }`}
          >
            <Phone className="w-3.5 h-3.5" /> Teléfono
          </button>

          <button
            onClick={() => setSearchType("name")}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              searchType === "name"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                : "bg-white/5 text-white/60 hover:text-white hover:bg-white/10 border border-white/10"
            }`}
          >
            <User className="w-3.5 h-3.5" /> Nombre del Cliente
          </button>

          <button
            onClick={() => setSearchType("query")}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              searchType === "query"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                : "bg-white/5 text-white/60 hover:text-white hover:bg-white/10 border border-white/10"
            }`}
          >
            <Search className="w-3.5 h-3.5" /> Búsqueda Libre
          </button>
        </div>

        {/* Input Form */}
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row items-stretch gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-white/40">
              {searchType === "email" && <Mail className="w-4 h-4" />}
              {searchType === "phone" && <Phone className="w-4 h-4" />}
              {searchType === "name" && <User className="w-4 h-4" />}
              {searchType === "query" && <Search className="w-4 h-4" />}
            </div>

            {searchType === "email" && (
              <input
                type="email"
                placeholder="Ej. cliente@ejemplo.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="w-full bg-white/5 border border-white/15 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-white/35 focus:outline-none focus:border-emerald-400 focus:bg-white/10 transition-all font-sans"
              />
            )}

            {searchType === "phone" && (
              <input
                type="text"
                placeholder="Ej. +1 780 218 3600 o 3215441550"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                className="w-full bg-white/5 border border-white/15 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-white/35 focus:outline-none focus:border-emerald-400 focus:bg-white/10 transition-all font-mono"
              />
            )}

            {searchType === "name" && (
              <input
                type="text"
                placeholder="Ej. ZITIA CASTILLO o REBECCA COLBERT"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="w-full bg-white/5 border border-white/15 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-white/35 focus:outline-none focus:border-emerald-400 focus:bg-white/10 transition-all font-sans"
              />
            )}

            {searchType === "query" && (
              <input
                type="text"
                placeholder="Ingresa email, teléfono, ID de usuario o nombre..."
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                className="w-full bg-white/5 border border-white/15 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-white/35 focus:outline-none focus:border-emerald-400 focus:bg-white/10 transition-all font-sans"
              />
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs uppercase tracking-wider rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shrink-0"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Verificando...
              </>
            ) : (
              <>
                <Search className="w-4 h-4" /> Verificar en Zendesk
              </>
            )}
          </button>
        </form>

        {/* Quick Sample Queries */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/50 pt-1">
          <span className="font-semibold text-white/40">Sugerencias rápidas:</span>
          <button
            type="button"
            onClick={() => { setSearchType("name"); setNameInput("ZITIA CASTILLO"); }}
            className="hover:text-emerald-300 underline cursor-pointer"
          >
            ZITIA CASTILLO
          </button>
          <span>•</span>
          <button
            type="button"
            onClick={() => { setSearchType("name"); setNameInput("REBECCA COLBERT"); }}
            className="hover:text-emerald-300 underline cursor-pointer"
          >
            REBECCA COLBERT
          </button>
          <span>•</span>
          <button
            type="button"
            onClick={() => { setSearchType("phone"); setPhoneInput("13215441550"); }}
            className="hover:text-emerald-300 underline cursor-pointer font-mono"
          >
            +1 (321) 544-1550
          </button>
        </div>
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
              {result.users.map((u) => (
                <div key={u.id} className="glass-card p-6 rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/20 via-black/50 to-black/80 space-y-5 shadow-lg">
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

                    <div className="flex items-center gap-2 shrink-0">
                      {onSelectUser && (
                        <button
                          onClick={() => onSelectUser(u)}
                          className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" /> Usar este Usuario
                        </button>
                      )}

                      <a
                        href={u.zendesk_profile_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3.5 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-emerald-400" /> Perfil Agent Zendesk
                      </a>
                    </div>
                  </div>

                  {/* Grid details */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                    <div className="p-3 bg-white/5 border border-white/10 rounded-xl space-y-1">
                      <span className="text-[10px] font-bold text-white/40 uppercase block">Correo Electrónico</span>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-white/90 truncate mr-2">{u.email || "No registrado"}</span>
                        {u.email && (
                          <button
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

                  {/* Recent Tickets section if available */}
                  {u.recent_tickets && u.recent_tickets.length > 0 && (
                    <div className="space-y-2.5 pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white/60 uppercase tracking-wider flex items-center gap-1.5">
                          <Ticket className="w-3.5 h-3.5 text-emerald-400" /> Tickets de Soporte Recientes ({u.recent_tickets.length})
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

                            <a
                              href={t.zendesk_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white/90 border border-white/20 rounded-lg text-[11px] font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                            >
                              Abrir <ExternalLink className="w-3 h-3 text-emerald-400" />
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
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
