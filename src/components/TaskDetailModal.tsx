import React, { useState, useEffect, useRef } from "react";
import { Task, ChatMessage } from "../types";
import { getTimezoneByPhone } from "../data/areaCodes";
import { 
  X, 
  MapPin, 
  Clock, 
  Check, 
  Calendar, 
  Send, 
  Sparkles, 
  AlertTriangle,
  Lock,
  Pause,
  ExternalLink,
  Loader2,
  Copy,
  Plus,
  Phone,
  PhoneOff,
  Save,
  User,
  UserCheck,
  Bot,
  ArrowRight
} from "lucide-react";
import ZendeskUserChecker from "./ZendeskUserChecker";
import RileyToast from "./RileyToast";
import { evaluateRileyResolution, RileyEvaluationResult } from "../services/rileyAgent";

interface TaskDetailModalProps {
  taskId: string;
  onClose: () => void;
  onActionComplete: (silent?: boolean) => void;
  onTaskUpdated?: (taskId: string, fields: Partial<Task>) => void;
  showToast?: (message: string, type: "success" | "error" | "info") => void;
}

export default function TaskDetailModal({ taskId, onClose, onActionComplete, onTaskUpdated, showToast }: TaskDetailModalProps) {
  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<"actions" | "zendesk_user" | "chat" | "cloning">("actions");

  const [currentTaskId, setCurrentTaskId] = useState(taskId);

  useEffect(() => {
    setCurrentTaskId(taskId);
  }, [taskId]);

  // State for actions
  const [newTimezone, setNewTimezone] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [zendeskTicketId, setZendeskTicketId] = useState("");
  const [spanishComment, setSpanishComment] = useState("");
  const [bankDays, setBankDays] = useState("4");
  const [submittingAction, setSubmittingAction] = useState(false);
  const [ticketNumber, setTicketNumber] = useState("");

  // State for Call Scheduling (LOG NUEVO feature)
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleRefMode, setScheduleRefMode] = useState<"agent" | "client">("agent");
  const [schedulingCall, setSchedulingCall] = useState(false);
  const [scheduleSuccess, setScheduleSuccess] = useState(false);

  // State for Closure
  const [resolutionId, setResolutionId] = useState("550d1479-412d-45f9-b7da-64cd69473af1"); // Default RESOLVED
  const [closureComment, setClosureComment] = useState("");

  // State for Riley Agent Evaluation
  const [rileyEvaluation, setRileyEvaluation] = useState<RileyEvaluationResult | null>(null);
  const [showRileyToast, setShowRileyToast] = useState(false);

  // Evaluate Riley Rules whenever resolution, closureComment or spanishComment changes
  useEffect(() => {
    if (!task) return;

    const currentComments = [
      closureComment,
      spanishComment,
      ...(task.comments || []).map((c: any) => typeof c === "string" ? c : c.text || c.comment_text || "")
    ].filter(Boolean);

    const evalResult = evaluateRileyResolution({
      resolution: resolutionId,
      reason: task.reason || task.category || "",
      comments: currentComments,
      taskName: task.name || ""
    });

    setRileyEvaluation(evalResult);
    if (evalResult.status === "CHECK") {
      setShowRileyToast(true);
    } else {
      setShowRileyToast(false);
    }
  }, [resolutionId, task, closureComment, spanishComment]);

  const handleApplySuggestedResolution = async (suggested: string) => {
    let targetId = "";
    let targetName = suggested;

    const match = resolutions.find(r => r.name.toUpperCase().includes(suggested.toUpperCase()));
    if (match) {
      targetId = match.id;
      targetName = match.name;
    } else {
      const idMap: Record<string, string> = {
        "LOST LEAD": "49bb94ed-70b8-4d8f-80ae-8b4f8ab9b04e",
        "DISPUTE": "a148c4e2-b2f3-4b6d-9cf6-6eb8255c6099",
        "REFUND": "e9367f41-cb3b-42f0-b612-6528d02098dc",
        "GIFT": "94dad466-99f5-4f62-b6a1-f7d0a567ffae",
        "RESOLVED": "550d1479-412d-45f9-b7da-64cd69473af1"
      };
      if (idMap[suggested]) {
        targetId = idMap[suggested];
      }
    }

    if (targetId) {
      setResolutionId(targetId);
      showToast?.(`🔄 Cambiando resolución a ${targetName} en ClickUp...`, "info");

      if (taskId) {
        try {
          const res = await fetch("/api/update-resolution", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task_id: taskId, resolution_id: targetId })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            showToast?.(`✅ Resolución cambiada a ${targetName} en ClickUp exitosamente.`, "success");
          } else {
            showToast?.(`⚠️ Cambiada localmente. Error ClickUp: ${data.error || 'Error desconocido'}`, "info");
          }
        } catch (err: any) {
          showToast?.(`⚠️ Cambiada localmente. Error de conexión: ${err.message}`, "info");
        }
      }
    }
  };

  // State for Cloning
  const [cloneMethod, setCloneMethod] = useState("CHECK");
  const [cloneType, setCloneType] = useState("FULL REFUND");

  // Chat State
  const [chatQuery, setChatQuery] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { sender: "donna", text: "¡Hola! Soy Donna. Pregúntame sobre este caso, políticas de devolución o qué pasos seguir.", timestamp: new Date() }
  ]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Live clock state for client and agent local time
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const tzOficialesMap: Record<string, string> = {
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

  const getClientLiveTime = (tzTag?: string) => {
    const zone = tzOficialesMap[tzTag || "EST"] || "America/New_York";
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
      }).format(now);
    } catch {
      return "--:--";
    }
  };

  const getAgentLiveTime = () => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
      }).format(now);
    } catch {
      return "--:--";
    }
  };

  const effectiveTz = newTimezone || (clientPhone ? getTimezoneByPhone(clientPhone) : null) || task?.timezone || "EST";
  const clientLiveTime = getClientLiveTime(effectiveTz);
  const agentLiveTime = getAgentLiveTime();

  // Helper function to get exact timestamp for a given date/time in a specific IANA timezone
  const getTimestampFromZone = (dateStr: string, timeStr: string, ianaZone: string): number => {
    if (!dateStr || !timeStr) return Date.now();
    const naiveUtc = new Date(`${dateStr}T${timeStr}:00Z`);
    if (isNaN(naiveUtc.getTime())) return Date.now();

    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: ianaZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
      });
      
      const parts = formatter.formatToParts(naiveUtc);
      const map: Record<string, string> = {};
      parts.forEach(p => map[p.type] = p.value);
      
      const y = map.year;
      const m = map.month;
      const d = map.day;
      const h = map.hour === '24' ? '00' : map.hour;
      const min = map.minute;
      const s = map.second;
      
      const formattedUtc = new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`).getTime();
      const offsetMs = formattedUtc - naiveUtc.getTime();
      return naiveUtc.getTime() - offsetMs;
    } catch {
      return new Date(`${dateStr}T${timeStr}`).getTime();
    }
  };

  const formatTimestampInZone = (ts: number, ianaZone?: string) => {
    try {
      const d = new Date(ts);
      return new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: ianaZone,
        timeZoneName: "short"
      }).format(d);
    } catch {
      return "--:--";
    }
  };

  // Scheduled call timestamp preview calculations
  const clientIanaZone = tzOficialesMap[effectiveTz] || "America/New_York";
  const agentBrowserIanaZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  let computedScheduledTimestamp = Date.now();
  if (scheduleDate && scheduleTime) {
    if (scheduleRefMode === "client") {
      computedScheduledTimestamp = getTimestampFromZone(scheduleDate, scheduleTime, clientIanaZone);
    } else {
      const localDate = new Date(`${scheduleDate}T${scheduleTime}`);
      computedScheduledTimestamp = isNaN(localDate.getTime()) ? Date.now() : localDate.getTime();
    }
  }

  const previewAgentTimeStr = formatTimestampInZone(computedScheduledTimestamp, agentBrowserIanaZone);
  const previewClientTimeStr = formatTimestampInZone(computedScheduledTimestamp, clientIanaZone);

  const timezones = ["NST", "AST", "EST", "CST", "MST", "PHX", "PST", "AKST", "HST"];

  const areaCodeToTimezone: Record<string, string> = {
    // EST (Eastern Standard Time)
    "201": "EST", "202": "EST", "203": "EST", "207": "EST", "212": "EST", "215": "EST", "216": "EST", 
    "226": "EST", "229": "EST", "231": "EST", "239": "EST", "240": "EST", "248": "EST", "249": "EST", 
    "252": "EST", "260": "EST", "267": "EST", "269": "EST", "270": "EST", "276": "EST", "289": "EST", 
    "301": "EST", "302": "EST", "304": "EST", "305": "EST", "313": "EST", "315": "EST", "317": "EST", 
    "321": "EST", "330": "EST", "332": "EST", "336": "EST", "343": "EST", "347": "EST", "352": "EST", 
    "365": "EST", "386": "EST", "401": "EST", "404": "EST", "407": "EST", "410": "EST", "412": "EST", 
    "413": "EST", "416": "EST", "418": "EST", "419": "EST", "434": "EST", "438": "EST", "440": "EST", 
    "443": "EST", "450": "EST", "470": "EST", "475": "EST", "478": "EST", "484": "EST", "502": "EST", 
    "508": "EST", "513": "EST", "514": "EST", "516": "EST", "517": "EST", "518": "EST", "519": "EST", 
    "540": "EST", "551": "EST", "561": "EST", "571": "EST", "574": "EST", "579": "EST", "581": "EST", 
    "586": "EST", "603": "EST", "606": "EST", "607": "EST", "609": "EST", "610": "EST", "613": "EST", 
    "614": "EST", "616": "EST", "617": "EST", "631": "EST", "646": "EST", "647": "EST", "678": "EST", 
    "680": "EST", "681": "EST", "703": "EST", "704": "EST", "705": "EST", "706": "EST", "716": "EST", 
    "717": "EST", "718": "EST", "724": "EST", "727": "EST", "732": "EST", "734": "EST", "740": "EST", 
    "754": "EST", "757": "EST", "762": "EST", "765": "EST", "770": "EST", "772": "EST", "774": "EST", 
    "781": "EST", "802": "EST", "803": "EST", "804": "EST", "807": "EST", "810": "EST", "812": "EST", 
    "813": "EST", "814": "EST", "819": "EST", "828": "EST", "838": "EST", "843": "EST", "845": "EST", 
    "848": "EST", "850": "EST", "856": "EST", "857": "EST", "859": "EST", "860": "EST", "862": "EST", 
    "863": "EST", "864": "EST", "873": "EST", "878": "EST", "904": "EST", "905": "EST", "906": "EST", 
    "908": "EST", "910": "EST", "912": "EST", "914": "EST", "917": "EST", "919": "EST", "929": "EST", 
    "937": "EST", "941": "EST", "954": "EST", "973": "EST", "978": "EST", "980": "EST", "984": "EST", 
    "989": "EST",

    // CST (Central Standard Time)
    "204": "CST", "205": "CST", "210": "CST", "214": "CST", "217": "CST", "218": "CST", "224": "CST", 
    "225": "CST", "228": "CST", "251": "CST", "254": "CST", "256": "CST", "262": "CST", "281": "CST", 
    "306": "CST", "308": "CST", "309": "CST", "312": "CST", "314": "CST", "316": "CST", "318": "CST", 
    "319": "CST", "320": "CST", "325": "CST", "331": "CST", "334": "CST", "337": "CST", "361": "CST", 
    "402": "CST", "405": "CST", "409": "CST", "414": "CST", "417": "CST", "432": "CST", "463": "CST", 
    "464": "CST", "469": "CST", "479": "CST", "501": "CST", "504": "CST", "507": "CST", "512": "CST", 
    "515": "CST", "563": "CST", "573": "CST", "580": "CST", "601": "CST", "605": "CST", "608": "CST", 
    "612": "CST", "615": "CST", "618": "CST", "630": "CST", "636": "CST", "641": "CST", "651": "CST", 
    "660": "CST", "662": "CST", "701": "CST", "708": "CST", "712": "CST", "713": "CST", "715": "CST", 
    "731": "CST", "737": "CST", "763": "CST", "773": "CST", "785": "CST", "806": "CST", "815": "CST", 
    "816": "CST", "817": "CST", "830": "CST", "832": "CST", "847": "CST", "870": "CST", "872": "CST", 
    "901": "CST", "903": "CST", "913": "CST", "918": "CST", "920": "CST", "936": "CST", 
    "940": "CST", "952": "CST", "956": "CST", "972": "CST", "979": "CST",

    // MST (Mountain Standard Time)
    "208": "MST", "303": "MST", "307": "MST", "385": "MST", "403": "MST", "406": "MST", "435": "MST", 
    "505": "MST", "575": "MST", "587": "MST", "719": "MST", "720": "MST", "780": "MST", "801": "MST", 
    "825": "MST", "970": "MST",

    // PHX (Phoenix / Arizona - Mountain Time No-DST)
    "480": "PHX", "520": "PHX", "602": "PHX", "623": "PHX", "928": "PHX",

    // PST (Pacific Standard Time)
    "206": "PST", "209": "PST", "213": "PST", "250": "PST", "253": "PST", "310": "PST", "323": "PST", 
    "360": "PST", "408": "PST", "415": "PST", "424": "PST", "425": "PST", "503": "PST", "509": "PST", 
    "510": "PST", "530": "PST", "541": "PST", "559": "PST", "562": "PST", "604": "PST", "619": "PST", 
    "626": "PST", "650": "PST", "661": "PST", "702": "PST", "707": "PST", "714": "PST", "760": "PST", 
    "775": "PST", "778": "PST", "805": "PST", "818": "PST", "831": "PST", "858": "PST", "909": "PST", 
    "916": "PST", "925": "PST", "949": "PST", "951": "PST", "971": "PST",

    // AKST (Alaska Standard Time)
    "907": "AKST",

    // HST (Hawaii Standard Time)
    "808": "HST",

    // AST (Atlantic Standard Time)
    "787": "AST", "939": "AST",

    // NST (Newfoundland Standard Time)
    "709": "NST"
  };

  const resolutions = [
    { id: "e9367f41-cb3b-42f0-b612-6528d02098dc", name: "REFUND / REEMBOLSO" },
    { id: "94dad466-99f5-4f62-b6a1-f7d0a567ffae", name: "GIFT / REGALO COMPENSACIÓN" },
    { id: "a148c4e2-b2f3-4b6d-9cf6-6eb8255c6099", name: "DISPUTE / DISPUTA BANCARIA" },
    { id: "49bb94ed-70b8-4d8f-80ae-8b4f8ab9b04e", name: "LOST LEAD / CLIENTE PERDIDO" },
    { id: "cdc84079-b6a3-4665-9161-97d8d7bac5eb", name: "P+R / PENDIENTE + REGLAS" },
    { id: "550d1479-412d-45f9-b7da-64cd69473af1", name: "RESOLVED / SOLUCIONADO" }
  ];

  // Fetch Task Data from ClickUp via our local API route (we can use AI Search or fetch directly if needed, let's query our backend)
  useEffect(() => {
    if (!taskId) return;
    fetchTaskDetails();
  }, [taskId]);

  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages]);

  const safeParseResponse = async (res: Response, fallback: any = {}) => {
    try {
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        return await res.json();
      }
      const text = await res.text();
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  };

  const fetchTaskDetails = async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const [detailsRes, chatRes] = await Promise.all([
        fetch(`/api/task-details/${taskId}`),
        fetch(`/api/task-chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task_id: taskId, query: "Resumen ejecutivo del caso y estatus actual" })
        })
      ]);

      let detailsData = { name: `Ticket #${taskId}`, description: "", phone: "", timezone: "EST", zendesk_ticket_id: "" };
      if (detailsRes.ok) {
        detailsData = await safeParseResponse(detailsRes, detailsData);
      }

      let chatData = { answer: "No se pudo obtener el resumen de Donna IA." };
      if (chatRes.ok) {
        chatData = await safeParseResponse(chatRes, chatData);
      }

      setTask({
        id: taskId,
        name: detailsData.name,
        description: detailsData.description,
        phone: detailsData.phone,
        timezone: detailsData.timezone,
        zendesk_ticket_id: detailsData.zendesk_ticket_id,
        reason: (detailsData as any).reason || "",
        comments: (detailsData as any).comments || [],
        summary: chatData.answer
      });

      if ((detailsData as any).resolution_id) {
        setResolutionId((detailsData as any).resolution_id);
      }

      setNewTimezone(detailsData.timezone || "EST");
      setClientPhone(detailsData.phone || "");
      const zdTicket = detailsData.zendesk_ticket_id || "";
      setZendeskTicketId(zdTicket);

      // Try to parse and prefill ticket number from name
      const originalName = detailsData.name || "";
      let parsedTicket = "";
      if (originalName.includes("-")) {
        const parts = originalName.split("-");
        parsedTicket = parts[0].trim();
      } else {
        const match = originalName.match(/\b([A-Z0-9]{3,10})\b/i);
        if (match) {
          parsedTicket = match[1];
        }
      }
      setTicketNumber(zdTicket || parsedTicket);
    } catch (err) {
      console.error("Error loading task details:", err);
      setTask({
        id: taskId,
        name: `Ticket #${taskId}`,
        description: "",
        summary: "Error cargando los detalles."
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneChange = (val: string) => {
    setClientPhone(val);
    const clean = val.replace(/\D/g, "");
    let areaCode = "";
    if (clean.startsWith("1") && clean.length >= 4) {
      areaCode = clean.substring(1, 4);
    } else if (clean.length >= 3) {
      areaCode = clean.substring(0, 3);
    }
    
    if (areaCode && areaCode.length === 3) {
      const tz = areaCodeToTimezone[areaCode];
      if (tz) {
        setNewTimezone(tz);
      }
    }
  };

  const handleUpdateClientInfo = async () => {
    setSubmittingAction(true);
    try {
      const res = await fetch(`/api/update-client-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          phone: clientPhone,
          timezone: newTimezone,
          new_task_id: currentTaskId,
          zendesk_ticket_id: zendeskTicketId
        })
      });
      if (res.ok) {
        alert("Información del cliente actualizada correctamente.");
        if (onTaskUpdated) {
          onTaskUpdated(taskId, { tz_tag: newTimezone });
        }
        onActionComplete(true); // Silent background refresh
        if (currentTaskId && currentTaskId.trim() !== taskId) {
          onClose(); // Close modal since Task ID changed
        } else {
          // Refresh details
          fetchTaskDetails();
        }
      } else {
        const errData = await res.json();
        alert(`Error: ${errData.error || "Ocurrió un error"}`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleUpdateTimezone = async () => {
    if (!newTimezone) return;
    setSubmittingAction(true);
    try {
      const res = await fetch(`/api/update-timezone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: taskId, timezone: newTimezone })
      });
      if (res.ok) {
        alert("Zona horaria actualizada correctamente.");
        if (onTaskUpdated) {
          onTaskUpdated(taskId, { tz_tag: newTimezone });
        }
        onActionComplete(true); // Silent background refresh
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleLogAndPush = async (customComment?: string, isNoAnswerMachine: boolean = false) => {
    const commentToSend = customComment || spanishComment;
    if (!commentToSend.trim()) return;
    setSubmittingAction(true);
    try {
      const res = await fetch(`/api/log-and-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          task_id: taskId, 
          spanish_comment: commentToSend,
          zendesk_ticket_id: zendeskTicketId || ticketNumber,
          is_no_answer_machine: isNoAnswerMachine
        })
      });
      if (res.ok) {
        const data = await res.json();
        setSpanishComment("");
        
        let toastMsg = "";
        let toastType: "success" | "error" | "info" = "success";
        
        if (data.zendesk_status === "success") {
          toastMsg = `¡Log guardado y sincronizado!\n\n• ClickUp: Traducido y guardado exitosamente.\n• Zendesk: ${data.zendesk_message}`;
          toastType = "success";
        } else if (data.zendesk_status === "failed") {
          toastMsg = `⚠️ Log guardado en ClickUp, pero falló Zendesk.\n\n• ClickUp: Traducido y guardado exitosamente.\n• Zendesk: ${data.zendesk_message}`;
          toastType = "error";
        } else {
          toastMsg = `¡Log guardado en ClickUp!\n\n• ClickUp: Traducido y guardado exitosamente.`;
          toastType = "info";
        }

        if (showToast) {
          showToast(toastMsg, toastType);
        } else {
          alert(toastMsg);
        }
        
        if (data.trigger_schedule) {
          // Preset to tomorrow at current local time
          const now = new Date();
          const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
          const year = tomorrow.getFullYear();
          const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
          const day = String(tomorrow.getDate()).padStart(2, '0');
          setScheduleDate(`${year}-${month}-${day}`);

          const hours = String(now.getHours()).padStart(2, '0');
          const minutes = String(now.getMinutes()).padStart(2, '0');
          setScheduleTime(`${hours}:${minutes}`);
          setShowScheduleModal(true);
        } else {
          onActionComplete(true);
        }
      } else {
        const errData = await res.json();
        alert(`Error: ${errData.error || errData.message || "Ocurrió un error"}`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleConfirmSchedule = async (skip = false) => {
    if (skip) {
      setShowScheduleModal(false);
      onActionComplete(true);
      return;
    }

    if (!scheduleDate || !scheduleTime) {
      alert("Por favor selecciona una fecha y hora válidas.");
      return;
    }

    setSchedulingCall(true);
    try {
      const timestamp = computedScheduledTimestamp;

      const res = await fetch(`/api/schedule-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          timestamp,
          zendesk_ticket_id: zendeskTicketId || ticketNumber
        })
      });

      if (res.ok) {
        setScheduleSuccess(true);
        if (showToast) {
          showToast("📞 ¡Llamada agendada exitosamente!", "success");
        } else {
          alert("📞 ¡Llamada agendada exitosamente!");
        }
        setTimeout(() => {
          setShowScheduleModal(false);
          setScheduleSuccess(false);
          onActionComplete(true);
        }, 2000);
      } else {
        const errData = await res.json();
        alert(`Error al agendar llamada: ${errData.error || "Ocurrió un error"}`);
      }
    } catch (err) {
      console.error(err);
      alert("Error al procesar la agenda.");
    } finally {
      setSchedulingCall(false);
    }
  };

  const handleNoAnswer = () => {
    const defaultTemplate = "INTENTO DE CONTACTO TELEFÓNICO FALLIDO (MÁQUINA / BUZÓN DE VOZ). DEJAMOS MENSAJE Y SEGUIMOS PROCESO.";
    if (!spanishComment.trim()) {
      setSpanishComment(defaultTemplate);
    } else {
      handleLogAndPush(spanishComment, true);
    }
  };

  const handleBankPause = async () => {
    if (!bankDays) return;
    setSubmittingAction(true);
    try {
      const res = await fetch(`/api/bank-pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: taskId, days: parseInt(bankDays) })
      });
      if (res.ok) {
        alert(`Caso pausado por ${bankDays} días bancarios.`);
        onActionComplete(true);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleCloseTask = async () => {
    const finalTicketNum = (ticketNumber || zendeskTicketId).trim();
    if (!closureComment.trim()) {
      alert("Por favor añade un comentario de cierre para documentar el caso.");
      return;
    }
    if (!finalTicketNum) {
      alert("Por favor ingresa el número de ticket para poder reacomodar el título.");
      return;
    }

    if (rileyEvaluation?.status === "CHECK") {
      const confirmClose = window.confirm(
        `🤖 ALERTA DEL AGENTE RILEY:\n\n` +
        `• Regla: ${rileyEvaluation.title}\n` +
        `• Observación: ${rileyEvaluation.description}\n\n` +
        (rileyEvaluation.suggestedResolution ? `💡 Sugerencia: Se recomienda usar '${rileyEvaluation.suggestedResolution}' en lugar de la resolución actual.\n\n` : '') +
        `¿Deseas cerrar la tarea de todos modos con la resolución actual?`
      );
      if (!confirmClose) return;
    }

    setSubmittingAction(true);
    try {
      const res = await fetch(`/api/close-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          spanish_comment: closureComment,
          resolution_id: resolutionId,
          ticket_number: finalTicketNum,
          riley_status: rileyEvaluation?.status || "CHECK"
        })
      });
      if (res.ok) {
        const data = await res.json();
        setClosureComment("");
        
        // Build communication toast message
        let toastMsg = "";
        let toastType: "success" | "error" | "info" = "success";
        
        if (data.zendesk_status === "success") {
          toastMsg = `¡ClickUp y Zendesk Sincronizados!\n\n• ClickUp: Tarea cerrada exitosamente.\n• Zendesk: ${data.zendesk_message}`;
          toastType = "success";
        } else if (data.zendesk_status === "failed") {
          toastMsg = `⚠️ ClickUp Cerrado, pero falló Zendesk.\n\n• ClickUp: Tarea cerrada exitosamente.\n• Zendesk: ${data.zendesk_message}`;
          toastType = "error";
        } else {
          toastMsg = `¡Tarea cerrada en ClickUp!\n\n• ClickUp: Tarea cerrada exitosamente.\n• Zendesk: ${data.zendesk_message}`;
          toastType = "info";
        }

        if (showToast) {
          showToast(toastMsg, toastType);
        } else {
          // Fallback to standard alert
          alert(toastMsg);
        }

        onActionComplete();
        onClose();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleCloneRefund = async () => {
    setSubmittingAction(true);
    try {
      const res = await fetch(`/api/duplicate-refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          method: cloneMethod,
          type: cloneType
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`¡Clonado con éxito!\nNuevo Nombre: ${data.new_name}\nSe ha asignado a Lorenzo para procesamiento.`);
        onActionComplete();
      } else {
        alert(`Error al clonar: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleSendChat = async () => {
    if (!chatQuery.trim()) return;
    const userQuery = chatQuery;
    setChatQuery("");
    
    setChatMessages(prev => [...prev, { sender: "user", text: userQuery, timestamp: new Date() }]);
    setChatLoading(true);

    try {
      const res = await fetch(`/api/task-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: taskId, query: userQuery })
      });
      const data = await res.json();
      setChatMessages(prev => [...prev, { sender: "donna", text: data.answer || "No obtuve respuesta de Donna.", timestamp: new Date() }]);
    } catch (err: any) {
      setChatMessages(prev => [...prev, { sender: "donna", text: `Error de conexión: ${err.message}`, timestamp: new Date() }]);
    } finally {
      setChatLoading(false);
    }
  };

  const activeZdId = (zendeskTicketId || ticketNumber || "").trim().replace(/\D/g, "");

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex justify-end z-50 animate-fade-in">
      <div className="w-full max-w-2xl bg-slate-950/80 backdrop-blur-2xl border-l border-white/15 h-full flex flex-col justify-between shadow-[0_0_50px_rgba(0,0,0,0.8)] relative">
        
        {/* Modal Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/5">
          <div className="min-w-0 pr-4 space-y-2 flex-1">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-[10px] font-mono font-bold tracking-widest text-white/60 uppercase block">Detalle y Acciones Rápidas</span>
              
              {/* Top Client & Agent Live Local Time Badge */}
              <div className="flex items-center gap-2 bg-cyan-950/70 border border-cyan-500/40 px-3 py-1 rounded-xl text-xs font-mono shadow-[0_0_12px_rgba(6,182,212,0.15)] flex-wrap">
                <Clock className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                <span className="text-white/60 text-[11px]">Hora Cliente:</span>
                <span className="text-cyan-300 font-bold text-sm">{clientLiveTime}</span>
                <span className="text-xs font-bold text-cyan-400/90 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">{effectiveTz}</span>

                <span className="text-white/20 text-xs px-1">|</span>

                <span className="text-white/60 text-[11px]">Tu Hora (Agente):</span>
                <span className="text-emerald-300 font-bold text-sm">{agentLiveTime}</span>

                {(clientPhone || task?.phone) && (
                  <span className="text-white/70 text-xs border-l border-white/20 pl-2 ml-0.5 flex items-center gap-1 font-sans">
                    <Phone className="w-3 h-3 text-cyan-400/80" />
                    <span className="font-mono font-semibold">{clientPhone || task?.phone}</span>
                  </span>
                )}
              </div>
            </div>

            <h3 className="text-base font-bold text-white leading-snug truncate">
              {loading ? `Cargando Ticket #${taskId}...` : (task?.name || `Ticket #${taskId}`)}
            </h3>
            {!loading && (
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <a
                  href={`https://app.clickup.com/t/${taskId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-sm group"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-purple-400 group-hover:scale-110 transition-transform" />
                  Abrir en ClickUp (#{taskId})
                </a>

                {activeZdId ? (
                  <a
                    href={`https://vipcosmetics.zendesk.com/agent/tickets/${activeZdId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-sm group"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-emerald-400 group-hover:scale-110 transition-transform" />
                    Abrir en Zendesk (#{activeZdId})
                  </a>
                ) : (
                  <span className="text-[11px] text-amber-400/80 font-mono flex items-center gap-1 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                    <AlertTriangle className="w-3 h-3 text-amber-400" /> Sin ID de Zendesk
                  </span>
                )}
              </div>
            )}
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 border border-white/20 text-white/80 hover:text-white hover:bg-white/20 transition-all cursor-pointer shrink-0 ml-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content Tabs */}
        <div className="flex border-b border-white/10 bg-white/5">
          {[
            { id: "actions", label: "Acciones ClickUp" },
            { id: "zendesk_user", label: "Verificar Usuario Zendesk" },
            { id: "chat", label: "Consultar con Donna IA" },
            { id: "cloning", label: "Duplicar a Reembolsos" }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`flex-1 py-3 text-xs font-semibold tracking-wider uppercase transition-all duration-300 ${
                activeSubTab === tab.id 
                  ? "border-b-2 border-white text-white bg-white/10" 
                  : "text-white/50 hover:text-white hover:bg-white/5"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scrollable Content Pane */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 space-y-3">
              <Loader2 className="w-8 h-8 text-white/60 animate-spin" />
              <p className="text-xs text-white/50 font-mono">Descargando historial de ClickUp...</p>
            </div>
          ) : (
            <>
              {/* Executive Case Summary */}
              <div className="bg-white/5 border border-white/15 p-5 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-white font-semibold text-xs uppercase tracking-wider font-mono">
                  <Sparkles className="w-4 h-4 text-white/80 animate-pulse" />
                  Donna AI: Resumen del Caso
                </div>
                <p className="text-xs text-white/80 leading-relaxed font-sans whitespace-pre-wrap">
                  {task?.summary}
                </p>
              </div>

              {/* Client Info Overview */}
              {!loading && task && (
                <div className="bg-cyan-950/20 border border-cyan-500/20 p-4 rounded-xl flex flex-wrap gap-4 items-center justify-between text-xs">
                  <div className="flex items-center gap-2 font-mono text-white/70">
                    <Phone className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Teléfono:</span>
                    <span className="text-white font-bold">{clientPhone || task.phone || "No asignado"}</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-white/70">
                    <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Zona Horaria:</span>
                    <span className="text-cyan-300 font-bold">{effectiveTz}</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-white/70">
                    <Clock className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Hora Local Cliente:</span>
                    <span className="text-cyan-300 font-bold">{clientLiveTime}</span>
                  </div>
                </div>
              )}

              {/* Tab 1: Actions */}
              {activeSubTab === "actions" && (
                <div className="space-y-6">
                  {/* Client Info Update Widget (Phone and Timezone) */}
                  <div className="glass-card p-4 space-y-4">
                    <label className="text-xs font-bold text-white/60 uppercase tracking-wide flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-white/50" /> Datos del Cliente y Horario
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-white/50 uppercase block mb-1">Número de Teléfono</span>
                        <input
                          type="tel"
                          placeholder="Ingresa teléfono..."
                          value={clientPhone}
                          onChange={(e) => handlePhoneChange(e.target.value)}
                          className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-white/30"
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-white/50 uppercase block mb-1">Zona Horaria (ClickUp)</span>
                        <select
                          value={newTimezone}
                          onChange={(e) => setNewTimezone(e.target.value)}
                          className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-white/30"
                        >
                          <option value="" className="bg-slate-900">Selecciona Zona...</option>
                          {timezones.map(tz => (
                            <option key={tz} value={tz} className="bg-slate-900">{tz}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-white/50 uppercase block mb-1">ID de Tarea ClickUp</span>
                        <input
                          type="text"
                          placeholder="ID de Tarea ClickUp..."
                          value={currentTaskId}
                          onChange={(e) => setCurrentTaskId(e.target.value)}
                          className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-white/30"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold text-white/50 uppercase block">ID Ticket Zendesk</span>
                          {activeZdId && (
                            <a
                              href={`https://vipcosmetics.zendesk.com/agent/tickets/${activeZdId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-emerald-400 hover:text-emerald-300 hover:underline flex items-center gap-1 font-mono font-bold"
                            >
                              <ExternalLink className="w-2.5 h-2.5" /> Abrir
                            </a>
                          )}
                        </div>
                        <input
                          type="text"
                          placeholder="Ej. 123456"
                          value={zendeskTicketId}
                          onChange={(e) => {
                            const val = e.target.value;
                            setZendeskTicketId(val);
                            if (!ticketNumber || ticketNumber === zendeskTicketId) {
                              setTicketNumber(val);
                            }
                          }}
                          className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-white/30"
                        />
                      </div>
                    </div>
                    <button
                      onClick={handleUpdateClientInfo}
                      disabled={submittingAction}
                      className="w-full py-2 bg-white/10 text-white border border-white/20 rounded-xl text-xs font-bold hover:bg-white/20 transition-all cursor-pointer flex items-center justify-center gap-2"
                    >
                      <Save className="w-3.5 h-3.5" /> Actualizar Datos del Cliente
                    </button>
                  </div>

                  {/* Comment Translation Log & Push */}
                  <div className="glass-card p-4 space-y-3.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-white/60 uppercase tracking-wide">Nuevo Log (ClickUp / Zendesk)</label>
                    </div>

                    <textarea
                      placeholder="Escribe aquí tu log en español... Donna corregirá tu redacción, lo traducirá a un inglés corporativo preciso y actualizará el ticket en ClickUp y Zendesk en un solo paso."
                      value={spanishComment}
                      onChange={(e) => setSpanishComment(e.target.value)}
                      rows={4}
                      className="w-full bg-white/5 border border-white/15 rounded-xl p-3 text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all leading-relaxed font-sans"
                    />

                    {rileyEvaluation && rileyEvaluation.status === "CHECK" && (
                      <div className="bg-amber-500/15 border border-amber-500/30 rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-amber-200">
                        <div className="flex items-center gap-2">
                          <Bot className="w-4 h-4 text-amber-400 shrink-0" />
                          <div>
                            <span className="font-bold text-amber-300">{rileyEvaluation.title}:</span>{" "}
                            <span className="text-white/90">{rileyEvaluation.description}</span>
                          </div>
                        </div>
                        {rileyEvaluation.suggestedResolution && (
                          <button
                            type="button"
                            onClick={() => handleApplySuggestedResolution(rileyEvaluation.suggestedResolution!)}
                            className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-1 shrink-0 transition-all cursor-pointer shadow"
                          >
                            <ArrowRight className="w-3.5 h-3.5" />
                            Cambiar a {rileyEvaluation.suggestedResolution}
                          </button>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-end gap-2.5">
                      <button
                        onClick={() => handleLogAndPush(spanishComment, true)}
                        disabled={submittingAction || !spanishComment.trim()}
                        className="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 text-xs font-semibold flex items-center gap-2 rounded-xl transition-all cursor-pointer disabled:opacity-40"
                        title="Envía como nota interna en Zendesk sin registrar hora de respuesta del cliente"
                      >
                        <PhoneOff className="w-3.5 h-3.5 text-amber-400" />
                        Sin Respuesta
                      </button>

                      <button
                        onClick={() => handleLogAndPush(spanishComment, false)}
                        disabled={submittingAction || !spanishComment.trim()}
                        className="px-5 py-2.5 bg-white text-slate-950 hover:bg-white/90 text-xs font-bold flex items-center gap-2 rounded-xl transition-all cursor-pointer disabled:opacity-40 shadow-[0_4px_15px_rgba(255,255,255,0.15)]"
                        title="Guarda el comentario y registra la hora habitual de respuesta del cliente"
                      >
                        {submittingAction ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-950" /> : <Send className="w-3.5 h-3.5 text-slate-950" />}
                        Cliente Respondió
                      </button>
                    </div>
                  </div>

                  {/* Bank Pause Widget */}
                  <div className="glass-card p-4 space-y-3.5">
                    <label className="text-xs font-bold text-white/60 uppercase tracking-wide">Pausa Bancaria (Evita Seguimiento Diario)</label>
                    <div className="flex gap-3">
                      <input
                        type="number"
                        placeholder="Días"
                        value={bankDays}
                        onChange={(e) => setBankDays(e.target.value)}
                        className="w-24 bg-white/5 border border-white/15 rounded-xl px-3 text-center text-xs font-mono text-white focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all"
                      />
                      <button
                        onClick={handleBankPause}
                        disabled={submittingAction}
                        className="flex-1 px-4 py-2 bg-amber-500/20 text-amber-200 border border-amber-500/30 rounded-xl text-xs font-bold hover:bg-amber-500/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Pause className="w-3.5 h-3.5" /> Pausar Tarea
                      </button>
                    </div>
                  </div>

                  {/* Close Task Form */}
                  <div className="bg-rose-500/10 border border-rose-500/25 p-5 rounded-xl space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-rose-300 font-bold text-xs uppercase tracking-wider font-mono">
                        <Lock className="w-4 h-4 text-rose-400" />
                        Cerrar Caso y Guardar Resolución
                      </div>
                      {rileyEvaluation && (
                        <button
                          type="button"
                          onClick={() => setShowRileyToast(true)}
                          className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-full border flex items-center gap-1.5 transition-all cursor-pointer ${
                            rileyEvaluation.status === "CHECK"
                              ? "bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30 animate-pulse"
                              : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30"
                          }`}
                        >
                          🤖 Riley: {rileyEvaluation.status}
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-white/50 uppercase">Resolución Final</label>
                        <select
                          value={resolutionId}
                          onChange={async (e) => {
                            const newResId = e.target.value;
                            setResolutionId(newResId);
                            if (taskId) {
                              try {
                                const res = await fetch("/api/update-resolution", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ task_id: taskId, resolution_id: newResId })
                                });
                                const data = await res.json();
                                if (res.ok && data.success) {
                                  showToast?.(`✅ Resolución actualizada en ClickUp.`, "success");
                                }
                              } catch (err) {
                                console.error("Error actualizando resolución en ClickUp:", err);
                              }
                            }
                          }}
                          className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-rose-400"
                        >
                          {resolutions.map(res => (
                            <option key={res.id} value={res.id} className="bg-slate-900">{res.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-white/50 uppercase">Número de Ticket</label>
                        <input
                          type="text"
                          placeholder="ej. M10502"
                          value={ticketNumber || zendeskTicketId}
                          onChange={(e) => setTicketNumber(e.target.value)}
                          className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder-white/35 focus:outline-none focus:border-rose-400"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-white/50 uppercase">Nota de Cierre (Español)</label>
                        <input
                          type="text"
                          placeholder="ej. Se procesó reembolso..."
                          value={closureComment}
                          onChange={(e) => setClosureComment(e.target.value)}
                          className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-xs text-white placeholder-white/35 focus:outline-none focus:border-rose-400"
                        />
                      </div>
                    </div>

                    {rileyEvaluation && rileyEvaluation.status === "CHECK" && (
                      <div className="bg-amber-500/15 border border-amber-500/30 rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-amber-200">
                        <div className="flex items-center gap-2">
                          <Bot className="w-4 h-4 text-amber-400 shrink-0" />
                          <div>
                            <span className="font-bold text-amber-300">{rileyEvaluation.title}:</span>{" "}
                            <span className="text-white/90">{rileyEvaluation.description}</span>
                          </div>
                        </div>
                        {rileyEvaluation.suggestedResolution && (
                          <button
                            type="button"
                            onClick={() => handleApplySuggestedResolution(rileyEvaluation.suggestedResolution!)}
                            className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-1 shrink-0 transition-all cursor-pointer shadow"
                          >
                            <ArrowRight className="w-3.5 h-3.5" />
                            Cambiar a {rileyEvaluation.suggestedResolution}
                          </button>
                        )}
                      </div>
                    )}

                    <button
                      onClick={handleCloseTask}
                      disabled={submittingAction}
                      className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      Cerrar Ticket Permanentemente
                    </button>
                  </div>
                </div>
              )}

              {/* Tab: Zendesk User Checker */}
              {activeSubTab === "zendesk_user" && (
                <div className="glass-card p-5 rounded-2xl border border-white/10">
                  <ZendeskUserChecker
                    taskId={currentTaskId}
                    initialEmail={task?.email}
                    initialPhone={clientPhone}
                    initialName={task?.name}
                    isModalMode={true}
                    onTaskUpdated={() => onActionComplete(true)}
                    onSelectUser={(u, ticket) => {
                      if (u.phone) setClientPhone(u.phone);
                      const activeTicketId = ticket?.id ? String(ticket.id) : (u.recent_tickets?.[0]?.id ? String(u.recent_tickets[0].id) : "");
                      if (activeTicketId) {
                        setZendeskTicketId(activeTicketId);
                        setTicketNumber(activeTicketId);
                      }
                      if (onTaskUpdated) {
                        onTaskUpdated(currentTaskId, { 
                          email: u.email, 
                          phone: u.phone, 
                          zendesk_ticket_id: activeTicketId 
                        });
                      }
                    }}
                  />
                </div>
              )}

              {/* Tab 2: Donna Chat */}
              {activeSubTab === "chat" && (
                <div className="flex flex-col h-[520px] bg-white/5 border border-white/10 rounded-2xl">
                  {/* Messages Window */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {chatMessages.map((msg, idx) => (
                      <div key={idx} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[85%] rounded-2xl p-3.5 text-xs leading-relaxed ${
                          msg.sender === "user" 
                            ? "bg-white text-slate-950 rounded-tr-none font-bold shadow-md" 
                            : "bg-white/10 border border-white/15 text-white/90 rounded-tl-none font-sans whitespace-pre-wrap"
                        }`}>
                          {msg.text}
                          <span className={`block text-[8px] font-mono mt-1 text-right ${msg.sender === "user" ? "text-slate-500" : "text-white/40"}`}>
                            {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                      </div>
                    ))}
                    {chatLoading && (
                      <div className="flex justify-start">
                        <div className="bg-white/10 border border-white/15 rounded-2xl rounded-tl-none p-3.5 flex items-center gap-2">
                          <Loader2 className="w-4 h-4 text-white/60 animate-spin" />
                          <span className="text-xs text-white/50 font-mono">Donna está analizando el caso...</span>
                        </div>
                      </div>
                    )}
                    <div ref={chatBottomRef} />
                  </div>

                  {/* Input Box */}
                  <div className="p-3 border-t border-white/10 bg-white/5 flex gap-2 rounded-b-2xl">
                    <input
                      type="text"
                      placeholder="Pregunta a Donna sobre las notas de este ticket..."
                      value={chatQuery}
                      onChange={(e) => setChatQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
                      className="flex-1 bg-white/5 border border-white/15 rounded-xl px-4 text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all"
                    />
                    <button
                      onClick={handleSendChat}
                      disabled={chatLoading || !chatQuery.trim()}
                      className="p-3 rounded-xl bg-white text-slate-950 hover:bg-white/90 flex items-center justify-center transition-all cursor-pointer disabled:opacity-40 shadow-md"
                    >
                      <Send className="w-4 h-4 text-slate-950" />
                    </button>
                  </div>
                </div>
              )}

              {/* Tab 3: Cloning */}
              {activeSubTab === "cloning" && (
                <div className="space-y-6">
                  <div className="glass-card p-5 space-y-4">
                    <div className="flex items-center gap-2 text-amber-200 font-semibold text-xs uppercase tracking-wider font-mono">
                      <AlertTriangle className="w-4 h-4 text-amber-300" />
                      Duplicar a Lista de Reembolsos de Lorenzo (Lista #223500803)
                    </div>
                    <p className="text-xs text-white/70 leading-relaxed font-sans">
                      Esto creará un duplicado del ticket en la lista de Reembolsos, agregará automáticamente las plantillas bancarias necesarias para el método de pago seleccionado, y se lo asignará a Lorenzo de forma nativa.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-white/50 uppercase">Método de Pago</label>
                        <select
                          value={cloneMethod}
                          onChange={(e) => setCloneMethod(e.target.value)}
                          className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2.5 text-xs font-mono text-white focus:outline-none focus:border-white/30"
                        >
                          <option value="CHECK" className="bg-slate-900">CHECK / CHEQUE</option>
                          <option value="WIRE TRANSFER" className="bg-slate-900">BANK WIRE TRANSFER / TRANSFERENCIA</option>
                          <option value="E-TRANSFER" className="bg-slate-900">E-TRANSFER / INTERAC</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-white/50 uppercase">Tipo de Reembolso</label>
                        <select
                          value={cloneType}
                          onChange={(e) => setCloneType(e.target.value)}
                          className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2.5 text-xs font-mono text-white focus:outline-none focus:border-white/30"
                        >
                          <option value="FULL REFUND" className="bg-slate-900">FULL REFUND / REEMBOLSO TOTAL</option>
                          <option value="PARTIAL REFUND" className="bg-slate-900">PARTIAL REFUND / REEMBOLSO PARCIAL</option>
                        </select>
                      </div>
                    </div>

                    <button
                      onClick={handleCloneRefund}
                      disabled={submittingAction}
                      className="w-full py-3 bg-white text-slate-950 hover:bg-white/90 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-[0_4px_15px_rgba(255,255,255,0.15)]"
                    >
                      <Plus className="w-4 h-4 text-slate-950" /> Duplicar y Agregar Plantillas
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {showScheduleModal && (
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-6 z-50 animate-fade-in">
            <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl p-6 space-y-4 shadow-2xl relative">
              <div className="text-center space-y-1">
                <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/25 rounded-full flex items-center justify-center mx-auto text-emerald-400 mb-2 animate-bounce">
                  <Phone className="w-6 h-6" />
                </div>
                <h4 className="text-base font-bold text-white">¿Agendar llamada de seguimiento?</h4>
                <p className="text-xs text-white/50 leading-relaxed">
                  Detectamos "LOG NUEVO" en tus comentarios. ¿Te gustaría agendar una llamada para este cliente mañana a la misma hora u otra fecha?
                </p>
              </div>

              {scheduleSuccess ? (
                <div className="p-4 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-center text-xs font-semibold text-emerald-300 font-mono animate-pulse">
                  ¡Llamada agendada exitosamente en ClickUp y Zendesk! Sincronizando...
                </div>
              ) : (
                <>
                  <div className="space-y-3.5">
                    {/* Huso de Referencia selector */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-white/50 uppercase tracking-wide">La hora que ingresarás corresponde a:</label>
                      <div className="grid grid-cols-2 gap-2 bg-white/5 p-1 rounded-xl border border-white/10 text-xs font-mono">
                        <button
                          type="button"
                          onClick={() => setScheduleRefMode("agent")}
                          className={`py-1.5 px-2 rounded-lg text-center transition-all cursor-pointer font-bold ${
                            scheduleRefMode === "agent"
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                              : "text-white/60 hover:text-white"
                          }`}
                        >
                          👤 Tu Hora (Agente)
                        </button>
                        <button
                          type="button"
                          onClick={() => setScheduleRefMode("client")}
                          className={`py-1.5 px-2 rounded-lg text-center transition-all cursor-pointer font-bold ${
                            scheduleRefMode === "client"
                              ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                              : "text-white/60 hover:text-white"
                          }`}
                        >
                          📞 Hora Cliente ({effectiveTz})
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-white/50 uppercase tracking-wide">Fecha de la llamada</label>
                        <input
                          type="date"
                          value={scheduleDate}
                          onChange={(e) => setScheduleDate(e.target.value)}
                          className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-white/50 uppercase tracking-wide">
                          Hora ({scheduleRefMode === "agent" ? "Tu Hora Local" : `Cliente ${effectiveTz}`})
                        </label>
                        <input
                          type="time"
                          value={scheduleTime}
                          onChange={(e) => setScheduleTime(e.target.value)}
                          className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    {/* Previsualización en Tiempo Real de Ambas Horas */}
                    <div className="bg-cyan-950/40 border border-cyan-500/30 rounded-xl p-3 space-y-2">
                      <div className="text-[10px] font-bold text-cyan-400/90 uppercase tracking-wider flex items-center justify-between">
                        <span>Previsualización de Horario Conversión en Vivo</span>
                        <span className="text-[9px] text-white/40 normal-case font-mono">(Ajuste de Horario Verano/Invierno Automático)</span>
                      </div>
                      <div className="flex items-center justify-between text-xs font-mono pt-1">
                        <span className="text-white/70 flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Tu Hora de Agente:</span>
                        </span>
                        <span className="text-emerald-300 font-bold">{previewAgentTimeStr}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs font-mono border-t border-white/10 pt-1.5">
                        <span className="text-white/70 flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Hora Cliente ({effectiveTz}):</span>
                        </span>
                        <span className="text-cyan-300 font-bold">{previewClientTimeStr}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => handleConfirmSchedule(true)}
                      className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-xl text-xs font-semibold transition-all cursor-pointer border border-white/10"
                    >
                      Omitir
                    </button>
                    <button
                      onClick={() => handleConfirmSchedule(false)}
                      disabled={schedulingCall}
                      className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-[0_4px_12px_rgba(16,185,129,0.2)] disabled:opacity-50"
                    >
                      {schedulingCall ? <Loader2 className="w-3.5 h-3.5 animate-spin text-white" /> : "Agendar Llamada"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Riley Agent Floating Resolution Toast */}
        {showRileyToast && rileyEvaluation && rileyEvaluation.status === "CHECK" && (
          <RileyToast
            evaluation={rileyEvaluation}
            onApplySuggestedResolution={handleApplySuggestedResolution}
            onDismiss={() => setShowRileyToast(false)}
            onClose={() => setShowRileyToast(false)}
          />
        )}

      </div>
    </div>
  );
}
