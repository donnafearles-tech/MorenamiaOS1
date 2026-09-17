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

  // Active customer contact, inbound calls, purchase interest, inquiries, and agreement phrases
  const customerEngagementKeywords = [
    "customer called", "client called", "called us", "called customer service", "called the store", "inbound call",
    "cliente llamó", "cliente llamo", "llamó el cliente", "llamo el cliente", "llamada entrante", "llamada del cliente",
    "customer contacted", "client contacted", "cliente contactó", "cliente contacto", "cliente se comunicó", "cliente se comunico",
    "customer reached out", "client reached out", "customer responded", "client responded", "cliente respondió", "cliente respondio",
    "customer replied", "client replied", "customer wrote", "cliente escribió", "cliente escribio", "cliente envio",
    "customer asked", "client asked", "cliente preguntó", "cliente pregunto", "cliente solicitó", "cliente solicito",
    "customer inquired", "customer requested", "solicitó información", "solicito informacion",
    "interested in purchasing", "interested in buying", "interesado en comprar", "interesado en adquirir", "interested in",
    "wants to buy", "wants to purchase", "purchased", "compró", "compro", "compraron", "realizó compra", "realizo compra",
    "placed an order", "placed order", "ordenó", "ordeno", "orden de compra", "hydra silk", "hydrasilk",
    "upsell", "cross-sell", "additional product", "additional purchase",
    "gracias", "acepto", "thank you", "thanks", "agreed", "de acuerdo", "perfecto", "me parece bien",
    "accepted", "conforme", "ok", "solucionado", "confirmado", "confirmed", "customer agreed", "cliente aceptó", "cliente acepto",
    "satisfied", "satisfecho", "conforme con la solución", "conforme con el producto"
  ];

  const hasCustomerEngagement = containsKeywords(customerEngagementKeywords);

  // 0. PRODUCT_AND_REFUND_MUST_BE_P_AND_R (Regla Estricta: Producto + Reembolso = P+R)
  const isExplicitPandR = containsKeywords([
    "p+r", "p + r", "p&r", "product + refund", "product and refund", "product & refund",
    "producto + reembolso", "producto y reembolso", "producto y un reembolso",
    "producto y aparte un reembolso", "producto y aparte reembolso", "producto mas reembolso",
    "un producto y aparte un reembolso", "un producto y un reembolso", "entregar un producto y aparte un reembolso",
    "reembolso y producto", "reembolso mas producto", "reembolso y un producto"
  ]);

  const hasRefundSemantic = containsKeywords(["reembolso", "refund", "devolucion de dinero", "money back", "devolucion"]);
  const hasProductSemantic = containsKeywords(["producto", "product", "crema", "suero", "serum", "device", "aparato", "regalo", "gift", "reposicion", "reemplazo", "entregar", "entrega", "enviar", "envio"]);
  const hasAdditiveConnector = containsKeywords(["aparte", "ademas", "adicional", "tambien", "plus", " y ", " + ", "&", "junto con", "con un"]);

  const isCombinedProductAndRefund = isExplicitPandR || (hasRefundSemantic && hasProductSemantic && hasAdditiveConnector);

  if (isCombinedProductAndRefund && normResolution !== "P+R") {
    return {
      status: "CHECK",
      ruleId: "PRODUCT_AND_REFUND_MUST_BE_P_AND_R",
      title: "⚠️ Resolución Debe Ser P+R",
      description: "En los comentarios se acordó entregar/enviar un producto y aparte un reembolso. Cuando se combinan producto y reembolso, la resolución oficial DEBE ser 'P+R'.",
      resolutionNormalized: normResolution,
      suggestedResolution: "P+R",
      details: "Se detectó entrega de producto + reembolso simultáneos en el acuerdo del caso."
    };
  }

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
    if (!hasCustomerEngagement) {
      return {
        status: "CHECK",
        ruleId: "GHOSTED_IS_NOT_RESOLVED",
        title: "⚠️ Cliente Ghosteó ≠ Resuelto",
        description: "El cliente dejó de responder tras expresar inconformidad o no existe confirmación / contacto activo del cliente en los comentarios. Sin interacción o confirmación, esto no es RESOLVED.",
        resolutionNormalized: normResolution,
        suggestedResolution: "LOST LEAD",
        details: "Sugerencia de Riley: Cambiar la resolución a LOST LEAD (salvo que exista evidencia de disputa bancaria o contacto activo del cliente)."
      };
    }
  } else if (["GIFT", "REFUND"].includes(normResolution)) {
    if (!hasCustomerEngagement) {
      return {
        status: "CHECK",
        ruleId: "NO_CUSTOMER_AGREEMENT_FOR_GIFT_REFUND_RESOLVED",
        title: "⚠️ Falta Aceptación o Interacción del Cliente",
        description: `Se seleccionó ${normResolution} pero no se detectaron frases explícitas de acuerdo, llamada o interacción del cliente en los comentarios.`,
        resolutionNormalized: normResolution,
        details: "Verifica que el cliente haya aceptado por escrito o comunicado su conformidad con el arreglo."
      };
    }
  }

  // 3. LOST_LEAD_EVALUATION
  if (normResolution === "LOST LEAD") {
    // If the customer actually called, replied, or showed purchase interest, they did NOT ghost!
    if (hasCustomerEngagement) {
      return {
        status: "CHECK",
        ruleId: "ACTIVE_CUSTOMER_NOT_LOST_LEAD",
        title: "⚠️ Cliente Activo ≠ Lost Lead",
        description: "El cliente se comunicó activamente (ej. llamó, respondió o mostró interés en comprar productos). No debe clasificarse como LOST LEAD ya que no ha dejado de responder.",
        resolutionNormalized: normResolution,
        suggestedResolution: "RESOLVED",
        details: "El cliente contactó o interactuó activamente con nosotros. Mantener en RESOLVED o en seguimiento activo."
      };
    }

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
