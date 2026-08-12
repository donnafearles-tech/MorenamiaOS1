import rileyRulesConfig from "../data/rileyRules.json";

export interface CommentInput {
  author?: string;
  createdAt?: string | Date;
  text: string;
}

export interface RileyEvaluationInput {
  resolution: string; // UUID or text (e.g., REFUND, GIFT, DISPUTE, LOST LEAD, RESOLVED)
  reason?: string;
  comments?: (string | CommentInput)[];
  lastCustomerReplyAt?: string | Date | null;
  lastAgentReplyAt?: string | Date | null;
  taskName?: string;
}

export interface RileyEvaluationResult {
  status: "OK" | "CHECK";
  ruleId: string | null;
  title: string;
  description: string;
  resolutionNormalized: string;
  suggestedResolution?: string;
  details?: string;
}

// ClickUp Resolution Option UUID Mappings
export const RESOLUTION_UUID_MAP: Record<string, string> = {
  "e9367f41-cb3b-42f0-b612-6528d02098dc": "REFUND",
  "94dad466-99f5-4f62-b6a1-f7d0a567ffae": "GIFT",
  "a148c4e2-b2f3-4b6d-9cf6-6eb8255c6099": "DISPUTE",
  "49bb94ed-70b8-4d8f-80ae-8b4f8ab9b04e": "LOST LEAD",
  "550d1479-412d-45f9-b7da-64cd69473af1": "RESOLVED",
  "cdc84079-b6a3-4665-9161-97d8d7bac5eb": "P+R"
};

export function normalizeResolution(res: string): string {
  if (!res) return "UNKNOWN";
  if (RESOLUTION_UUID_MAP[res]) return RESOLUTION_UUID_MAP[res];

  const upper = res.toUpperCase();
  if (upper.includes("DISPUTE") || upper.includes("DISPUTA")) return "DISPUTE";
  if (upper.includes("REFUND") || upper.includes("REEMBOLSO")) return "REFUND";
  if (upper.includes("GIFT") || upper.includes("REGALO")) return "GIFT";
  if (upper.includes("LOST LEAD") || upper.includes("PERDIDO")) return "LOST LEAD";
  if (upper.includes("RESOLVED") || upper.includes("RESUELTO")) return "RESOLVED";
  if (upper.includes("P+R") || upper.includes("P & R")) return "P+R";

  return upper;
}

export function evaluateRileyResolution(input: RileyEvaluationInput): RileyEvaluationResult {
  const normResolution = normalizeResolution(input.resolution);
  const normReason = (input.reason || "").toLowerCase().trim();

  // Combine all comment texts
  const commentTexts = (input.comments || []).map(c => 
    typeof c === "string" ? c : c.text || ""
  );
  const fullText = [input.taskName || "", ...commentTexts].join(" ").toLowerCase();

  // Helper check functions
  const containsKeywords = (keywords: string[]) => keywords.some(k => fullText.includes(k.toLowerCase()));

  // 1. DISPUTE_PREMATURE
  if (normResolution === "DISPUTE") {
    const bankDisputeKeywords = ["chargeback", "bank dispute", "disputa bancaria", "charge back", "contracargo", "banco"];
    const hasBankEvidence = containsKeywords(bankDisputeKeywords);

    if (!hasBankEvidence) {
      return {
        status: "CHECK",
        ruleId: "DISPUTE_PREMATURE",
        title: "⚠️ Disputa Prematura Detectada",
        description: "Se seleccionó DISPUTA pero los comentarios no incluyen evidencia clara de disputa bancaria/chargeback. Por favor verifica si el cliente realmente abrió caso con su banco.",
        resolutionNormalized: normResolution,
        details: "No se encontraron términos clave como chargeback, contracargo o disputa bancaria."
      };
    }
  }

  // 2. GHOSTED_IS_NOT_RESOLVED & NO_CUSTOMER_AGREEMENT
  if (normResolution === "RESOLVED") {
    const acceptancePhrases = ["gracias", "acepto", "thank you", "agreed", "de acuerdo", "perfecto", "me parece bien", "accepted", "conforme", "ok", "solucionado", "confirmado"];
    const hasAcceptance = containsKeywords(acceptancePhrases);

    if (!hasAcceptance) {
      return {
        status: "CHECK",
        ruleId: "GHOSTED_IS_NOT_RESOLVED",
        title: "⚠️ Cliente Ghosteó ≠ Resuelto",
        description: "El cliente dejó de responder tras expresar inconformidad o no existe confirmación explícita de aceptación en los comentarios. Sin confirmación del cliente, esto NO es RESOLVED.",
        resolutionNormalized: normResolution,
        suggestedResolution: "LOST LEAD",
        details: "Sugerencia de Riley: Cambiar la resolución a LOST LEAD (salvo que exista evidencia de disputa bancaria)."
      };
    }
  } else if (["GIFT", "REFUND"].includes(normResolution)) {
    const acceptancePhrases = ["gracias", "acepto", "thank you", "agreed", "de acuerdo", "perfecto", "me parece bien", "accepted", "conforme", "ok", "solucionado", "confirmado"];
    const hasAcceptance = containsKeywords(acceptancePhrases);

    if (!hasAcceptance) {
      return {
        status: "CHECK",
        ruleId: "NO_CUSTOMER_AGREEMENT_FOR_GIFT_REFUND_RESOLVED",
        title: "⚠️ Falta Aceptación Explicita del Cliente",
        description: `Se seleccionó ${normResolution} pero no se detectaron frases explícitas de acuerdo o aceptación por parte del cliente en los comentarios.`,
        resolutionNormalized: normResolution,
        details: "Verifica que el cliente haya aceptado por escrito el arreglo o compensación ofrecida."
      };
    }
  }

  // 3. LOST_LEAD_TOO_EARLY
  if (normResolution === "LOST LEAD") {
    const deadlineKeywords = ["deadline", "fecha limite", "aviso de cierre", "cierre de caso", "no response"];
    const hasDeadlineMessage = containsKeywords(deadlineKeywords);

    let daysSinceReply = 999;
    if (input.lastCustomerReplyAt) {
      const lastReplyDate = new Date(input.lastCustomerReplyAt);
      const now = new Date();
      daysSinceReply = Math.floor((now.getTime() - lastReplyDate.getTime()) / (1000 * 60 * 60 * 24));
    }

    if (daysSinceReply < 3 || !hasDeadlineMessage) {
      return {
        status: "CHECK",
        ruleId: "LOST_LEAD_TOO_EARLY",
        title: "⚠️ Cierre de Lost Lead Prematuro",
        description: "Se estableció LOST LEAD pero han pasado menos de 3 días sin respuesta del cliente o falta registro del mensaje de deadline enviado.",
        resolutionNormalized: normResolution,
        details: `Días sin respuesta registrados: ${daysSinceReply < 900 ? daysSinceReply : "no especificado"}. Requiere aviso previo.`
      };
    }
  }

  // 4. REFUND_WITHOUT_APPROVAL
  if (normResolution === "REFUND") {
    const approvalKeywords = ["aprobado", "approved", "aprobacion finanzas", "authorized", "autorizado", "refund approved", "aprobado por finanzas"];
    const hasApproval = containsKeywords(approvalKeywords);

    if (!hasApproval) {
      return {
        status: "CHECK",
        ruleId: "REFUND_WITHOUT_APPROVAL",
        title: "⚠️ Reembolso sin Aprobación Interna",
        description: "Resolución de REFUND indicada pero no consta registro de aprobación previa por el departamento de finanzas o equipo interno.",
        resolutionNormalized: normResolution,
        details: "Asegúrate de tener la autorización requerida registrada antes de ejecutar el reembolso."
      };
    }
  }

  // 5. RESOLVED_WITH_PENDING_ACTIONS
  if (normResolution === "RESOLVED") {
    const pendingKeywords = ["pendiente", "en espera", "falta guia", "tracking pendiente", "sin enviar", "por enviar", "esperando respuesta"];
    const hasPendingActions = containsKeywords(pendingKeywords);

    if (hasPendingActions) {
      return {
        status: "CHECK",
        ruleId: "RESOLVED_WITH_PENDING_ACTIONS",
        title: "⚠️ Resuelto con Acciones Pendientes",
        description: "Marcado como RESOLVED pero se detectan términos de acciones pendientes (guías, envíos o respuestas) en los comentarios.",
        resolutionNormalized: normResolution,
        details: "Confirma que todas las acciones operativas estén 100% completadas."
      };
    }
  }

  // 6. REASON_INCONSISTENT
  if (["deffective", "defective"].includes(normReason)) {
    const conflictingCategories = ["gbk", "shalem", "first sale refund", "regret", "arrepentimiento"];
    const hasConflict = containsKeywords(conflictingCategories);

    if (hasConflict) {
      return {
        status: "CHECK",
        ruleId: "REASON_INCONSISTENT",
        title: "⚠️ Motivo Inconsistente",
        description: "El motivo figura como 'deffective' pero los comentarios corresponden a categorías como GBK, Shalem o Arrepentimiento.",
        resolutionNormalized: normResolution,
        details: "Corrige el campo Motivo en ClickUp para que concuerde con la causa real del caso."
      };
    }
  }

  // 7. MISSING_CONTEXT
  if (!fullText || fullText.trim().length < 10) {
    return {
      status: "CHECK",
      ruleId: "MISSING_CONTEXT",
      title: "⚠️ Contexto Insuficiente",
      description: "No se proporcionó suficiente contexto o comentario en el log para justificar y validar la resolución.",
      resolutionNormalized: normResolution,
      details: "Añade un comentario explicativo antes de cerrar el caso."
    };
  }

  // Fallback: OK
  return {
    status: "OK",
    ruleId: null,
    title: "✅ Resolución Verificada (Riley OK)",
    description: "La resolución cumple satisfactoriamente con los criterios de validación de Riley.",
    resolutionNormalized: normResolution
  };
}
