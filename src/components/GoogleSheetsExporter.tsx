import React, { useState, useEffect } from "react";
import { 
  FileSpreadsheet, 
  Play, 
  CheckCircle2, 
  AlertTriangle, 
  Loader2, 
  Sparkles, 
  ExternalLink,
  Table,
  RefreshCw,
  Calendar,
  Layers,
  Database,
  Settings,
  Clock,
  Power,
  Zap
} from "lucide-react";

export default function GoogleSheetsExporter() {
  const [spreadsheetId, setSpreadsheetId] = useState("1RvYVVhdfU37FeCkgBdhfQ7xdBLDtET5XupBY_ivilDI");
  const [sheetName, setSheetName] = useState("13 de agosto");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [onlyMyTasks, setOnlyMyTasks] = useState(true);
  const [assigneeId, setAssigneeId] = useState("101113624");
  const [isExporting, setIsExporting] = useState(false);
  const [progressStatus, setProgressStatus] = useState<string>("");
  const [result, setResult] = useState<any>(null);
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(null);
  const [statusInfo, setStatusInfo] = useState<any>(null);

  // Cron schedule state
  const [cronConfig, setCronConfig] = useState<any>({
    enabled: false,
    intervalHours: 3,
    lastRunTime: null,
    lastRunStatus: null,
    lastRunDetails: null
  });
  const [cronLoading, setCronLoading] = useState(false);
  const [cronMessage, setCronMessage] = useState<string>("");

  useEffect(() => {
    fetchStatus();
    fetchCronStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/keys/status");
      if (res.ok) {
        const data = await res.json();
        setStatusInfo(data);
      }
    } catch (err) {
      console.error("Error al cargar estado de claves:", err);
    }
  };

  const fetchCronStatus = async () => {
    try {
      const res = await fetch("/api/cron/sheets-status");
      if (res.ok) {
        const data = await res.json();
        if (data.cronConfig) {
          setCronConfig(data.cronConfig);
        }
      }
    } catch (err) {
      console.error("Error al cargar estado de Cron:", err);
    }
  };

  const handleSaveCronConfig = async (newEnabled?: boolean, newInterval?: number) => {
    setCronLoading(true);
    setCronMessage("");
    try {
      const enabledVal = typeof newEnabled === "boolean" ? newEnabled : cronConfig.enabled;
      const intervalVal = newInterval || cronConfig.intervalHours || 3;

      const res = await fetch("/api/cron/sheets-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: enabledVal,
          intervalHours: intervalVal,
          spreadsheetId: spreadsheetId.trim(),
          sheetName: sheetName.trim() || "13 de agosto",
          includeClosed,
          onlyMyTasks,
          assigneeId: assigneeId.trim()
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setCronConfig(data.cronConfig);
        setCronMessage(data.message || "Configuración de Cron guardada.");
      } else {
        setCronMessage(`Error: ${data.error || "No se pudo actualizar Cron"}`);
      }
    } catch (err: any) {
      setCronMessage(`Error de red: ${err.message}`);
    } finally {
      setCronLoading(false);
    }
  };

  const handleTriggerCronNow = async () => {
    setCronLoading(true);
    setCronMessage("Ejecutando exportación automática en segundo plano...");
    try {
      const res = await fetch("/api/cron/sheets-trigger", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        setCronMessage("✅ Exportación en segundo plano completada con éxito!");
        fetchCronStatus();
      } else {
        setCronMessage(`❌ Error en ejecución inmediata: ${data.error || "Desconocido"}`);
      }
    } catch (err: any) {
      setCronMessage(`Error de red: ${err.message}`);
    } finally {
      setCronLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    if (typeof window !== "undefined" && (window as any).google?.accounts?.oauth2) {
      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: "667055597222-applet.apps.googleusercontent.com", // OAuth Client ID
        scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file",
        callback: (response: any) => {
          if (response.access_token) {
            setGoogleAccessToken(response.access_token);
          }
        },
      });
      client.requestAccessToken();
    } else {
      alert("El SDK de Google Identity Services se está cargando. Por favor, intenta de nuevo en un momento.");
    }
  };

  const handleStartExport = async () => {
    setIsExporting(true);
    setResult(null);
    setProgressStatus("Iniciando conexión con ClickUp...");

    try {
      const res = await fetch("/api/export-clickup-sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheetId: spreadsheetId.trim(),
          sheetName: sheetName.trim() || "13 de agosto",
          includeClosed,
          onlyMyTasks,
          assigneeId: assigneeId.trim(),
          googleAccessToken
        }),
      });

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json();
        if (res.ok && data.success) {
          setResult(data);
          setProgressStatus("Exportación completada con éxito");
        } else {
          setResult({
            success: false,
            error: data.error || "Ocurrió un error inesperado al exportar.",
            helpTip: data.helpTip || "Puedes intentar usar el botón 'Ejecutar Ahora' en el panel de Exportación Programada (Cron) abajo."
          });
        }
      } else {
        const rawText = await res.text();
        setResult({
          success: false,
          error: "Tiempo de espera agotado o respuesta HTML del servidor al procesar el volumen de tareas.",
          helpTip: "Debido a la gran cantidad de comentarios e hilos que se procesan con Vertex AI, te recomendamos hacer clic en 'Ejecutar Ahora' en la sección 'Exportación Programada Automática (Cron)' más abajo. Esa opción se ejecuta en segundo plano en la nube sin estar sujeta al tiempo límite del navegador."
        });
      }
    } catch (err: any) {
      setResult({
        success: false,
        error: err.message || "Error de red al intentar conectar con el servidor.",
        helpTip: "Si el navegador interrumpió la conexión por tiempo, utiliza la opción 'Ejecutar Ahora' del Cron en segundo plano."
      });
    } finally {
      setIsExporting(false);
    }
  };

  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId.trim()}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-card p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="p-3.5 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-300">
            <FileSpreadsheet className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-2xl font-bold font-serif tracking-tight text-white flex items-center gap-2">
              Exportador Vertex AI a Google Sheets
              <span className="px-2.5 py-0.5 text-xs font-mono rounded-full bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">
                Paginado Automático
              </span>
            </h2>
            <p className="text-xs text-white/70 font-sans mt-0.5">
              Descarga sin límite todas las páginas de tareas y comentarios de ClickUp, procesadas por Vertex AI en la hoja configurada.
            </p>
          </div>
        </div>

        <a
          href={spreadsheetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium text-xs border border-white/20 transition-all shrink-0 cursor-pointer"
        >
          <ExternalLink className="w-4 h-4 text-emerald-400" />
          <span>Abrir Google Sheet</span>
        </a>
      </div>

      {/* Main Settings Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Left Card: Configuration */}
        <div className="glass-card p-6 space-y-5">
          <h3 className="text-lg font-bold font-serif text-white flex items-center gap-2 border-b border-white/10 pb-3">
            <Settings className="w-5 h-5 text-indigo-400" />
            <span>Configuración del Destino</span>
          </h3>

          {/* Spreadsheet ID Input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-white/80 font-mono">
              ID del Libro de Google Sheets:
            </label>
            <input
              type="text"
              value={spreadsheetId}
              onChange={(e) => setSpreadsheetId(e.target.value)}
              placeholder="1RvYVVhdfU37FeCkgBdhfQ7xdBLDtET5XupBY_ivilDI"
              className="w-full bg-black/30 border border-white/15 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500/50"
            />
            <p className="text-[10px] text-white/40">
              Libro Excel / Sheet activo: <span className="font-mono text-white/70">{spreadsheetId}</span>
            </p>
          </div>

          {/* Sheet/Tab Name Input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-white/80 font-mono flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-amber-400" />
              <span>Nombre de la Hoja / Pestaña:</span>
            </label>
            <input
              type="text"
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
              placeholder="13 de agosto"
              className="w-full bg-black/30 border border-white/15 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500/50"
            />
            <p className="text-[10px] text-white/40">
              Se creará automáticamente la pestaña <span className="text-emerald-300 font-bold">"{sheetName}"</span> si no existe en el libro.
            </p>
          </div>

          {/* Only My Tasks Filter */}
          <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <span className="block text-xs font-bold text-white flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
                  Filtrar Solo Mis Tareas
                </span>
                <span className="block text-[10px] text-white/60">
                  Exporta exclusivamente tareas asignadas a tu ID de ClickUp.
                </span>
              </div>
              <input
                type="checkbox"
                checked={onlyMyTasks}
                onChange={(e) => setOnlyMyTasks(e.target.checked)}
                className="w-5 h-5 accent-indigo-500 cursor-pointer rounded"
              />
            </div>

            {onlyMyTasks && (
              <div className="pt-2 border-t border-white/10 flex items-center space-x-2">
                <span className="text-[10px] font-mono text-white/50 shrink-0">ID Asignado:</span>
                <input
                  type="text"
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  placeholder="101113624"
                  className="w-full bg-black/40 border border-white/15 rounded-lg px-2.5 py-1 text-xs text-indigo-200 font-mono focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Include Closed Toggle */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-white/5 border border-white/10">
            <div>
              <span className="block text-xs font-semibold text-white">Incluir Tareas Cerradas / Resueltas</span>
              <span className="block text-[10px] text-white/50">
                {includeClosed 
                  ? "Exportando todas las tareas (activas y cerradas históricos)." 
                  : "Filtrado activo: Exportando únicamente TAREAS ACTIVAS pendientes."}
              </span>
            </div>
            <input
              type="checkbox"
              checked={includeClosed}
              onChange={(e) => setIncludeClosed(e.target.checked)}
              className="w-5 h-5 accent-indigo-500 cursor-pointer rounded"
            />
          </div>

          {/* Google Auth Status */}
          <div className="p-3.5 rounded-xl bg-black/20 border border-white/10 flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <Database className="w-4 h-4 text-indigo-400" />
              <span>
                {googleAccessToken
                  ? "OAuth de Google Activo (Sesión de Usuario)"
                  : statusInfo?.vertex?.hasServiceAccountJson
                  ? "Usando Service Account en Secrets (Automático)"
                  : "Autenticación Predeterminada de Google"}
              </span>
            </div>
            {!googleAccessToken && (
              <button
                onClick={handleGoogleLogin}
                className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 text-[10px] font-mono transition-all cursor-pointer"
              >
                Autorizar Google
              </button>
            )}
          </div>
        </div>

        {/* Right Card: Processing Engine Summary & Trigger */}
        <div className="glass-card p-6 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <h3 className="text-lg font-bold font-serif text-white flex items-center gap-2 border-b border-white/10 pb-3">
              <Sparkles className="w-5 h-5 text-emerald-400" />
              <span>Procesamiento con Vertex AI</span>
            </h3>

            <div className="space-y-3 text-xs text-white/80">
              <div className="flex items-start space-x-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Paginación Completa:</strong> Recorre recursivamente todas las páginas de tareas de ClickUp (`subtasks=true`, `page=0, 1, 2...`).
                </span>
              </div>

              <div className="flex items-start space-x-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Lector de Comentarios:</strong> Descarga la conversación histórica completa de cada tarea.
                </span>
              </div>

              <div className="flex items-start space-x-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Síntesis Inteligente:</strong> Vertex AI (`gemini-2.5-flash`) analiza los comentarios y escribe resúmenes ejecutivos para cada fila.
                </span>
              </div>

              <div className="flex items-start space-x-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Estructura Limpia:</strong> Mantiene columnas con ID, Tarea, Estado, Asignados, Fechas, Resumen Vertex AI y Enlace ClickUp.
                </span>
              </div>
            </div>
          </div>

          {/* Trigger Action Button */}
          <div className="space-y-3 pt-4 border-t border-white/10">
            {isExporting && (
              <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center space-x-3">
                <Loader2 className="w-5 h-5 text-indigo-400 animate-spin shrink-0" />
                <span className="text-xs text-indigo-200 font-mono animate-pulse">
                  {progressStatus}
                </span>
              </div>
            )}

            <button
              onClick={handleStartExport}
              disabled={isExporting}
              className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-emerald-600 via-indigo-600 to-purple-600 hover:from-emerald-500 hover:to-purple-500 text-white font-bold text-sm shadow-xl transition-all disabled:opacity-50 flex items-center justify-center space-x-2.5 cursor-pointer"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Procesando y Exportando...</span>
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 fill-current" />
                  <span>Iniciar Exportación a Google Sheets ("{sheetName}")</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Cron Scheduler Section */}
      <div className="glass-card p-6 space-y-5 border border-purple-500/30 bg-purple-950/10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div className="flex items-center space-x-3">
            <div className={`p-3 rounded-xl border ${cronConfig.enabled ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30' : 'bg-gray-500/20 text-gray-400 border-gray-400/30'}`}>
              <Clock className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h3 className="text-lg font-bold font-serif text-white flex items-center gap-2">
                Exportación Programada Automática (Cron)
                <span className={`px-2.5 py-0.5 text-xs font-mono rounded-full border ${cronConfig.enabled ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30' : 'bg-white/10 text-white/50 border-white/10'}`}>
                  {cronConfig.enabled ? '🟢 ACTIVADO' : '⚪ DESACTIVADO'}
                </span>
              </h3>
              <p className="text-xs text-white/70 font-sans mt-0.5">
                Ejecuta automáticamente la exportación ClickUp + Vertex AI a Google Sheets en segundo plano cada intervalo configurado.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={() => handleSaveCronConfig(!cronConfig.enabled)}
              disabled={cronLoading}
              className={`px-4 py-2 rounded-xl text-xs font-bold font-mono transition-all flex items-center space-x-2 border cursor-pointer ${
                cronConfig.enabled
                  ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border-amber-400/30'
                  : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border-emerald-400/30'
              }`}
            >
              <Power className="w-4 h-4" />
              <span>{cronConfig.enabled ? 'Desactivar Cron' : 'Activar Cron Programado'}</span>
            </button>

            <button
              onClick={handleTriggerCronNow}
              disabled={cronLoading}
              className="px-3.5 py-2 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-400/30 text-xs font-bold font-mono transition-all flex items-center space-x-1.5 shrink-0 cursor-pointer"
              title="Ejecutar exportación en segundo plano inmediatamente"
            >
              <Zap className="w-4 h-4 text-amber-400" />
              <span>Ejecutar Ahora</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          {/* Interval Selector */}
          <div className="p-3.5 rounded-xl bg-black/30 border border-white/10 space-y-1.5">
            <label className="block text-xs font-mono font-bold text-white/80">Intervalo de Frecuencia:</label>
            <select
              value={cronConfig.intervalHours || 3}
              onChange={(e) => handleSaveCronConfig(cronConfig.enabled, Number(e.target.value))}
              disabled={cronLoading}
              className="w-full bg-black/50 border border-white/20 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-400"
            >
              <option value={1}>Cada 1 hora (`0 * * * *`)</option>
              <option value={2}>Cada 2 horas (`0 */2 * * *`)</option>
              <option value={3}>Cada 3 horas (`0 */3 * * *`) (Recomendado)</option>
              <option value={6}>Cada 6 horas (`0 */6 * * *`)</option>
              <option value={12}>Cada 12 horas (`0 */12 * * *`)</option>
              <option value={24}>Cada 24 horas (Diario a las 8 AM)</option>
            </select>
          </div>

          {/* Last Run Info */}
          <div className="p-3.5 rounded-xl bg-black/30 border border-white/10 space-y-1">
            <span className="block text-[10px] uppercase font-mono text-white/50">Última Ejecución:</span>
            <span className="block font-mono text-white font-semibold">
              {cronConfig.lastRunTime ? new Date(cronConfig.lastRunTime).toLocaleString("es-MX") : "Nunca"}
            </span>
            <div className="flex items-center space-x-1.5 pt-1">
              <span className="text-[10px] text-white/50">Estado:</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                cronConfig.lastRunStatus === "success" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" :
                cronConfig.lastRunStatus === "error" ? "bg-red-500/20 text-red-300 border border-red-500/30" :
                cronConfig.lastRunStatus === "running" ? "bg-amber-500/20 text-amber-300 animate-pulse border border-amber-500/30" :
                "bg-white/10 text-white/50"
              }`}>
                {cronConfig.lastRunStatus || "Pendiente"}
              </span>
            </div>
          </div>

          {/* Details */}
          <div className="p-3.5 rounded-xl bg-black/30 border border-white/10 space-y-1">
            <span className="block text-[10px] uppercase font-mono text-white/50">Destino Configurado:</span>
            <span className="block font-mono text-xs text-purple-200 truncate">
              Hoja: "{cronConfig.sheetName || sheetName}"
            </span>
            <p className="text-[10px] text-white/40 truncate">
              ID: {cronConfig.spreadsheetId || spreadsheetId}
            </p>
          </div>
        </div>

        {cronMessage && (
          <div className="p-3 rounded-xl bg-purple-500/20 border border-purple-400/30 text-xs font-mono text-purple-200 flex items-center justify-between">
            <span>{cronMessage}</span>
            <button onClick={() => setCronMessage("")} className="text-white/50 hover:text-white cursor-pointer">✕</button>
          </div>
        )}
      </div>

      {/* Results Output Section */}
      {result && (
        <div
          className={`glass-card p-6 border transition-all ${
            result.success
              ? "bg-emerald-950/20 border-emerald-500/40"
              : "bg-red-950/20 border-red-500/40"
          }`}
        >
          <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-3">
            <div className="flex items-center space-x-3">
              {result.success ? (
                <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-400/30">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
              ) : (
                <div className="p-2 rounded-xl bg-red-500/20 text-red-400 border border-red-400/30">
                  <AlertTriangle className="w-6 h-6" />
                </div>
              )}
              <div>
                <h4 className="text-base font-bold font-serif text-white">
                  {result.success ? "Exportación Completada Exitosamente" : "Error en la Exportación"}
                </h4>
                <p className="text-xs text-white/60 font-mono">
                  Hoja: "{result.sheetName || sheetName}" • Libro ID: {spreadsheetId}
                </p>
              </div>
            </div>

            {result.success && (
              <a
                href={spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-medium text-xs border border-emerald-400/30 transition-all cursor-pointer"
              >
                <Table className="w-4 h-4" />
                <span>Ver Datos en Google Sheets</span>
              </a>
            )}
          </div>

          {result.success ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                <span className="block text-[10px] text-white/40 uppercase font-mono">Tareas Procesadas</span>
                <span className="text-lg font-bold font-mono text-emerald-400">{result.tasksCount}</span>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                <span className="block text-[10px] text-white/40 uppercase font-mono">Páginas ClickUp</span>
                <span className="text-lg font-bold font-mono text-white">{result.pagesCount}</span>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                <span className="block text-[10px] text-white/40 uppercase font-mono">Resúmenes Vertex AI</span>
                <span className="text-lg font-bold font-mono text-indigo-300">{result.summariesCount}</span>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                <span className="block text-[10px] text-white/40 uppercase font-mono">Filas Escriptas</span>
                <span className="text-lg font-bold font-mono text-purple-300">{result.rowsCount}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3.5 rounded-xl bg-black/40 border border-red-500/30 text-xs font-mono text-red-300">
                {result.error}
              </div>
              {result.helpTip && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
                  <strong>💡 Ayuda:</strong> {result.helpTip}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
