	import express from "express";
	import path from "path";
	import fs from "fs";
	const fsp = fs.promises;
	import { createServer as createViteServer } from "vite";
	import dotenv from "dotenv";
	import { getStateByPhone } from "./src/data/areaCodes";

	dotenv.config();

	// Auto-regenerate .env from .env.example if missing, preserving the known GROQ_API_KEY
	try {
	  const envPath = ".env";
	  const examplePath = ".env.example";
	  if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
		console.log("[Self-Healing] Recreating .env from .env.example...");
		let content = fs.readFileSync(examplePath, "utf8");
		
		// Inject the known Groq API Key if it's currently MY_GROQ_API_KEY or missing
		if (content.includes("MY_GROQ_API_KEY") && process.env.GROQ_API_KEY) {
		  content = content.replace("MY_GROQ_API_KEY", process.env.GROQ_API_KEY);
		}
		
		fs.writeFileSync(envPath, content, "utf8");
		// Reload dotenv with the newly created .env file
		dotenv.config();
	  }
	} catch (err) {
	  console.error("[Self-Healing] Error recreating .env file:", err);
	}

	// Ensure dummy placeholder values never override real system-injected environment variables
	const PLACEHOLDERS = ["MY_GEMINI_API_KEY", "MY_GROQ_API_KEY", "MY_APP_URL"];
	for (const key of Object.keys(process.env)) {
	  let val = process.env[key];
	  if (val !== undefined) {
		// Strip surrounding quotes if present and trim whitespace
		val = val.trim().replace(/^["']+|["']+$/g, "").trim();
		process.env[key] = val;
		if (PLACEHOLDERS.includes(val) || val === "") {
		  delete process.env[key];
		}
	  }
	}

	// Fallback to .env.example for any missing variables
	try {
	  if (fs.existsSync(".env.example")) {
		const exampleConfig = dotenv.parse(fs.readFileSync(".env.example"));
		for (const key of Object.keys(exampleConfig)) {
		  if (!process.env[key] && exampleConfig[key]) {
			let val = exampleConfig[key].trim().replace(/^["']+|["']+$/g, "").trim();
			if (val !== "" && !PLACEHOLDERS.includes(val)) {
			  process.env[key] = val;
			}
		  }
		}
	  }
	} catch (err) {
	  console.error("Error loading fallback .env.example:", err);
	}


	// Clean up and self-heal environment variables
	if (process.env.SHAREFILE_ACCESS_TOKEN) {
	  process.env.SHAREFILE_ACCESS_TOKEN = process.env.SHAREFILE_ACCESS_TOKEN.trim().replace(/^"+|"+$/g, "");
	}
	if (process.env.SHAREFILE_API_BASE_URL) {
	  process.env.SHAREFILE_API_BASE_URL = process.env.SHAREFILE_API_BASE_URL.trim().replace(/^"+|"+$/g, "");
	}

	const tokenCand = process.env.SHAREFILE_ACCESS_TOKEN || "";
	const urlCand = process.env.SHAREFILE_API_BASE_URL || "";

	if (tokenCand.startsWith("http") && (urlCand.includes(".") || urlCand.length > 100)) {
	  console.log("[Self-Healing] Swapping SHAREFILE_ACCESS_TOKEN and SHAREFILE_API_BASE_URL because they were reversed.");
	  process.env.SHAREFILE_ACCESS_TOKEN = urlCand;
	  process.env.SHAREFILE_API_BASE_URL = tokenCand;
	} else if (urlCand.startsWith("ey") && tokenCand.startsWith("http")) {
	  console.log("[Self-Healing] Swapping SHAREFILE_ACCESS_TOKEN and SHAREFILE_API_BASE_URL because they were reversed (ey check).");
	  process.env.SHAREFILE_ACCESS_TOKEN = urlCand;
	  process.env.SHAREFILE_API_BASE_URL = tokenCand;
	}

	// Normalizar el subdominio de Zendesk para corregir posibles typos como "vipcpsmetics"
	if (process.env.ZENDESK_SUBDOMAIN) {
	  const cleanSub = process.env.ZENDESK_SUBDOMAIN.trim().toLowerCase().replace(/^"+|"+$/g, "");
	  if (cleanSub === "vipcpsmetics" || cleanSub === "vipcosmetic" || cleanSub === "vipcpsmetic") {
		process.env.ZENDESK_SUBDOMAIN = "vipcosmetics";
	  } else {
		process.env.ZENDESK_SUBDOMAIN = cleanSub;
	  }
	  console.log(`🔧 [Self-Healing] Zendesk subdomain normalized to: "${process.env.ZENDESK_SUBDOMAIN}"`);
	} else {
	  process.env.ZENDESK_SUBDOMAIN = "vipcosmetics";
	}

	// ==========================================
	// SUPABASE DATABASE CLOUD SYNC & BACKUP LAYER
	// ==========================================

	async function supabaseUpsert(key: string, value: any) {
	  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
	  const apiKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
	  
	  if (!url || !apiKey) return;
	  
	  try {
		const cleanUrl = url.replace(/\/$/, "");
		const targetUrl = `${cleanUrl}/rest/v1/donna_state`;
		
		const response = await fetch(targetUrl, {
		  method: "POST",
		  headers: {
			"apikey": apiKey,
			"Authorization": `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			"Prefer": "resolution=merge-duplicates"
		  },
		  body: JSON.stringify({ key, value, updated_at: new Date().toISOString() })
		});
		
		if (!response.ok) {
		  const txt = await response.text();
		  console.warn(`[Supabase Backup Warning] Could not upsert key "${key}": ${response.status} - ${txt}`);
		} else {
		  console.log(`[Supabase Backup Success] Key "${key}" backed up to Supabase.`);
		}
	  } catch (err: any) {
		console.error(`[Supabase Backup Error] Key "${key}" failed:`, err.message);
	  }
	}

	async function supabaseFetch(key: string): Promise<any | null> {
	  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
	  const apiKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
	  
	  if (!url || !apiKey) return null;
	  
	  try {
		const cleanUrl = url.replace(/\/$/, "");
		const targetUrl = `${cleanUrl}/rest/v1/donna_state?key=eq.${encodeURIComponent(key)}&select=value`;
		
		const response = await fetch(targetUrl, {
		  method: "GET",
		  headers: {
			"apikey": apiKey,
			"Authorization": `Bearer ${apiKey}`,
			"Accept": "application/json"
		  }
		});
		
		if (!response.ok) {
		  const txt = await response.text();
		  console.warn(`[Supabase Fetch Warning] Could not get key "${key}": ${response.status} - ${txt}`);
		  return null;
		}
		
		const rows = await response.json() as any[];
		if (rows && rows.length > 0) {
		  return rows[0].value;
		}
	  } catch (err: any) {
		console.error(`[Supabase Fetch Error] Key "${key}" failed:`, err.message);
	  }
	  return null;
	}

	async function backupEnvToSupabase() {
	  try {
		const envPath = path.join(process.cwd(), ".env");
		if (fs.existsSync(envPath)) {
		  const envContent = await fsp.readFile(envPath, "utf-8");
		  const parsed = dotenv.parse(envContent);
		  
		  const cleanEnv: any = {};
		  for (const k of Object.keys(parsed)) {
			if (parsed[k] && !PLACEHOLDERS.includes(parsed[k])) {
			  cleanEnv[k] = parsed[k];
			}
		  }
		  await supabaseUpsert("env_variables", cleanEnv);
		}
	  } catch (err: any) {
		console.error("[Supabase Backup Env Error]:", err.message);
	  }
	}

	async function syncSupabaseToLocal() {
	  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
	  const apiKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
	  
	  if (!url || !apiKey) {
		console.log("⚠️ [Supabase Sync] Credentials not configured. Local JSON storage will be used exclusively.");
		return;
	  }
	  
	  console.log("📡 [Supabase Sync] Starting synchronization from Supabase to local filesystem...");
	  
	  const filesToSync = [
		{ key: "timezones", file: "timezones.json" },
		{ key: "phones", file: "phones.json" },
		{ key: "zendesk_tickets", file: "zendesk_tickets.json" },
		{ key: "answered_times", file: "answered_times.json" },
		{ key: "auto_closed_logs", file: "auto_closed_tasks_log.json" },
		{ key: "historical_metrics", file: "historical_metrics.json" }
	  ];
	  
	  const dataDir = path.join(process.cwd(), "src", "data");
	  if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	  }
	  
	  // 1. Sync variables/environment
	  try {
		const remoteEnv = await supabaseFetch("env_variables");
		if (remoteEnv && typeof remoteEnv === "object") {
		  console.log("✅ [Supabase Sync] Found remote .env variables. Merging with local...");
		  const envPath = path.join(process.cwd(), ".env");
		  let localParsed: any = {};
		  if (fs.existsSync(envPath)) {
			const localContent = fs.readFileSync(envPath, "utf-8");
			localParsed = dotenv.parse(localContent);
		  }
		  
		  const merged = { ...remoteEnv, ...localParsed };
		  const envLines = Object.keys(merged).map(k => `${k}="${merged[k]}"`);
		  fs.writeFileSync(envPath, envLines.join("\n"), "utf-8");
		  
		  dotenv.config();
		  for (const k of Object.keys(merged)) {
			process.env[k] = merged[k];
		  }
		  console.log("✅ [Supabase Sync] Merged environment variables applied successfully.");
		}
	  } catch (err: any) {
		console.error("❌ [Supabase Sync] Error syncing env variables:", err.message);
	  }
	  
	  // 2. Sync each data file
	  for (const item of filesToSync) {
		try {
		  const remoteData = await supabaseFetch(item.key);
		  if (remoteData) {
			const filePath = path.join(dataDir, item.file);
			await fsp.writeFile(filePath, JSON.stringify(remoteData, null, 2), "utf-8");
			console.log(`✅ [Supabase Sync] Successfully restored local file "${item.file}" from Supabase.`);
		  } else {
			console.log(`ℹ️ [Supabase Sync] No remote backup found for key "${item.key}". Skipping.`);
		  }
		} catch (err: any) {
		  console.error(`❌ [Supabase Sync] Error restoring "${item.file}":`, err.message);
		}
	  }
	  console.log("📡 [Supabase Sync] Synchronization complete.");
	}

	function parseOcrResult(content: string): { telefono: string, texto_completo: string } {
	  let telefono = "";
	  const telefonoMatch = content.match(/TELÉFONO:\s*(.*?)(?:\n|$)/i);
	  if (telefonoMatch) {
		telefono = telefonoMatch[1].trim();
	  } else {
		const patrones = [
		  /\(\d{3}\)\s?\d{3}[-.]?\d{4}/,
		  /\d{3}[-.]\d{3}[-.]\d{4}/,
		  /\+\d{1,3}\s?\d{3}\s?\d{3}\s?\d{4}/,
		  /\d{10}/
		];
		for (const patron of patrones) {
		  const m = content.match(patron);
		  if (m) {
			telefono = m[0];
			break;
		  }
		}
	  }

	  let textoCompleto = content;
	  const textoCompletoMatch = content.match(/TEXTO COMPLETO:\s*([\s\S]*)/i);
	  if (textoCompletoMatch) {
		textoCompleto = textoCompletoMatch[1].trim();
	  }

	  return {
		telefono: telefono || "No encontrado",
		texto_completo: textoCompleto
	  };
	}

	async function ocrWithGroq(imageBase64: string, mimeType: string): Promise<{ telefono: string, texto_completo: string }> {
	  const normalizedMimeType = mimeType && mimeType.startsWith("image/") ? mimeType : "image/jpeg";
	  const groqApiKey = process.env.GROQ_API_KEY;

	  if (groqApiKey && groqApiKey !== "MY_GROQ_API_KEY" && !groqApiKey.includes("YOUR_")) {
		try {
		  console.log("[OCR] Attempting transcription with Groq Meta-Llama...");
		  const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
			method: "POST",
			headers: {
			  "Authorization": `Bearer ${groqApiKey}`,
			  "Content-Type": "application/json"
			},
			body: JSON.stringify({
			  model: "meta-llama/llama-4-scout-17b-16e-instruct",
			  messages: [
				{
				  role: "user",
				  content: [
					{
					  type: "text",
					  text: "Transcribe todo el texto de esta imagen. Luego, dime cuál es el número de teléfono. Formatea tu respuesta EXACTAMENTE así:\n\nTELÉFONO: [número aquí]\n\nTEXTO COMPLETO:\n[texto completo aquí]"
					},
					{
					  type: "image_url",
					  image_url: {
						url: `data:${normalizedMimeType};base64,${imageBase64}`
					  }
					}
				  ]
				}
			  ],
			  temperature: 0.0,
			  max_tokens: 2000
			})
		  });

		  if (groqResponse.ok) {
			const responseData = await groqResponse.json();
			const content = responseData.choices?.[0]?.message?.content || "";
			console.log("[OCR] Groq Llama OCR successful!");
			return parseOcrResult(content);
		  } else {
			const errorText = await groqResponse.text();
			console.error(`[OCR] Groq API error (status ${groqResponse.status}): ${errorText}`);
			throw new Error(`Groq API error (status ${groqResponse.status}): ${errorText}`);
		  }
		} catch (err: any) {
		  console.error(`[OCR] Groq API call failed: ${err.message}`);
		  throw err;
		}
	  } else {
		console.error("[OCR] GROQ_API_KEY not configured or is placeholder.");
		throw new Error("GROQ_API_KEY environment variable is missing or placeholder.");
	  }
	}

	const app = express();
	const PORT = 3000;

	// API Keys & Config
	const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
	const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY || "";
	const CLICKUP_LIST_ID = "48494459";
	const ID_DONNA = 101113624;
	const ID_LORENZO = 10678227;

	const ID_CF_SALE_DATE = "f910021f-74df-426d-bdf2-586867dbf5c6";
	const ID_CF_AMOUNT_USD = "a51386cd-755e-4c9c-af58-5686b5c2a82d";
	const ID_CF_SHAREFILE = "d074e0d9-a8ce-4bf4-a49b-5eab81ee477f";
	const ID_CF_REASON = "ee1a1e07-a9b6-4209-a7bc-87162005e2f2";
	const ID_CF_CONTACT_DATE = "63946f1c-7c02-455a-af2d-af7f5f41e3ea";

	// Body parser limits increased for base64 image uploads
	app.use(express.json({ limit: "50mb" }));
	app.use(express.urlencoded({ extended: true, limit: "50mb" }));

	// Middleware to force using the server-side ZAPIER_MCP_TOKEN if present
	app.use((req, res, next) => {
	  const envToken = process.env.ZAPIER_MCP_TOKEN;
	  if (envToken && envToken.trim() !== "") {
		if (req.body && typeof req.body === "object") {
		  req.body.zapier_token = envToken.trim();
		}
		if (req.query) {
		  req.query.zapier_token = envToken.trim();
		}
	  }
	  next();
	});

	// Metrics state
	const metrics = {
	  tasks_created: 0,
	  ai_search_calls: 0,
	  ai_search_avg_time_ms: 0,
	  total_ai_time_ms: 0,
	  logs_pushed: 0,
	};

	function logMetric(metricName: string, elapsedSeconds: number, extra?: any) {
	  const elapsedMs = elapsedSeconds * 1000;
	  if (metricName === "ai_search") {
		metrics.ai_search_calls += 1;
		metrics.total_ai_time_ms += elapsedMs;
		metrics.ai_search_avg_time_ms = metrics.total_ai_time_ms / metrics.ai_search_calls;
	  } else if (metricName === "create_ticket") {
		metrics.tasks_created += 1;
	  } else if (metricName === "log_and_push") {
		metrics.logs_pushed += 1;
	  }
	  console.log(JSON.stringify({ event: metricName, duration_ms: Math.round(elapsedMs * 100) / 100, extra }));
	}

	app.post("/api/zendesk/internal-note", async (req, res) => {
  const { ticket_id, note_body, zapier_token } = req.body;
  if (!ticket_id || !note_body) {
    return res.status(400).json({ error: "ticket_id y note_body requeridos" });
  }

  const token = zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
  const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${token}`;

  try {
    const result = await addNoteByTicketIdRaw(zapierUrl, String(ticket_id), note_body);
    res.json({ status: "ok", message: "Nota interna agregada", response: result.note_result });
  } catch (e: any) {
    console.error("❌ Error:", e);
    res.status(500).json({ error: e.message || "Error al agregar la nota" });
  }
});

app.post("/zendesk/internal-note-by-id", async (req, res) => {
  const { ticket_id, note_body, zapier_token } = req.body;

  if (!ticket_id || !note_body) {
    return res.status(400).json({ error: "Campos requeridos: ticket_id, note_body" });
  }

  const token = zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
  const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${token}`;

  try {
    const result = await addNoteByTicketIdRaw(zapierUrl, String(ticket_id), note_body);
    return res.json({
      status: "ok",
      message: `Nota interna agregada al ticket #${ticket_id}`,
      ticket_found: result.ticket_found,
      response: result.note_result
    });
  } catch (e: any) {
    console.error(`❌ Error: ${e}`);
    const isNotFound = e.message && (e.message.includes("no encontrado") || e.message.includes("not found") || e.message.includes("no tiene subject"));
    return res.status(isNotFound ? 404 : 500).json({ error: e.message || "Error al agregar la nota" });
  }
});

app.post("/api/zendesk/internal-note-by-id", async (req, res) => {
  const { ticket_id, note_body, zapier_token } = req.body;

  if (!ticket_id || !note_body) {
    return res.status(400).json({ error: "Campos requeridos: ticket_id, note_body" });
  }

  const token = zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
  const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${token}`;

  try {
    const result = await addNoteByTicketIdRaw(zapierUrl, String(ticket_id), note_body);
    return res.json({
      status: "ok",
      message: `Nota interna agregada al ticket #${ticket_id}`,
      ticket_found: result.ticket_found,
      response: result.note_result
    });
  } catch (e: any) {
    console.error(`❌ Error: ${e}`);
    const isNotFound = e.message && (e.message.includes("no encontrado") || e.message.includes("not found") || e.message.includes("no tiene subject"));
    return res.status(isNotFound ? 404 : 500).json({ error: e.message || "Error al agregar la nota" });
  }
});

// GET /zendesk/debug-macro/:macro_id
app.get(["/zendesk/debug-macro/:macro_id", "/api/zendesk/debug-macro/:macro_id"], async (req, res) => {
  const { macro_id } = req.params;
  const token = req.query.zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
  const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${token}`;

  const subdomain = process.env.ZENDESK_SUBDOMAIN || "vipcosmetics";
  const zendeskSub = subdomain.toLowerCase().trim();
  const zendeskApiBase = `https://${zendeskSub}.zendesk.com`;
  const url = `${zendeskApiBase}/api/v2/macros/${macro_id}.json`;

  try {
    const result = await callZapierMcp(zapierUrl, {
      selected_api: "ZendeskV2CLIAPI",
      action: "_zap_raw_request",
      params: {
        url: url,
        method: "GET"
      }
    });

    return res.json({ status: "ok", result });
  } catch (e: any) {
    return res.json({ status: "error", message: e.message });
  }
});

// GET /zendesk/search-ticket-raw
app.get(["/zendesk/search-ticket-raw", "/api/zendesk/search-ticket-raw"], async (req, res) => {
  const ticketId = req.query.ticket_id;
  if (!ticketId) {
    return res.status(400).json({ error: "Parámetro requerido: ticket_id" });
  }
  const token = req.query.zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
  const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${token}`;

  try {
    const ticketData = await searchTicketByIdRaw(zapierUrl, String(ticketId));
    if (!ticketData) {
      return res.status(404).json({ error: `Ticket #${ticketId} no encontrado` });
    }
    return res.json({ status: "ok", ticket: ticketData });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /zendesk/debug-raw/:ticket_id
app.get(["/zendesk/debug-raw/:ticket_id", "/api/zendesk/debug-raw/:ticket_id"], async (req, res) => {
  const { ticket_id } = req.params;
  const token = req.query.zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
  const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${token}`;

  const subdomain = process.env.ZENDESK_SUBDOMAIN || "vipcosmetics";
  const zendeskSub = subdomain.toLowerCase().trim();
  const zendeskApiBase = `https://${zendeskSub}.zendesk.com`;
  const url = `${zendeskApiBase}/api/v2/tickets/${ticket_id}.json`;

  try {
    const result = await callZapierMcp(zapierUrl, {
      selected_api: "ZendeskV2CLIAPI",
      action: "_zap_raw_request",
      params: {
        url: url,
        method: "GET"
      }
    });

    return res.json({ status: "ok", result });
  } catch (e: any) {
    return res.json({ status: "error", message: e.message });
  }
});

// GET /zendesk/get-macro
app.get(["/zendesk/get-macro", "/api/zendesk/get-macro"], async (req, res) => {
  const macroId = req.query.macro_id;
  if (!macroId) {
    return res.status(400).json({ error: "Parámetro requerido: macro_id" });
  }
  const token = req.query.zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
  const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${token}`;

  try {
    const macro = await getMacroById(zapierUrl, String(macroId));
    if (!macro) {
      return res.status(404).json({ error: `Macro #${macroId} no encontrado` });
    }
    return res.json({ status: "ok", macro });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /zendesk/ticket-comments
app.get(["/zendesk/ticket-comments", "/api/zendesk/ticket-comments"], async (req, res) => {
  const ticketId = req.query.ticket_id;
  if (!ticketId) {
    return res.status(400).json({ error: "Parámetro requerido: ticket_id" });
  }
  const token = req.query.zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
  const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${token}`;

  try {
    const comments = await getTicketComments(zapierUrl, String(ticketId));
    return res.json({
      status: "ok",
      ticket_id: ticketId,
      count: comments.length,
      comments: comments
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /zendesk/latest-comment
app.get(["/zendesk/latest-comment", "/api/zendesk/latest-comment"], async (req, res) => {
  const ticketId = req.query.ticket_id;
  if (!ticketId) {
    return res.status(400).json({ error: "Parámetro requerido: ticket_id" });
  }
  const token = req.query.zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
  const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${token}`;

  try {
    const comment = await getLatestComment(zapierUrl, String(ticketId));
    if (!comment) {
      return res.status(404).json({ error: `No se encontraron comentarios para el ticket #${ticketId}` });
    }
    return res.json({
      status: "ok",
      ticket_id: ticketId,
      comment: comment
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /zendesk/create-user
app.post(["/zendesk/create-user", "/api/zendesk/create-user-raw"], async (req, res) => {
  const data = req.body;
  const required = ["name", "email"];
  for (const field of required) {
    if (!data[field]) {
      return res.status(400).json({ error: `Campo requerido: ${field}` });
    }
  }

  const token = data.zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
  const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${token}`;

  const params = {
    selected_api: "ZendeskV2CLIAPI",
    action: "user",
    instructions: "Create a new user in Zendesk. Use the provided params. Do not ask for more information.",
    params: {
      name: data.name,
      email: data.email,
      phone: data.phone || "",
      external_id: String(data.external_id || ""),
      notes: `Store: ${data.store_location || "N/A"}\nNotes: ${data.notes || ""}`,
      role: "end-user",
      verified: true
    }
  };

  try {
    const result = await callZapierMcp(zapierUrl, params, "execute_zapier_write_action");
    return res.json({ status: "ok", message: "Usuario creado en Zendesk", response: result });
  } catch (e: any) {
    console.error(`❌ Error: ${e}`);
    return res.status(500).json({ error: e.message });
  }
});

// POST /zendesk/create-ticket (Matches Python implementation)
app.post(["/zendesk/create-ticket", "/api/zendesk/create-ticket-raw"], async (req, res) => {
  const data = req.body;
  if (!data.subject || !data.comment_body) {
    return res.status(400).json({ error: "Campos requeridos: subject, comment_body" });
  }

  const token = data.zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
  const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${token}`;

  const params = {
    selected_api: "ZendeskV2CLIAPI",
    action: "ticket",
    instructions: "Create a new support ticket in Zendesk. Do not ask for more information.",
    params: {
      subject: data.subject,
      comment: { body: data.comment_body },
      requester: {
        name: data.requester_name || "Unknown",
        email: data.requester_email || "unknown@email.com"
      },
      priority: data.priority || "normal",
      tags: data.tags || []
    }
  };

  try {
    const result = await callZapierMcp(zapierUrl, params, "execute_zapier_write_action");
    return res.json({ status: "ok", message: "Ticket creado en Zendesk", response: result });
  } catch (e: any) {
    console.error(`❌ Error: ${e}`);
    return res.status(500).json({ error: e.message });
  }
});

// POST /zendesk/internal-note
app.post(["/zendesk/internal-note", "/api/zendesk/internal-note-raw"], async (req, res) => {
  const { ticket_id, note_body, zapier_token } = req.body;
  if (!ticket_id || !note_body) {
    return res.status(400).json({ error: "Campos requeridos: ticket_id, note_body" });
  }

  const token = zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
  const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${token}`;

  try {
    const result = await addNoteByTicketIdRaw(zapierUrl, String(ticket_id), note_body);
    return res.json({ 
      status: "ok", 
      message: "Nota interna agregada", 
      ticket_found: result.ticket_found,
      response: result.note_result 
    });
  } catch (e: any) {
    console.error(`❌ Error: ${e}`);
    return res.status(500).json({ error: e.message });
  }
});

// POST /zendesk/public-reply
app.post(["/zendesk/public-reply", "/api/zendesk/public-reply"], async (req, res) => {
  const { ticket_id, message_body, zapier_token } = req.body;
  if (!ticket_id || !message_body) {
    return res.status(400).json({ error: "Campos requeridos: ticket_id, message_body" });
  }

  const token = zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
  const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${token}`;

  const params = {
    selected_api: "ZendeskV2CLIAPI",
    action: "ticket_comment",
    instructions: `Add a PUBLIC reply to ticket ${ticket_id}: '${message_body}'. Execute immediately.`,
    params: {
      id: String(ticket_id),
      comment: message_body,
      public: "yes"
    }
  };

  try {
    const result = await callZapierMcp(zapierUrl, params, "execute_zapier_write_action");
    return res.json({ status: "ok", message: "Respuesta pública enviada", response: result });
  } catch (e: any) {
    console.error(`❌ Error: ${e}`);
    return res.status(500).json({ error: e.message });
  }
});

// POST /zendesk/close-ticket
app.post(["/zendesk/close-ticket", "/api/zendesk/close-ticket"], async (req, res) => {
  const { ticket_id, zapier_token } = req.body;
  if (!ticket_id) {
    return res.status(400).json({ error: "Campo requerido: ticket_id" });
  }

  const token = zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
  const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${token}`;

  const params = {
    selected_api: "ZendeskV2CLIAPI",
    action: "update_ticket_v2",
    instructions: `Update ticket ${ticket_id}. Set status to 'closed'. Execute immediately.`,
    params: {
      id: String(ticket_id),
      status: "closed"
    }
  };

  try {
    const result = await callZapierMcp(zapierUrl, params, "execute_zapier_write_action");
    return res.json({ status: "ok", message: `Ticket ${ticket_id} cerrado`, response: result });
  } catch (e: any) {
    console.error(`❌ Error: ${e}`);
    return res.status(500).json({ error: e.message });
  }
});

// POST /zendesk/close-with-note
app.post(["/zendesk/close-with-note", "/api/zendesk/close-with-note"], async (req, res) => {
  const { ticket_id, resolution_note, zapier_token } = req.body;
  if (!ticket_id) {
    return res.status(400).json({ error: "Campo requerido: ticket_id" });
  }

  const token = zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
  const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${token}`;
  const results: any = {};

  try {
    console.log(`📝 Paso 1/2: Nota interna...`);
    const noteText = `[RESOLUCION] ${resolution_note || "Ticket resuelto"}`;
    const noteResult = await addNoteByTicketIdRaw(zapierUrl, String(ticket_id), noteText);
    results.note_added = "ok";

    console.log(`🔒 Paso 2/2: Cerrando...`);
    const closeResult = await callZapierMcp(zapierUrl, {
      selected_api: "ZendeskV2CLIAPI",
      action: "update_ticket_v2",
      instructions: `Update ticket ${ticket_id}. Set status to 'closed'. Execute immediately.`,
      params: {
        id: String(ticket_id),
        status: "closed"
      }
    }, "execute_zapier_write_action");
    results.ticket_closed = "ok";

    return res.json({
      status: "ok",
      message: `Ticket ${ticket_id} cerrado con nota`,
      steps: results,
      note_response: noteResult.note_result,
      close_response: closeResult
    });
  } catch (e: any) {
    console.error(`❌ Error: ${e}`);
    return res.status(500).json({ status: "partial", message: e.message, steps: results });
  }
});

	function parseSseBody(text: string): Record<string, any> {
	  const lines = text.split("\n");
	  for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("data:")) {
		  const raw = trimmed.substring(5).trim();
		  if (raw && raw !== "[DONE]") {
			try {
			  return JSON.parse(raw);
			} catch {
			  // Continuar si no es JSON válido
			}
		  }
		}
	  }
	  return {};
	}


// =====================================================
// VERSIÓN CORREGIDA (de server.ts) - MÁS ESTABLE
// =====================================================
	async function searchTicketById(zapierUrl: string, ticketId: string): Promise<any> {
	  console.log(`🔍 Buscando ticket con ID exacto: ${ticketId}`);
	  const searchResult = await callZapierMcp(zapierUrl, {
		selected_api: "ZendeskV2CLIAPI",
		action: "find_tickets_v2",
		instructions: `Search for the Zendesk ticket with EXACT numeric ID "${ticketId}". Use search query "id:${ticketId}". Do not perform a general/semantic search or look for this number in the subject or body.`,
		params: {
		  search: `id:${ticketId}`,
		},
		output: "id, subject, status",
	  }, "execute_zapier_read_action");

	  if (searchResult && searchResult.warning) {
		return searchResult;
	  }

	  let foundTickets: any[] = [];
	  if (typeof searchResult === "object" && searchResult !== null) {
		const results = searchResult.results;
		if (Array.isArray(results)) {
		  foundTickets = results;
		} else if (results && typeof results === "object") {
		  foundTickets = [results];
		} else if (Array.isArray(searchResult)) {
		  foundTickets = searchResult;
		} else if (searchResult.id) {
		  foundTickets = [searchResult];
		}
	  }

	  const exactTicket = foundTickets.find(
		(ticket: any) => ticket && String(ticket.id).trim() === String(ticketId).trim()
	  );

	  if (!exactTicket) {
		throw new Error(`No se encontró ningún ticket con el ID exacto: ${ticketId}`);
	  }

	  return {
		results: [exactTicket],
		id: exactTicket.id,
		subject: exactTicket.subject,
		status: exactTicket.status
	  };
	}

	async function addNoteByTicketId(
	  zapierUrl: string,
	  ticketId: string,
	  note: string
	): Promise<{ ticket_found: string; note_result: any }> {
	  const cleanTicketNum = ticketId.trim();
	  const isNumericId = /^\d+$/.test(cleanTicketNum);
	  let ticketSubject: string | null = null;
	  const subdomain = process.env.ZENDESK_SUBDOMAIN || "vipcosmetics";
	  const zendeskSub = subdomain.toLowerCase().trim();

	  if (isNumericId) {
		try {
		  console.log(`🔍 Buscando ticket con ID numérico: ${cleanTicketNum}`);
		  
		  // Usar API cruda para buscar el ticket (NO find_tickets_v2)
		  const result = await callZapierMcp(zapierUrl, {
			selected_api: "ZendeskV2CLIAPI",
			action: "_zap_raw_request",
			params: {
			  url: `https://${zendeskSub}.zendesk.com/api/v2/tickets/${cleanTicketNum}.json`,
			  method: "GET",
			  fail_on_errors: false
			}
		  });

		  // ============================================================
		  // PROBAR 5 FORMATOS DIFERENTES DE RESPUESTA
		  // ============================================================
		  
		  // Caso 1: result.ticket (estructura clásica)
		  if (result?.ticket?.subject) {
			ticketSubject = result.ticket.subject;
		  }
		  // Caso 2: result.results contiene directamente los datos del ticket
		  else if (result?.results?.subject) {
			ticketSubject = result.results.subject;
		  }
		  // Caso 3: result.results.ticket (doble envoltura)
		  else if (result?.results?.ticket?.subject) {
			ticketSubject = result.results.ticket.subject;
		  }
		  // Caso 4: el mismo result ya es el objeto ticket
		  else if (result?.subject) {
			ticketSubject = result.subject;
		  }
		  // Caso 5: buscar en result.raw.ticket
		  else if (result?.raw?.ticket?.subject) {
			ticketSubject = result.raw.ticket.subject;
		  }

		  if (ticketSubject) {
			console.log(`✅ Ticket encontrado: "${ticketSubject}"`);
		  }
		  
		} catch (error: any) {
		  console.log(`⚠️ API cruda falló: ${error.message}. Intentando find_tickets_v2...`);
		  
		  // Fallback con find_tickets_v2
		  try {
			const searchResult = await searchTicketById(zapierUrl, cleanTicketNum);
			if (searchResult && !searchResult.warning) {
			  if (searchResult?.results?.[0]?.subject) {
				ticketSubject = searchResult.results[0].subject;
			  } else if (searchResult?.subject) {
				ticketSubject = searchResult.subject;
			  }
			}
		  } catch (e: any) {
			console.log(`ℹ️ find_tickets_v2 también falló: ${e.message}`);
		  }
		}
	  }

	  // Si no se encontró, usar el ID como fallback
	  if (!ticketSubject) {
		console.log(`⚠️ No se encontró el subject. Usando ID: ${cleanTicketNum}`);
		ticketSubject = cleanTicketNum;
	  }

	  // Enviar la nota interna
	  const noteResult = await callZapierMcp(zapierUrl, {
		selected_api: "ZendeskV2CLIAPI",
		action: "ticket_comment",
		instructions: `Add an INTERNAL note to ticket with ID "${cleanTicketNum}". The note is: "${note}". Execute immediately.`,
		params: {
		  id: cleanTicketNum,
		  ticket: cleanTicketNum,
		  comment: note,
		  body: note,
		  public: "no"
		},
		output: "id, status, subject"
	  });

	  return {
		ticket_found: ticketSubject,
		note_result: noteResult,
	  };
	}

	async function searchTicketByIdRaw(zapierUrl: string, ticketId: string): Promise<any> {
	  const subdomain = process.env.ZENDESK_SUBDOMAIN || "vipcosmetics";
	  const zendeskSub = subdomain.toLowerCase().trim();
	  const zendeskApiBase = `https://${zendeskSub}.zendesk.com`;
	  const ticketUrl = `${zendeskApiBase}/api/v2/tickets/${ticketId}.json`;
	  console.log(`🔍 Obteniendo ticket #${ticketId} con GET desde ${zendeskApiBase}...`);
	  try {
		const result = await callZapierMcp(zapierUrl, {
		  selected_api: "ZendeskV2CLIAPI",
		  action: "_zap_raw_request",
		  params: {
			url: ticketUrl,
			method: "GET"
		  }
		});

		if (result && typeof result === "object") {
		  if (result.ticket && typeof result.ticket === "object" && "id" in result.ticket) {
			return result.ticket;
		  }

		  const results = result.results;
		  if (results && typeof results === "object" && "id" in results) {
			return results;
		  }

		  if (results && typeof results === "object") {
			const innerTicket = results.ticket;
			if (innerTicket && typeof innerTicket === "object" && "id" in innerTicket) {
			  return innerTicket;
			}
		  }

		  const raw = result.raw;
		  if (raw && typeof raw === "object") {
			const rawTicket = raw.ticket;
			if (rawTicket && typeof rawTicket === "object" && "id" in rawTicket) {
			  return rawTicket;
			}
		  }

		  if ("id" in result && "subject" in result) {
			return result;
		  }
		}
	  } catch (e: any) {
		console.error(`Error en API GET para #${ticketId}: ${e.message}`);
	  }

	  // Highly robust fallback using find_tickets_v2 search query
	  try {
		console.log(`🔍 [searchTicketByIdRaw Fallback] Buscando ticket #${ticketId} usando find_tickets_v2...`);
		const searchResult = await callZapierMcp(zapierUrl, {
		  selected_api: "ZendeskV2CLIAPI",
		  action: "find_tickets_v2",
		  instructions: `Search for the Zendesk ticket with EXACT numeric ID "${ticketId}". Use search query "id:${ticketId}". Do not perform a general/semantic search.`,
		  params: {
			search: `id:${ticketId}`,
		  },
		  output: "id, subject, status",
		}, "execute_zapier_read_action");

		let foundTickets: any[] = [];
		if (searchResult && typeof searchResult === "object") {
		  const results = searchResult.results;
		  if (Array.isArray(results)) {
			foundTickets = results;
		  } else if (results && typeof results === "object") {
			foundTickets = [results];
		  } else if (Array.isArray(searchResult)) {
			foundTickets = searchResult;
		  } else if (searchResult.id) {
			foundTickets = [searchResult];
		  }
		}

		const exactTicket = foundTickets.find(
		  (ticket: any) => ticket && String(ticket.id).trim() === String(ticketId).trim()
		);

		if (exactTicket) {
		  console.log(`✅ [searchTicketByIdRaw Fallback] Ticket #${ticketId} encontrado en fallback: ${exactTicket.subject}`);
		  return exactTicket;
		}
	  } catch (err: any) {
		console.error(`Error en fallback de find_tickets_v2 para #${ticketId}: ${err.message}`);
	  }

	  // Fallback using external_id search
	  try {
		console.log(`🔍 [searchTicketByIdRaw External ID Fallback] Buscando ticket con external_id:${ticketId} usando find_tickets_v2...`);
		const extSearch = await callZapierMcp(zapierUrl, {
		  selected_api: "ZendeskV2CLIAPI",
		  action: "find_tickets_v2",
		  instructions: `Search for ticket with external_id:${ticketId}`,
		  params: { search: `external_id:${ticketId}` },
		  output: "id, subject, status, external_id"
		}, "execute_zapier_read_action");

		let foundTickets: any[] = [];
		if (extSearch && typeof extSearch === "object") {
		  const results = extSearch.results;
		  if (Array.isArray(results)) {
			foundTickets = results;
		  } else if (results && typeof results === "object") {
			foundTickets = [results];
		  } else if (Array.isArray(extSearch)) {
			foundTickets = extSearch;
		  } else if (extSearch.id) {
			foundTickets = [extSearch];
		  }
		}

		const matchingTicket = foundTickets.find(
		  (ticket: any) => ticket && (String(ticket.external_id).trim() === String(ticketId).trim() || ticket.id)
		);

		if (matchingTicket) {
		  console.log(`✅ [searchTicketByIdRaw External ID Fallback] Ticket #${matchingTicket.id} encontrado por external_id: ${matchingTicket.subject}`);
		  return matchingTicket;
		}
	  } catch (err: any) {
		console.error(`Error en fallback de external_id para #${ticketId}: ${err.message}`);
	  }

	  return null;
	}

	async function getMacroById(zapierUrl: string, macroId: string): Promise<any> {
	  const subdomain = process.env.ZENDESK_SUBDOMAIN || "vipcosmetics";
	  const zendeskSub = subdomain.toLowerCase().trim();
	  const zendeskApiBase = `https://${zendeskSub}.zendesk.com`;
	  const macroUrl = `${zendeskApiBase}/api/v2/macros/${macroId}.json`;
	  console.log(`🔍 Obteniendo macro #${macroId}...`);
	  try {
		const result = await callZapierMcp(zapierUrl, {
		  selected_api: "ZendeskV2CLIAPI",
		  action: "_zap_raw_request",
		  params: {
			url: macroUrl,
			method: "GET"
		  }
		});

		if (result && typeof result === "object") {
		  const macroData = result.macro;
		  if (macroData) {
			return macroData;
		  }
		  if (result.results && typeof result.results === "object") {
			return result.results.macro || {};
		  }
		}
		return {};
	  } catch (e: any) {
		console.error(`Error obteniendo macro: ${e}`);
		throw e;
	  }
	}

	async function getTicketComments(zapierUrl: string, ticketId: string): Promise<any[]> {
	  const subdomain = process.env.ZENDESK_SUBDOMAIN || "vipcosmetics";
	  const zendeskSub = subdomain.toLowerCase().trim();
	  const zendeskApiBase = `https://${zendeskSub}.zendesk.com`;
	  const commentsUrl = `${zendeskApiBase}/api/v2/tickets/${ticketId}/comments.json`;
	  console.log(`💬 Obteniendo comentarios del ticket #${ticketId}...`);
	  try {
		const result = await callZapierMcp(zapierUrl, {
		  selected_api: "ZendeskV2CLIAPI",
		  action: "_zap_raw_request",
		  params: {
			url: commentsUrl,
			method: "GET"
		  }
		});

		if (result && typeof result === "object") {
		  const comments = result.comments;
		  if (comments && Array.isArray(comments)) {
			return comments;
		  }
		  if (result.results && typeof result.results === "object") {
			const resComments = result.results.comments;
			if (Array.isArray(resComments)) {
				return resComments;
			}
		  }
		}
		if (Array.isArray(result)) {
		  return result;
		}
		return [];
	  } catch (e: any) {
		console.error(`Error obteniendo comentarios: ${e}`);
		throw e;
	  }
	}

	async function getLatestComment(zapierUrl: string, ticketId: string): Promise<any> {
	  console.log(`💬 Obteniendo último comentario del ticket #${ticketId}...`);
	  try {
		const result = await callZapierMcp(zapierUrl, {
		  selected_api: "ZendeskV2CLIAPI",
		  action: "latest_comment",
		  instructions: `Find the latest comment for ticket with ID ${ticketId}. Return the comment body, whether it's public or internal, and the author.`,
		  params: {
			id: String(ticketId)
		  },
		  output: "id, body, public, created_at, author_id"
		}, "execute_zapier_read_action");

		return result ? result : null;
	  } catch (e: any) {
		console.error(`Error obteniendo último comentario: ${e}`);
		try {
		  const comments = await getTicketComments(zapierUrl, ticketId);
		  if (comments && comments.length > 0) {
			return comments[comments.length - 1];
		  }
		} catch (fallbackErr) {
		  console.error(`Error en fallback de último comentario: ${fallbackErr}`);
		}
		throw e;
	  }
	}

// =====================================================
	// VERSIÓN CORREGIDA - DELEGA A addNoteByTicketId
	// =====================================================
	async function addNoteByTicketIdRaw(
	  zapierUrl: string,
	  ticketId: string,
	  note: string
	): Promise<{ ticket_found: string; note_result: any }> {
	  console.log(`🚀 [addNoteByTicketIdRaw] Delegating to addNoteByTicketId for ticketId: ${ticketId}`);
	  return addNoteByTicketId(zapierUrl, ticketId, note);
	}

	// Helpers
	function censurarIntentosFallidos(texto: string): string {
	  if (!texto) return "";
	  const frasesProhibidas = [
		/we attempted to contact/gi,
		/attempted to contact/gi,
		/she did not respond/gi,
		/he did not respond/gi,
		/did not respond/gi,
		/left a voicemail/gi,
		/called but no answer/gi,
		/tried to contact/gi,
		/no answer/gi,
		/no response/gi,
		/we intend to communicate/gi
	  ];
	  let textoLimpio = texto;
	  for (const regex of frasesProhibidas) {
		textoLimpio = textoLimpio.replace(regex, "[AGENTE INTENTÓ CONTACTAR PERO CLIENTE NO RESPONDIÓ]");
	  }
	  return textoLimpio;
	}

	function corregirDiccion(texto: string): string {
	  if (!texto) return "";
	  let textoLimpio = texto;
	  textoLimpio = textoLimpio.replace(/\bchalem\b/gi, "Shalem");
	  textoLimpio = textoLimpio.replace(/\bchale\b/gi, "Shalem");
	  textoLimpio = textoLimpio.replace(/\bsalem\b/gi, "Shalem");
	  textoLimpio = textoLimpio.replace(/\bdocu sign\b/gi, "DocuSign");
	  textoLimpio = textoLimpio.replace(/\bdocusain\b/gi, "DocuSign");
	  textoLimpio = textoLimpio.replace(/\bjibik\b/gi, "GBK");
	  textoLimpio = textoLimpio.replace(/\byibikei\b/gi, "GBK");
	  textoLimpio = textoLimpio.replace(/\bgive back\b/gi, "GBK (Give Back)");
	  return textoLimpio;
	}

	async function guardarTimezone(taskId: string, tz: string) {
	  const filePath = path.join(process.cwd(), "src", "data", "timezones.json");
	  try {
		let data: any = {};
		try {
		  const content = await fsp.readFile(filePath, "utf-8");
		  data = JSON.parse(content);
		} catch (e) {
		  data = {};
		}
		data[taskId] = tz;
		await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
		await supabaseUpsert("timezones", data);
	  } catch (e) {
		console.error("Error writing timezones:", e);
	  }
	}

	async function obtenerTimezones(): Promise<any> {
	  const filePath = path.join(process.cwd(), "src", "data", "timezones.json");
	  try {
		const content = await fsp.readFile(filePath, "utf-8");
		return JSON.parse(content);
	  } catch (e) {
		return {};
	  }
	}

	async function guardarPhone(taskId: string, phone: string) {
	  const filePath = path.join(process.cwd(), "src", "data", "phones.json");
	  try {
		let data: any = {};
		try {
		  const content = await fsp.readFile(filePath, "utf-8");
		  data = JSON.parse(content);
		} catch (e) {
		  data = {};
		}
		data[taskId] = phone;
		await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
		await supabaseUpsert("phones", data);
	  } catch (e) {
		console.error("Error writing phones:", e);
	  }
	}

	async function obtenerPhones(): Promise<any> {
	  const filePath = path.join(process.cwd(), "src", "data", "phones.json");
	  try {
		const content = await fsp.readFile(filePath, "utf-8");
		return JSON.parse(content);
	  } catch (e) {
		return {};
	  }
	}

	async function guardarZendeskTicketId(taskId: string, ticketId: string) {
	  const filePath = path.join(process.cwd(), "src", "data", "zendesk_tickets.json");
	  try {
		let data: any = {};
		try {
		  const content = await fsp.readFile(filePath, "utf-8");
		  data = JSON.parse(content);
		} catch (e) {
		  data = {};
		}
		data[taskId] = ticketId;
		await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
		await supabaseUpsert("zendesk_tickets", data);
	  } catch (e: any) {
		console.warn("Warning writing zendesk tickets:", e.message);
	  }
	}

	async function obtenerZendeskTicketIds(): Promise<any> {
	  const filePath = path.join(process.cwd(), "src", "data", "zendesk_tickets.json");
	  try {
		const content = await fsp.readFile(filePath, "utf-8");
		return JSON.parse(content);
	  } catch (e) {
		return {};
	  }
	}

	async function findUserByEmail(zapierUrl: string, email: string): Promise<any> {
	  console.log(`🔍 Buscar usuario por email en Zendesk (con raw request primero): ${email}`);
	  const subdomain = process.env.ZENDESK_SUBDOMAIN || "vipcosmetics";
	  const zendeskSub = subdomain.toLowerCase().trim();
	  const searchUrl = `https://${zendeskSub}.zendesk.com/api/v2/users/search.json?query=email:${email}`;

	  try {
		const rawResult = await callZapierMcp(zapierUrl, {
		  selected_api: "ZendeskV2CLIAPI",
		  action: "_zap_raw_request",
		  instructions: `Make a GET request to search user by email. URL is "${searchUrl}".`,
		  params: {
			url: searchUrl,
			method: "GET",
			headers: {
			  "Content-Type": "application/json"
			}
		  },
		  output: "users"
		}, "execute_zapier_read_action");

		if (rawResult && rawResult.users && rawResult.users.length > 0) {
		  console.log(`✅ Usuario encontrado vía raw search: ${rawResult.users[0].id}`);
		  return rawResult.users[0];
		}
		if (rawResult && Array.isArray(rawResult) && rawResult.length > 0) {
		  console.log(`✅ Usuario encontrado vía raw array search: ${rawResult[0].id}`);
		  return rawResult[0];
		}
		if (rawResult && typeof rawResult === "object" && rawResult.results && Array.isArray(rawResult.results) && rawResult.results.length > 0) {
		  console.log(`✅ Usuario encontrado vía raw results: ${rawResult.results[0].id}`);
		  return rawResult.results[0];
		}
	  } catch (err: any) {
		console.log(`[findUserByEmail] raw search failed: ${err.message}. Trying standard search...`);
	  }

	  try {
		const searchResult = await callZapierMcp(zapierUrl, {
		  selected_api: "ZendeskV2CLIAPI",
		  action: "find_user",
		  instructions: `Find the Zendesk user with exact email address "${email}".`,
		  params: {
			query: `email:${email}`
		  },
		  output: "id, name, email"
		}, "execute_zapier_read_action");
		
		if (searchResult && !searchResult.warning) {
		  return searchResult;
		}
	  } catch (err: any) {
		console.warn("[findUserByEmail] standard find_user search also failed:", err.message);
	  }
	  return null;
	}

	async function findTicketByInvoice(zapierUrl: string, invoice: string): Promise<any> {
	  console.log(`🔍 Buscando ticket existente por Invoice en Zendesk (con raw request primero): ${invoice}`);
	  const subdomain = process.env.ZENDESK_SUBDOMAIN || "vipcosmetics";
	  const zendeskSub = subdomain.toLowerCase().trim();
	  const searchUrl = `https://${zendeskSub}.zendesk.com/api/v2/search.json?query=type:ticket "Caso Invoice: ${invoice}"`;

	  try {
		const rawResult = await callZapierMcp(zapierUrl, {
		  selected_api: "ZendeskV2CLIAPI",
		  action: "_zap_raw_request",
		  instructions: `Make a GET request to search ticket by invoice query. URL is "${searchUrl}".`,
		  params: {
			url: searchUrl,
			method: "GET"
		  },
		  output: "results"
		}, "execute_zapier_read_action");

		if (rawResult && typeof rawResult === "object") {
		  const results = rawResult.results || rawResult;
		  if (Array.isArray(results)) {
			const match = results.find((t: any) => t && t.subject && t.subject.includes(invoice));
			if (match) {
			  console.log(`✅ [Raw Search] Encontrado ticket existente de Zendesk para Invoice ${invoice}: ID ${match.id}`);
			  return match;
			}
		  }
		}
	  } catch (err: any) {
		console.log(`[findTicketByInvoice] raw search failed: ${err.message}. Trying standard search...`);
	  }

	  try {
		const searchResult = await callZapierMcp(zapierUrl, {
		  selected_api: "ZendeskV2CLIAPI",
		  action: "find_tickets_v2",
		  instructions: `Search for Zendesk tickets containing "Caso Invoice: ${invoice}" in the subject.`,
		  params: {
			search: `type:ticket "Caso Invoice: ${invoice}"`
		  },
		  output: "id, subject, status"
		}, "execute_zapier_read_action");
		
		let foundTickets: any[] = [];
		if (searchResult && typeof searchResult === "object") {
		  const results = searchResult.results;
		  if (Array.isArray(results)) {
			foundTickets = results;
		  } else if (results && typeof results === "object") {
			foundTickets = [results];
		  } else if (Array.isArray(searchResult)) {
			foundTickets = searchResult;
		  } else if (searchResult.id) {
			foundTickets = [searchResult];
		  }
		}

		const match = foundTickets.find((t: any) => t && t.subject && t.subject.includes(invoice));
		if (match) {
		  console.log(`✅ Encontrado ticket existente de Zendesk para Invoice ${invoice}: ID ${match.id}`);
		  return match;
		}
	  } catch (err: any) {
		console.warn("[findTicketByInvoice] standard search also failed:", err.message);
	  }
	  return null;
	}

	async function guardarAnsweredTime(taskId: string, timestampISO: string) {
	  const filePath = path.join(process.cwd(), "src", "data", "answered_times.json");
	  try {
		let data: any = {};
		try {
		  const content = await fsp.readFile(filePath, "utf-8");
		  data = JSON.parse(content);
		} catch (e) {
		  data = {};
		}
		data[taskId] = timestampISO;
		await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
		await supabaseUpsert("answered_times", data);
	  } catch (e) {
		console.error("Error writing answered times:", e);
	  }
	}

	async function obtenerAnsweredTimes(): Promise<any> {
	  const filePath = path.join(process.cwd(), "src", "data", "answered_times.json");
	  try {
		const content = await fsp.readFile(filePath, "utf-8");
		return JSON.parse(content);
	  } catch (e) {
		return {};
	  }
	}

	async function readJsonFile(filename: string): Promise<any> {
	  try {
		const filePath = path.join(process.cwd(), "src", "data", filename);
		const content = await fsp.readFile(filePath, "utf-8");
		return JSON.parse(content);
	  } catch (e) {
		console.error(`Error reading file ${filename}:`, e);
		return {};
	  }
	}

	async function seleccionarManualPorContexto(query: string): Promise<{ data: any; filename: string }> {
	  const q = query.toLowerCase();
	  let filename = "conocimiento_general.json";

	  if (["refund", "reembolso", "chargeback", "dispute", "banco", "tarjeta"].some(word => q.includes(word))) {
		filename = "conocimiento_finanzas.json";
	  } else if (["defective", "roto", "falta", "missing", "incompleto", "garantía", "dañado", "aparato"].some(word => q.includes(word))) {
		filename = "conocimiento_productos.json";
	  } else if (["primera llamada", "no se como empezar", "cliente dificil", "iniciar mi primera", "cómo empezar", "consejos"].some(word => q.includes(word))) {
		filename = "tips_llamada_primeraimpresion.json";
	  } else if (["fedex", "ups", "tracking", "guía", "envío", "deadline", "lost lead"].some(word => q.includes(word))) {
		filename = "conocimiento_logistica.json";
	  } else if (["malas reseñas", "bad reviews"].some(word => q.includes(word))) {
		filename = "procedimientos_prioritarios.json";
	  }

	  const data = await readJsonFile(filename);
	  return { data, filename };
	}

	function filtrarManualRelevante(query: string, manual: any): string {
	  const q = query.toLowerCase();
	  const contextFiltrado: any = {};

	  if (manual.procedimientos) {
		const relev: any[] = [];
		for (const p of manual.procedimientos) {
		  const words = q.split(/\s+/);
		  if (words.some(word => word.length > 2 && (p.tema.toLowerCase().includes(word) || p.instruccion.toLowerCase().includes(word)))) {
			relev.push(p);
		  }
		}
		contextFiltrado.procedimientos = relev.length > 0 ? relev : manual.procedimientos.slice(0, 2);
	  }

	  if (q.includes("disput") || q.includes("chargeback") || q.includes("banco")) {
		if (manual.refund_process && manual.refund_process.dispute_policy) {
		  contextFiltrado.dispute_policy = manual.refund_process.dispute_policy;
		}
	  }

	  if (q.includes("refund") || q.includes("reembolso") || q.includes("wire") || q.includes("transfer") || q.includes("cheque")) {
		if (manual.refund_process) {
		  contextFiltrado.refund_process = manual.refund_process;
		}
	  }

	  if (q.includes("defect") || q.includes("dañado") || q.includes("aparato")) {
		if (manual.defective_product_protocol) {
		  contextFiltrado.defective_product_protocol = manual.defective_product_protocol;
		}
	  }

	  if (q.includes("missing") || q.includes("faltan") || q.includes("incompleto")) {
		if (manual.missing_products_guide) {
		  contextFiltrado.missing_products_guide = manual.missing_products_guide;
		}
	  }

	  if (q.includes("deadline") || q.includes("lost lead") || q.includes("cerrar") || q.includes("cierre")) {
		if (manual.general_instructions && manual.general_instructions.seguimiento) {
		  contextFiltrado.deadline_rules = manual.general_instructions.seguimiento.deadline;
		}
	  }

	  if (q.includes("llamada") || q.includes("comenzar") || q.includes("empezar") || q.includes("cliente") || q.includes("voz") || q.includes("teléfono") || q.includes("telefono") || q.includes("mensaje")) {
		if (manual.comunicacion_telefonica) {
		  contextFiltrado.comunicacion_telefonica = manual.comunicacion_telefonica;
		}
	  }

	  return JSON.stringify(contextFiltrado, null, 2);
	}

	// Call Groq Llama completions with fallbacks for rate limits
	async function callGroq(prompt: string, systemMessage?: string, temperature = 0.1, responseJson = false): Promise<string> {
	  const url = "https://api.groq.com/openai/v1/chat/completions";
	  const messages: any[] = [];
	  if (systemMessage) {
		messages.push({ role: "system", content: systemMessage });
	  }
	  messages.push({ role: "user", content: prompt });

	  const groqModels = [
		"llama-3.3-70b-versatile",
		"llama-3.1-8b-instant",
		"mixtral-8x7b-32768"
	  ];

	  let lastError: any = null;

	  for (const modelName of groqModels) {
		try {
		  console.log(`🤖 [callGroq] Attempting request using Groq model: ${modelName}...`);
		  const response = await fetch(url, {
			method: "POST",
			headers: {
			  "Authorization": `Bearer ${GROQ_API_KEY}`,
			  "Content-Type": "application/json"
			},
			body: JSON.stringify({
			  messages,
			  model: modelName,
			  temperature,
			  response_format: responseJson ? { type: "json_object" } : undefined
			})
		  });

		  if (response.ok) {
			const data = await response.json() as any;
			console.log(`✅ [callGroq] Groq response successful with model: ${modelName}.`);
			return data.choices[0].message.content || "";
		  } else {
			const errorText = await response.text();
			console.warn(`⚠️ [callGroq] Groq API error for model ${modelName} (status ${response.status}): ${errorText}`);
			lastError = new Error(`Groq API error (status ${response.status}): ${errorText}`);
		  }
		} catch (err: any) {
		  console.warn(`⚠️ [callGroq] Groq API call failed for model ${modelName}: ${err.message}`);
		  lastError = err;
		}
	  }

	  console.error(`❌ [callGroq] All Groq models failed or rate-limited. Trying Gemini fallback...`);
	  try {
		if (process.env.GEMINI_API_KEY) {
		  console.log(`🤖 [callGroq] Falling back to Gemini gemini-3.5-flash...`);
		  const { GoogleGenAI } = await import("@google/genai");
		  const ai = new GoogleGenAI({
			apiKey: process.env.GEMINI_API_KEY,
			httpOptions: {
			  headers: {
				'User-Agent': 'aistudio-build',
			  }
			}
		  });

		  const response = await ai.models.generateContent({
			model: "gemini-3.5-flash",
			contents: prompt,
			config: {
			  systemInstruction: systemMessage,
			  temperature,
			  responseMimeType: responseJson ? "application/json" : undefined,
			}
		  });

		  if (response.text) {
			console.log(`✅ [callGroq] Gemini fallback response successful.`);
			return response.text;
		  }
		}
	  } catch (geminiErr: any) {
		console.warn(`⚠️ [callGroq] Gemini fallback also failed: ${geminiErr.message}`);
	  }

	  throw lastError || new Error("All Groq models failed.");
	}

	async function isCustomerResponseLLM(commentText: string): Promise<[boolean, string]> {
	  if (commentText.trim().length < 10) {
		return [false, "corto"];
	  }

	  const prompt = `Read this customer service log. I only need to know ONE simple thing: DID THE CUSTOMER ACTUALLY REPLY OR TAKE AN EXPLICIT ACTION IN THIS LOG? Yes or No.

	  ABSOLUTE RULES:
	  1. ZERO ASSUMPTIONS: If the log only describes what the AGENT did, tried to do, or wanted to do (e.g., "attempted to contact", "informed her", "required her", "sent an email"), the answer is NO.
	  2. PASSIVE VOICE = NO: If the text says "The customer was informed" or "She was required", that is the agent acting. The customer did NOTHING. Answer: NO.
	  3. THE "YES" CRITERIA: The answer is ONLY TRUE if there is undeniable proof that the customer spoke, wrote, or physically acted (e.g., "She said...", "She replied...", "She sent the ID...", "Customer confirmed...").
	  4. CENSOR TAGS: If you see the tag "[AGENTE INTENTÓ CONTACTAR PERO CLIENTE NO RESPONDIÓ]", it means the contact FAILED. Answer: NO.

	  Return ONLY JSON: {"is_customer_response": true/false, "reason": "If true, quote the exact action the customer took. If false, output 'Agent actions only'."}
	  Log: "${commentText}"`;

	  try {
		const resString = await callGroq(prompt, "You are a precise classifier analyzing customer service response validity.", 0, true);
		const parsed = JSON.parse(resString);
		return [parsed.is_customer_response || false, parsed.reason || ""];
	  } catch (e) {
		console.error("Error in isCustomerResponseLLM:", e);
		return [false, String(e)];
	  }
	}

	async function getClickupHeaders() {
	  return {
		"Authorization": CLICKUP_API_KEY,
		"Content-Type": "application/json"
	  };
	}

	function normalizeClickUpStatus(status: string): string {
	  if (!status) return "cs reply";
	  const lower = status.trim().toLowerCase();
	  if (lower === "closed" || lower === "lost lead") {
		return "Closed";
	  }
	  const valid = ["new", "internal waiting", "shipment follow up", "deadline", "cs reply"];
	  if (valid.includes(lower)) {
		return lower;
	  }
	  // Fallbacks:
	  if (lower === "dispute" || lower === "disputes") {
		return "cs reply";
	  }
	  return "cs reply";
	}

	async function fetchTaskComments(taskId: string, limit = 15): Promise<string> {
	  const dias = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
	  try {
		const url = `https://api.clickup.com/api/v2/task/${taskId}/comment`;
		const response = await fetch(url, { headers: { "Authorization": CLICKUP_API_KEY } });
		if (response.ok) {
		  const data = await response.json() as any;
		  const comments = data.comments || [];
		  const clean: string[] = [];
		  for (const c of comments) {
			const text = c.comment_text || "";
			if (text.length > 5) {
			  const textLimpio = censurarIntentosFallidos(text);
			  const dateMs = parseInt(c.date);
			  const dt = new Date(dateMs);
			  const dayName = dias[dt.getDay() === 0 ? 6 : dt.getDay() - 1];
			  const fechaStr = `${dayName} ${dt.getDate().toString().padStart(2, "0")}/${(dt.getMonth() + 1).toString().padStart(2, "0")}/${dt.getFullYear()}`;
			  clean.push(`(Fecha: ${fechaStr}) -> ${textLimpio.slice(0, 350)}`);
			}
		  }
		  return clean.slice(0, limit).join(" | ");
		}
	  } catch (e) {
		console.error("Error fetching task comments:", e);
	  }
	  return "";
	}

	async function fetchAllActiveTasks(): Promise<any[]> {
	  const tasks: any[] = [];
	  let page = 0;
	  try {
		while (true) {
		  const url = `https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task?include_closed=false&subtasks=true&page=${page}`;
		  const response = await fetch(url, { headers: { "Authorization": CLICKUP_API_KEY } });
		  if (response.ok) {
			const data = await response.json() as any;
			const pageTasks = data.tasks || [];
			if (pageTasks.length === 0) {
			  break;
			}
			tasks.push(...pageTasks);
			page += 1;
		  } else {
			console.error("ClickUp pagination error:", await response.text());
			break;
		  }
		}
	  } catch (e) {
		console.error("Error fetching tasks:", e);
	  }
	  return tasks;
	}

	async function getReasonUuid(textReason: string): Promise<string | null> {
	  const reasonOptions = await readJsonFile("reason_options.json");
	  const options = reasonOptions.options || [];
	  const found = options.find((opt: any) => opt.name.toLowerCase() === textReason.toLowerCase());
	  return found ? found.id : null;
	}

	async function getSpecificReasonMap(): Promise<any> {
	  const reasonOptions = await readJsonFile("reason_options.json");
	  const map: any = {};
	  for (const opt of (reasonOptions.options || [])) {
		map[opt.name] = opt.id;
	  }
	  return map;
	}

	async function getLatestCustomerResponse(taskId: string): Promise<[Date | null, string | null, number | null]> {
	  try {
		const url = `https://api.clickup.com/api/v2/task/${taskId}/comment?order_by=date&order=desc`;
		const response = await fetch(url, { headers: { "Authorization": CLICKUP_API_KEY } });
		if (!response.ok) {
		  return [null, null, null];
		}
		const data = await response.json() as any;
		const comments = data.comments || [];
		// Sort descending by date
		comments.sort((a: any, b: any) => parseInt(b.date) - parseInt(a.date));

		for (const c of comments) {
		  const text = c.comment_text || "";
		  if (text.length < 10) continue;

		  const textoCensurado = censurarIntentosFallidos(text);
		  const [isResp] = await isCustomerResponseLLM(textoCensurado);
		  if (isResp) {
			const dateMs = parseInt(c.date);
			const dt = new Date(dateMs);
			const diffMs = Date.now() - dateMs;
			const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
			return [dt, textoCensurado, days];
		  }
		}
	  } catch (e) {
		console.error("Error in getLatestCustomerResponse:", e);
	  }
	  return [null, null, null];
	}

	async function analyzeStatusTrigger(text: string): Promise<string> {
	  const textLower = text.toLowerCase();
	  if (textLower.includes("disputa") || textLower.includes("dispute") || textLower.includes("chargeback")) {
		return "dispute";
	  }
	  if (["waiting for a tn", "waiting for a tracking", "waiting for tracking", "esperando guía", "esperando tracking", "tn pending"].some(frase => textLower.includes(frase))) {
		return "internal waiting";
	  }

	  try {
		const { data: manual } = await seleccionarManualPorContexto(text);
		const manualFiltrado = filtrarManualRelevante(text, manual);

		const prompt = `Analiza el texto de un comentario y clasifícalo en uno de los estatus oficiales de ClickUp.
			
	REGLAS E INSTRUCCIONES OPERATIVAS (CONOCIMIENTO.JSON):
	${manualFiltrado}

	Reglas base de prioridad:
	1. Si el cliente NO respondió o estamos esperando que el cliente responda -> cs reply
	2. Si se menciona enviar un plazo límite, advertencia final o enviar deadline -> deadline
	3. Si ya pasaron los días del plazo y se cierra el caso -> lost lead
	4. Si hay disputa ("dispute", "chargeback") -> dispute
	5. Si hay tracking, número de guía (tracking number / TN) o el paquete YA va en camino o ya se envió -> shipment follow up.
	   🚨 REGLA CRÍTICA DE EXCLUSIÓN: Comentarios que digan que se enviará un reemplazo ("we will send a replacement", "se enviará un reemplazo") o que se enviarán productos ("we will send the Hidra Silk Serum"), pero que aún NO tengan número de guía (tracking number / TN) física ni hayan sido enviados físicamente, NO deben ir a "shipment follow up" (shipping). Estos comentarios de resolución o intención de envío corresponden a "internal waiting" o "cs reply".
	6. Si hay espera interna, autorización, o se menciona "waiting for a TN", o se está gestionando/ofreciendo enviar un reemplazo o producto pero aún no hay tracking -> internal waiting. 🚨 EXCEPCIÓN CRÍTICA: Si el comentario describe un intento de contacto (ej. "attempted to contact", "intentamos contactar"), haber dejado un mensaje (ej. "leave a message", "left a message", "dejó mensaje"), o estar esperando que la cliente elija o decida algo (ej. "product selection", "waiting for her to choose", "esperando que responda/seleccione"), esto NO es una espera interna de la empresa, sino que estamos esperando al cliente. Por lo tanto, debe clasificarse estrictamente como "cs reply" y NUNCA como "internal waiting".
	7. Si recibió paquete -> cs reply
	8. Si el agente indica que se procede a cerrar el caso, o que la tarea/ticket se cerrará o está cerrada -> closed
	9. Si el comentario describe un monólogo del agente, un intento de llamada/contacto fallido, o estar esperando que el cliente responda, actúe o elija un producto de compensación (ej. "regarding the product selection for compensation"), el estatus debe ser "cs reply". JAMÁS debe ser "internal waiting".

	Texto del comentario a evaluar: '${text}'

	Responde ÚNICAMENTE el nombre exacto del estatus en minúsculas (ej. cs reply, deadline, lost lead, internal waiting, shipment follow up, dispute, closed, none). No agregues puntos, ni explicaciones.`;

		let status = (await callGroq(prompt, "You are a precise ClickUp status router classifier.")).trim().toLowerCase();
		
		// Post-process correction to enforce the user's rule programmatically
		const isWillSendOrAddressing = (textLower.includes("will send") || textLower.includes("enviara") || textLower.includes("se le enviara") || textLower.includes("addressing the issue") || textLower.includes("mandar un reemplazo") || textLower.includes("send a replacement") || textLower.includes("enviar un reemplazo"));
		const hasTrackingNumberOrGuia = (textLower.includes("tracking number") || textLower.includes("numero de guia") || textLower.includes("guia:") || textLower.includes("tracking:") || textLower.includes("fedex:") || textLower.includes("usps:") || textLower.includes("ups:"));
		
		if (status === "shipment follow up" && isWillSendOrAddressing && !hasTrackingNumberOrGuia) {
		  console.log(`⚠️ Corrección manual de estatus: Comentario con intención de envío sin guía real. Forzando 'internal waiting' en vez de 'shipment follow up'.`);
		  status = "internal waiting";
		}

		// Correct internal waiting to cs reply if it represents a contact attempt or waiting for the customer's selection/response
		const textLowerNormalized = textLower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
		const isContactAttemptOrWaitingForCustomer = (
		  textLowerNormalized.includes("attempted to contact") ||
		  textLowerNormalized.includes("attempted to call") ||
		  textLowerNormalized.includes("tried to contact") ||
		  textLowerNormalized.includes("tried to call") ||
		  textLowerNormalized.includes("try to contact") ||
		  textLowerNormalized.includes("try to call") ||
		  textLowerNormalized.includes("intento contactar") ||
		  textLowerNormalized.includes("intentamos contactar") ||
		  textLowerNormalized.includes("se intento contactar") ||
		  textLowerNormalized.includes("intentando contactar") ||
		  textLowerNormalized.includes("dejamos mensaje") ||
		  textLowerNormalized.includes("dejo mensaje") ||
		  textLowerNormalized.includes("dejar mensaje") ||
		  textLowerNormalized.includes("left a message") ||
		  textLowerNormalized.includes("leave a message") ||
		  textLowerNormalized.includes("waiting for the customer") ||
		  textLowerNormalized.includes("waiting for the client") ||
		  textLowerNormalized.includes("waiting for her") ||
		  textLowerNormalized.includes("waiting for him") ||
		  textLowerNormalized.includes("waiting for response") ||
		  textLowerNormalized.includes("waiting for reply") ||
		  textLowerNormalized.includes("esperando respuesta") ||
		  textLowerNormalized.includes("esperando seleccion") ||
		  textLowerNormalized.includes("esperando que responda") ||
		  textLowerNormalized.includes("esperando que elija") ||
		  textLowerNormalized.includes("product selection") ||
		  textLowerNormalized.includes("selection for compensation")
		);

		if (status === "internal waiting" && isContactAttemptOrWaitingForCustomer) {
		  console.log(`⚠️ Corrección manual de estatus: Comentario de intento de contacto o espera de selección/respuesta del cliente. Forzando 'cs reply' en vez de 'internal waiting'.`);
		  status = "cs reply";
		}

		const valid = ["cs reply", "shipment follow up", "internal waiting", "deadline", "lost lead", "closed", "dispute", "none"];
		const matched = valid.includes(status) ? status : "none";
		if (matched === "closed" || matched === "lost lead") {
		  return "Closed";
		}
		return matched;
	  } catch (e) {
		console.error("Error analyzing status dynamically:", e);
		return "none";
	  }
	}

	// --- Citrix ShareFile Normalization Adapter (Abstracción de Aislamiento) ---
	function normalizeShareFileItem(r: any): any {
	  if (!r) return null;
	  
	  // Un resultado de búsqueda puede contener el item bajo .Item o .item, o directamente en el objeto raíz
	  const innerItem = r.Item || r.item || (r.Id || r.id || r.ItemId || r.itemId || r.ItemID || r.StreamID || r.streamID ? r : null);
	  if (innerItem) {
		const parentObj = r.Parent || r.parent || r.ParentItem || r.parentItem || innerItem.Parent || innerItem.parent;
		const isFolder = 
		  innerItem["odata.type"]?.includes("Folder") || 
		  innerItem.typename === "Folder" || 
		  innerItem.typename === "folder" ||
		  innerItem.FileCount !== undefined ||
		  innerItem.fileCount !== undefined ||
		  innerItem.type === "Folder" ||
		  innerItem.type === "folder";

		const resolvedId = innerItem.Id || innerItem.id || innerItem.ItemId || innerItem.itemId || innerItem.ItemID || r.Id || r.id || r.ItemId || r.itemId || r.ItemID;
		const resolvedName = innerItem.Name || innerItem.name || innerItem.FileName || innerItem.filename || r.Name || r.name || r.FileName || r.filename || "Elemento sin nombre";

		let parentId = parentObj?.Id || parentObj?.id || innerItem.ParentId || innerItem.parentId || innerItem.ParentID || r.ParentId || r.parentId;
		let parentName = parentObj?.Name || parentObj?.name || innerItem.ParentName || innerItem.parentName || r.ParentName || r.parentName;

		// Fallback robusto desde el path si no se tiene nombre del padre
		const itemPath = innerItem.Path || innerItem.path || r.Path || r.path;
		if (!parentName && typeof itemPath === "string" && itemPath.length > 0) {
		  const parts = itemPath.split("/").filter(Boolean);
		  if (parts.length > 1) {
			parentName = parts[parts.length - 2];
		  }
		}

		return {
		  ...innerItem,
		  Id: resolvedId,
		  id: resolvedId,
		  Name: resolvedName,
		  name: resolvedName,
		  ParentId: parentId,
		  ParentName: parentName,
		  SearchScore: r.Score || r.score || r.SearchScore || r.searchScore || 0,
		  "odata.type": innerItem["odata.type"] || innerItem.typename || (isFolder ? "ShareFile.Api.Models.Folder" : "ShareFile.Api.Models.File"),
		  FileCount: innerItem.FileCount !== undefined ? innerItem.FileCount : innerItem.fileCount,
		  FileSizeBytes: innerItem.FileSizeBytes !== undefined ? innerItem.FileSizeBytes : innerItem.fileSizeBytes || innerItem.size,
		  CreationDate: innerItem.CreationDate || innerItem.creationDate || innerItem.CreatedDate || innerItem.createdDate || innerItem.Created || innerItem.created || r.CreationDate || r.creationDate
		};
	  }
	  
	  const isFolder = 
		r["odata.type"]?.includes("Folder") || 
		r.typename === "Folder" || 
		r.typename === "folder" ||
		r.FileCount !== undefined ||
		r.fileCount !== undefined ||
		r.type === "Folder" ||
		r.type === "folder";

	  const resolvedIdDirect = r.Id || r.id || r.ItemId || r.itemId || r.ItemID;
	  const resolvedNameDirect = r.Name || r.name || r.FileName || r.filename || "Elemento sin nombre";
	  const parentObjDirect = r.Parent || r.parent || r.ParentItem || r.parentItem;

	  let parentId = parentObjDirect?.Id || parentObjDirect?.id || r.ParentId || r.parentId || r.ParentID;
	  let parentName = parentObjDirect?.Name || parentObjDirect?.name || r.ParentName || r.parentName;

	  const itemPath = r.Path || r.path;
	  if (!parentName && typeof itemPath === "string" && itemPath.length > 0) {
		const parts = itemPath.split("/").filter(Boolean);
		if (parts.length > 1) {
		  parentName = parts[parts.length - 2];
		}
	  }

	  return {
		...r,
		Id: resolvedIdDirect,
		id: resolvedIdDirect,
		Name: resolvedNameDirect,
		name: resolvedNameDirect,
		ParentId: parentId,
		ParentName: parentName,
		"odata.type": r["odata.type"] || r.typename || (isFolder ? "ShareFile.Api.Models.Folder" : "ShareFile.Api.Models.File"),
		FileCount: r.FileCount !== undefined ? r.FileCount : r.fileCount,
		FileSizeBytes: r.FileSizeBytes !== undefined ? r.FileSizeBytes : r.fileSizeBytes || r.size,
		CreationDate: r.CreationDate || r.creationDate || r.CreatedDate || r.createdDate || r.Created || r.created
	  };
	}

	// Helper para procesar filtros y paginación a nivel de Backend (Ahorro masivo de recursos)
	function applyBackendFiltersAndPagination(items: any[], query: any): any[] {
	  let result = [...items];

	  // 1. Filtrar por tipo de archivo (ej. jpg, pdf)
	  const fileType = query.fileType;
	  if (fileType) {
		const ext = String(fileType).toLowerCase().trim();
		result = result.filter(item => {
		  const name = (item.Name || item.name || "").toLowerCase();
		  return name.endsWith(`.${ext}`) || name.endsWith(`.jpeg`);
		});
	  }

	  // 2. Filtrar por tamaño mínimo en bytes
	  const minSize = query.minSize ? parseInt(String(query.minSize), 10) : NaN;
	  if (!isNaN(minSize)) {
		result = result.filter(item => {
		  const size = item.FileSizeBytes !== undefined ? item.FileSizeBytes : (item.fileSizeBytes || item.size || 0);
		  return size >= minSize;
		});
	  }

	  // 3. Filtrar por tamaño máximo en bytes
	  const maxSize = query.maxSize ? parseInt(String(query.maxSize), 10) : NaN;
	  if (!isNaN(maxSize)) {
		result = result.filter(item => {
		  const size = item.FileSizeBytes !== undefined ? item.FileSizeBytes : (item.fileSizeBytes || item.size || 0);
		  return size <= maxSize;
		});
	  }

	  // 4. Filtrar por año de creación
	  const year = query.year ? parseInt(String(query.year), 10) : NaN;
	  if (!isNaN(year)) {
		result = result.filter(item => {
		  const dateStr = item.CreationDate || item.creationDate || item.CreatedDate || item.createdDate || item.Created || item.created;
		  if (!dateStr) return false;
		  try {
			const d = new Date(dateStr);
			return d.getFullYear() === year;
		  } catch {
			return false;
		  }
		});
	  }

	  // 5. Filtrar por rango de fechas (dateFrom y dateTo)
	  const dateFrom = query.dateFrom ? new Date(String(query.dateFrom)) : null;
	  const dateTo = query.dateTo ? new Date(String(query.dateTo)) : null;

	  if (dateFrom || dateTo) {
		if (dateFrom && !isNaN(dateFrom.getTime())) {
		  dateFrom.setHours(0, 0, 0, 0);
		}
		if (dateTo && !isNaN(dateTo.getTime())) {
		  dateTo.setHours(23, 59, 59, 999);
		}

		result = result.filter(item => {
		  const dateStr = item.CreationDate || item.creationDate || item.CreatedDate || item.createdDate || item.Created || item.created;
		  if (!dateStr) return false;
		  try {
			const d = new Date(dateStr);
			if (isNaN(d.getTime())) return false;
			if (dateFrom && d < dateFrom) return false;
			if (dateTo && d > dateTo) return false;
			return true;
		  } catch {
			return false;
		  }
		});
	  }

	  // 6. Filtrar por parentId o ruta (Búsqueda restringida a subdirectorios)
	  const parentId = query.parentId;
	  if (parentId) {
		result = result.filter(item => {
		  const itemParentId = item.ParentId || item.parentId || item.ParentID;
		  if (itemParentId === parentId) return true;
		  
		  // Comprobar si el Path contiene el parentId
		  const itemPath = item.Path || item.path;
		  if (typeof itemPath === "string" && itemPath.includes(String(parentId))) {
			return true;
		  }
		  return false;
		});
	  }

	  // 7. Aplicar Paginación (skip / top)
	  const rawSkip = query.skip || query.$skip;
	  const rawTop = query.top || query.$top;
	  const skipVal = rawSkip ? parseInt(String(rawSkip), 10) : 0;
	  const topVal = rawTop ? parseInt(String(rawTop), 10) : NaN;

	  if (skipVal > 0) {
		result = result.slice(skipVal);
	  }
	  if (!isNaN(topVal) && topVal > 0) {
		result = result.slice(0, topVal);
	  }

	  return result;
	}

	// Helper to calculate business days between two dates (excluding Saturdays and Sundays)
	function getBusinessDaysDiff(startDate: Date, endDate: Date): number {
	  let count = 0;
	  const curDate = new Date(startDate.getTime());
	  curDate.setHours(0, 0, 0, 0);
	  const targetDate = new Date(endDate.getTime());
	  targetDate.setHours(0, 0, 0, 0);

	  if (curDate > targetDate) {
		return 0;
	  }

	  while (curDate < targetDate) {
		curDate.setDate(curDate.getDate() + 1);
		const day = curDate.getDay();
		if (day !== 0 && day !== 6) { // 0 is Sunday, 6 is Saturday
		  count++;
		}
	  }
	  return count;
	}

	// Helper to save auto closed tasks to a local log file
	async function saveAutoClosedLog(taskId: string, taskName: string, daysPassed: number) {
	  const filePath = path.join(process.cwd(), "src", "data", "auto_closed_tasks_log.json");
	  let data: { logs: any[] } = { logs: [] };
	  try {
		const content = await fsp.readFile(filePath, "utf-8");
		data = JSON.parse(content);
	  } catch (e) {
		data = { logs: [] };
	  }

	  const newEntry = {
		id: taskId,
		name: taskName,
		closedAt: new Date().toISOString(),
		daysPassed,
		message: "esta tarea se ha cerrado por qeu h aoasado mas de cuatro dias en deadline"
	  };

	  // Avoid duplicate entries within 24 hours
	  const isDuplicate = data.logs.some(log => log.id === taskId && (Date.now() - new Date(log.closedAt).getTime() < 24 * 60 * 60 * 1000));
	  if (!isDuplicate) {
		data.logs.push(newEntry);
		if (data.logs.length > 100) {
		  data.logs.shift();
		}
		try {
		  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
		  await supabaseUpsert("auto_closed_logs", data);
		} catch (err) {
		  console.error("Error saving auto closed logs:", err);
		}
	  }
	}

	// Background Task: Auto checks every hour and executes deadline migrations
	async function checkAndCloseLostLeads() {
	  console.log("⏰ Automated check and close lost leads job initiated.");
	  try {
		const tasks = await fetchAllActiveTasks();
		const myTasks = tasks.filter((t: any) => t.assignees && t.assignees.some((a: any) => String(a.id) === String(ID_DONNA)));
		const now = new Date();

		for (const task of myTasks) {
		  const due = task.due_date;
		  if (!due) continue;

		  const dueMs = parseInt(due);
		  // Use business days excluding Saturdays and Sundays
		  const daysSinceDue = getBusinessDaysDiff(new Date(dueMs), now);

		  if (daysSinceDue >= 4) {
			const currentStatus = (task.status?.status || "").toLowerCase();

			if (currentStatus === "cs reply") {
			  const comment = `⏰ ALERTA: ${daysSinceDue} días hábiles sin respuesta del cliente. Se escala a estatus DEADLINE. Prohibido cerrar directamente.`;
			  // Comment to ClickUp
			  await fetch(`https://api.clickup.com/api/v2/task/${task.id}/comment`, {
				method: "POST",
				headers: { "Authorization": CLICKUP_API_KEY, "Content-Type": "application/json" },
				body: JSON.stringify({ comment_text: comment })
			  });
			  // Update status to deadline
			  await fetch(`https://api.clickup.com/api/v2/task/${task.id}`, {
				method: "PUT",
				headers: { "Authorization": CLICKUP_API_KEY, "Content-Type": "application/json" },
				body: JSON.stringify({ status: "deadline" })
			  });
			  console.log(`Task moved to DEADLINE: ${task.id}`);
			} else if (currentStatus === "deadline") {
			  // Use exact Spanish text requested by Donna: "esta tarea se ha cerrado por qeu h aoasado mas de cuatro dias en deadline"
			  const comment = `esta tarea se ha cerrado por qeu h aoasado mas de cuatro dias en deadline`;
			  // Comment to ClickUp
			  await fetch(`https://api.clickup.com/api/v2/task/${task.id}/comment`, {
				method: "POST",
				headers: { "Authorization": CLICKUP_API_KEY, "Content-Type": "application/json" },
				body: JSON.stringify({ comment_text: comment })
			  });
			  // Update status to Closed
			  await fetch(`https://api.clickup.com/api/v2/task/${task.id}`, {
				method: "PUT",
				headers: { "Authorization": CLICKUP_API_KEY, "Content-Type": "application/json" },
				body: JSON.stringify({ status: "Closed" })
			  });
			  console.log(`Task closed under LOST LEAD: ${task.id}`);
			  
			  // Log it locally
			  await saveAutoClosedLog(task.id, task.name || "Sin nombre", daysSinceDue);
			}
		  }
		}
	  } catch (e) {
		console.error("Error in automated background job:", e);
	  }
	}

	// Set up background checking interval (every 12 hours)
	setInterval(checkAndCloseLostLeads, 1000 * 60 * 60 * 12);

	// =============================================
	// API Endpoints
	// =============================================

	// Helper to decode JWT token to inspect expiration and details
	function decodeJwt(token: string) {
	  try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const payloadBase64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const decodedJson = Buffer.from(payloadBase64, "base64").toString("utf-8");
		return JSON.parse(decodedJson);
	  } catch (e) {
		console.error("Failed to decode JWT:", e);
		return null;
	  }
	}

	// 3a. Citrix ShareFile (shared_api) Diagnostic & Verification Endpoint
	app.get("/api/sharefile/diagnostic", async (req, res) => {
	  const token = process.env.SHAREFILE_ACCESS_TOKEN;
	  const apiBaseUrl = process.env.SHAREFILE_API_BASE_URL;

	  if (!token || !apiBaseUrl) {
		return res.json({
		  configured: false,
		  error: "Variables SHAREFILE_ACCESS_TOKEN y SHAREFILE_API_BASE_URL no encontradas en el archivo .env."
		});
	  }

	  const decoded = decodeJwt(token);
	  const nowSecs = Math.floor(Date.now() / 1000);
	  
	  let expired = false;
	  let expDate = "";
	  let timeLeftMinutes = 0;

	  if (decoded && decoded.exp) {
		expired = decoded.exp < nowSecs;
		expDate = new Date(decoded.exp * 1000).toISOString();
		timeLeftMinutes = Math.round((decoded.exp - nowSecs) / 60);
	  }

	  const baseUrl = apiBaseUrl.replace(/\/$/, "");
	  let apiTestStatus = "unknown";
	  let apiTestMessage = "";
	  let contactsEnabled = false;
	  let usersEnabled = false;

	  try {
		// 1. Test Contacts Endpoint
		const url = `${baseUrl}/Contacts?$top=1`;
		const sfResponse = await fetch(url, {
		  headers: { 
			"Authorization": `Bearer ${token}`,
			"Accept": "application/json"
		  }
		});

		let isUnauthorized = false;

		if (sfResponse.ok) {
		  contactsEnabled = true;
		  apiTestStatus = "success";
		  apiTestMessage = "Conectado exitosamente con Citrix ShareFile (API de Contactos habilitada).";
		} else {
		  const errText = await sfResponse.text();
		  if (sfResponse.status === 401) {
			isUnauthorized = true;
		  }
		  if (sfResponse.status === 405 || errText.includes("EnableSecondaryDbContacts")) {
			// Contacts are restricted, try to test Users endpoint as fallback
			apiTestStatus = "fallback_needed";
			apiTestMessage = "API de Contactos deshabilitada (requiere EnableSecondaryDbContacts). Intentando fallback de Usuarios...";
			console.log("[Diagnostic Info] Contacts endpoint restricted (EnableSecondaryDbContacts), using Users directory fallback.");
		  } else {
			apiTestStatus = "failed";
			apiTestMessage = `Error en API de Contactos (${sfResponse.status}): ${errText}`;
			console.warn("[Diagnostic Info - Contacts Check]", sfResponse.status, errText);
		  }
		}

		// 2. Test Users Endpoint (Fallback directory)
		const userUrl = `${baseUrl}/Users?$top=1`;
		const userResponse = await fetch(userUrl, {
		  headers: { 
			"Authorization": `Bearer ${token}`,
			"Accept": "application/json"
		  }
		});

		if (userResponse.ok) {
		  usersEnabled = true;
		  if (apiTestStatus === "fallback_needed") {
			apiTestStatus = "success_with_fallback";
			apiTestMessage = "¡Listo! API de Contactos está deshabilitada por su cuenta, pero la API de Usuarios está activa para fallback.";
		  }
		} else {
		  const userErrText = await userResponse.text();
		  if (userResponse.status === 401) {
			isUnauthorized = true;
		  }
		  console.warn("[Diagnostic Info - Users Check]", userResponse.status, userErrText);
		}

		if (isUnauthorized) {
		  expired = true;
		  apiTestStatus = "unauthorized";
		  apiTestMessage = "La autenticación de Citrix ShareFile falló (401 Unauthorized). El token de acceso ha expirado o no es válido.";
		}

	  } catch (e: any) {
		apiTestStatus = "error";
		apiTestMessage = `Error de conexión de red: ${e.message}`;
	  }

	  res.json({
		configured: true,
		baseUrl,
		tokenPayload: decoded,
		expired,
		expDate,
		timeLeftMinutes,
		apiTestStatus,
		apiTestMessage,
		contactsEnabled,
		usersEnabled
	  });
	});

	// Citrix ShareFile Credentials Management Endpoints
	app.get("/api/sharefile/config", async (req, res) => {
	  try {
		const baseUrl = process.env.SHAREFILE_API_BASE_URL || "";
		let subdomain = "MorenaMiaBeautyGroup";
		if (baseUrl) {
		  const match = baseUrl.match(/https?:\/\/([^.]+)\.(?:sf-api\.com|sharefile\.com)/i);
		  if (match && match[1]) {
			subdomain = match[1];
		  }
		}
		res.json({
		  success: true,
		  baseUrl: baseUrl,
		  subdomain: subdomain,
		  clientId: process.env.SHAREFILE_CLIENT_ID || "",
		  username: process.env.SHAREFILE_USERNAME || "",
		  isOauthConfigured: !!(process.env.SHAREFILE_CLIENT_ID && process.env.SHAREFILE_CLIENT_SECRET),
		  hasToken: !!process.env.SHAREFILE_ACCESS_TOKEN,
		  hasPassword: !!process.env.SHAREFILE_PASSWORD
		});
	  } catch (err: any) {
		res.status(500).json({ success: false, error: err.message });
	  }
	});

	app.post("/api/sharefile/config", async (req, res) => {
	  try {
		const { baseUrl, subdomain, clientId, clientSecret, username, token, password } = req.body;

		// Update active environment variables
		if (baseUrl) {
		  process.env.SHAREFILE_API_BASE_URL = baseUrl;
		} else if (subdomain) {
		  process.env.SHAREFILE_API_BASE_URL = `https://${subdomain}.sf-api.com/sf/v3/`;
		}

		if (clientId) process.env.SHAREFILE_CLIENT_ID = clientId;
		if (clientSecret) process.env.SHAREFILE_CLIENT_SECRET = clientSecret;
		if (username) process.env.SHAREFILE_USERNAME = username;
		if (token) process.env.SHAREFILE_ACCESS_TOKEN = token;
		if (password) process.env.SHAREFILE_PASSWORD = password;

		// Write to .env to persist across server restarts
		const envPath = path.join(process.cwd(), ".env");
		let envLines: string[] = [];
		if (fs.existsSync(envPath)) {
		  const envContent = await fsp.readFile(envPath, "utf-8");
		  envLines = envContent.split("\n");
		}

		const setEnvVar = (key: string, value: string) => {
		  const idx = envLines.findIndex(line => line.trim().startsWith(`${key}=`));
		  if (idx !== -1) {
			envLines[idx] = `${key}="${value}"`;
		  } else {
			envLines.push(`${key}="${value}"`);
		  }
		};

		if (process.env.SHAREFILE_API_BASE_URL) setEnvVar("SHAREFILE_API_BASE_URL", process.env.SHAREFILE_API_BASE_URL);
		if (process.env.SHAREFILE_CLIENT_ID) setEnvVar("SHAREFILE_CLIENT_ID", process.env.SHAREFILE_CLIENT_ID);
		if (process.env.SHAREFILE_CLIENT_SECRET) setEnvVar("SHAREFILE_CLIENT_SECRET", process.env.SHAREFILE_CLIENT_SECRET);
		if (process.env.SHAREFILE_USERNAME) setEnvVar("SHAREFILE_USERNAME", process.env.SHAREFILE_USERNAME);
		if (process.env.SHAREFILE_ACCESS_TOKEN) setEnvVar("SHAREFILE_ACCESS_TOKEN", process.env.SHAREFILE_ACCESS_TOKEN);
		if (process.env.SHAREFILE_PASSWORD) setEnvVar("SHAREFILE_PASSWORD", process.env.SHAREFILE_PASSWORD);

		await fsp.writeFile(envPath, envLines.join("\n"), "utf-8");
		await backupEnvToSupabase();

		res.json({ success: true });
	  } catch (err: any) {
		res.status(500).json({ success: false, error: err.message });
	  }
	});

	// Robust Groq OCR endpoint
	app.post("/api/ocr", async (req, res) => {
	  try {
		const { imageBase64, mimeType } = req.body;

		if (!imageBase64) {
		  return res.status(400).json({ success: false, error: "No image data provided" });
		}

		console.log("[OCR Request] Running OCR on image...");
		const result = await ocrWithGroq(imageBase64, mimeType);

		res.json({
		  success: true,
		  telefono: result.telefono,
		  texto_completo: result.texto_completo
		});

	  } catch (e: any) {
		console.error("[OCR API Error]", e);
		res.status(500).json({ success: false, error: e.message });
	  }
	});

	// Citrix ShareFile OCR directly from Item ID
	app.post("/api/sharefile/ocr-from-item", async (req, res) => {
	  try {
		const { itemId } = req.body;
		if (!itemId) {
		  return res.status(400).json({ success: false, error: "itemId is required" });
		}

		const token = process.env.SHAREFILE_ACCESS_TOKEN;
		const apiBaseUrl = process.env.SHAREFILE_API_BASE_URL;
		const apiKey = process.env.GROQ_API_KEY;

		// Force simulated OCR fallback for all demo item IDs
		const isDemoItem = String(itemId).startsWith("fida6f93-");

		if (isDemoItem || !token || !apiBaseUrl || !apiKey) {
		  console.log(`[ShareFile OCR Fallback] Using simulated OCR (isDemoItem=${isDemoItem}, tokenConfigured=${!!token}).`);
		  // Simulate a tiny delay for realistic effect
		  await new Promise(r => setTimeout(r, 1200));
		  
		  let demoPhone = "+52 55 " + Math.floor(10000000 + Math.random() * 90000000);
		  if (itemId === "fida6f93-a3a5-2ea0-c174-5eee5e020526") {
			demoPhone = "+52 55 9876 5432";
		  } else if (itemId === "fida6f93-a3a5-2ea0-c174-5eee5e020527") {
			demoPhone = "+52 99 8765 4321";
		  } else if (itemId === "fida6f93-a3a5-2ea0-c174-5eee5e020528") {
			demoPhone = "+52 984 123 4567";
		  }

		  return res.json({
			success: true,
			isDemo: true,
			telefono: demoPhone,
			texto_completo: `MORENA MIA BEAUTY GROUP\nDIRECCIÓN: AV. TULUM SM 5, CANCÚN\nFECHA: 28/06/2026\nINVOICE ID: ${itemId}\nCLIENTE: CONTACTO DE PRUEBA\nTELÉFONO: ${demoPhone}\nCONCEPTO: SERVICIO SPA PREMIUM\nTOTAL: $249.00 USD\n`
		  });
		}

		const baseUrl = apiBaseUrl.replace(/\/$/, "");
		const downloadUrl = `${baseUrl}/Items(${itemId})/Download`;
		console.log(`[ShareFile OCR API] Fetching download URL: ${downloadUrl}`);
		
		const sfRes = await fetch(downloadUrl, {
		  headers: {
			"Authorization": `Bearer ${token}`
		  },
		  redirect: "manual"
		});

		let finalDownloadUrl = downloadUrl;
		if (sfRes.status === 301 || sfRes.status === 302 || sfRes.status === 307 || sfRes.status === 308) {
		  const location = sfRes.headers.get("location");
		  if (location) {
			finalDownloadUrl = location;
		  }
		} else if (sfRes.ok) {
		  if (sfRes.headers.get("content-type")?.includes("application/json")) {
			const json = await sfRes.json();
			finalDownloadUrl = json.DownloadUrl || downloadUrl;
		  } else {
			finalDownloadUrl = sfRes.url;
		  }
		} else {
		  const text = await sfRes.text();
		  if (sfRes.status === 401) {
			throw new Error("Su token de acceso de Citrix ShareFile ha expirado o es inválido (Error 401). Por favor actualice el archivo .env con un token activo.");
		  }
		  throw new Error(`Error de ShareFile al iniciar descarga: Código ${sfRes.status}. ${text}`);
		}

		console.log(`[ShareFile OCR API] Downloading binary from: ${finalDownloadUrl}`);
		const dataRes = await fetch(finalDownloadUrl);
		if (!dataRes.ok) {
		  throw new Error(`Error al descargar archivo binario desde el CDN de ShareFile: Código ${dataRes.status}`);
		}

		const arrayBuffer = await dataRes.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
		const base64 = buffer.toString("base64");

		console.log(`[ShareFile OCR API] Downloaded ${buffer.length} bytes. Transcribing...`);

		const result = await ocrWithGroq(base64, "image/jpeg");

		res.json({
		  success: true,
		  isDemo: false,
		  telefono: result.telefono,
		  texto_completo: result.texto_completo
		});

	  } catch (e: any) {
		console.error("[ShareFile OCR API Error - Falling back to Mock]", e);
		let demoPhone = "+52 55 " + Math.floor(10000000 + Math.random() * 90000000);
		const itemId = req.body.itemId || "unknown";
		if (itemId === "fida6f93-a3a5-2ea0-c174-5eee5e020526") {
		  demoPhone = "+52 55 9876 5432";
		} else if (itemId === "fida6f93-a3a5-2ea0-c174-5eee5e020527") {
		  demoPhone = "+52 99 8765 4321";
		} else if (itemId === "fida6f93-a3a5-2ea0-c174-5eee5e020528") {
		  demoPhone = "+52 984 123 4567";
		}
		res.json({
		  success: true,
		  isDemo: true,
		  telefono: demoPhone,
		  texto_completo: `MORENA MIA BEAUTY GROUP\nDIRECCIÓN: AV. TULUM SM 5, CANCÚN\nFECHA: 28/06/2026\nINVOICE ID: ${itemId}\nCLIENTE: CONTACTO DE PRUEBA\nTELÉFONO: ${demoPhone}\nCONCEPTO: SERVICIO SPA PREMIUM\nTOTAL: $249.00 USD\n`,
		  warning: `Las credenciales de ShareFile o OCR fallaron (${e.message}). Mostrando OCR de demostración.`
		});
	  }
	});

	// Today Tasks
	app.get("/api/today-tasks", async (req, res) => {
	  try {
		const tasks = await fetchAllActiveTasks();
		const now = new Date();
		// End of today
		const endOfToday = new Date();
		endOfToday.setHours(23, 59, 59, 999);
		const endOfTodayMs = endOfToday.getTime();

		const todayTasks: any[] = [];
		const timezonesMap = await obtenerTimezones();
		const phonesMap = await obtenerPhones();
		const answeredTimesMap = await obtenerAnsweredTimes();

		const tzOrder = ["NST", "AST", "EST", "CST", "MST", "PHX", "PST", "AKST", "HST"];
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

		const myTasks = tasks.filter((t: any) => t.assignees && t.assignees.some((a: any) => String(a.id) === String(ID_DONNA)));

		for (const t of myTasks) {
		  const due = t.due_date;
		  const tzTag = timezonesMap[t.id] || "EST";
		  const timezoneZone = tzOficiales[tzTag] || "America/New_York";
		  const answeredAt = answeredTimesMap[t.id] || null;

		  const clientLocalTime = new Intl.DateTimeFormat("en-US", {
			timeZone: timezoneZone,
			hour: "2-digit",
			minute: "2-digit",
			hour12: true
		  }).format(now);

		  const priorityIndex = tzOrder.indexOf(tzTag) !== -1 ? tzOrder.indexOf(tzTag) : 99;

		  // Resolve phone from JSON map or custom fields
		  let phoneVal = phonesMap[t.id] || "";
		  if (!phoneVal) {
			const phoneField = (t.custom_fields || []).find((f: any) => 
			  f.name && typeof f.name === "string" && (
				f.name.toLowerCase().includes("phone") || 
				f.name.toLowerCase().includes("teléfono") || 
				f.name.toLowerCase().includes("telefono")
			  )
			);
			if (phoneField && phoneField.value !== undefined) {
			  phoneVal = phoneField.value;
			}
		  }

		  const priorityValue = t.priority?.priority || "normal";

		  if (!due) {
			todayTasks.push({
			  id: t.id,
			  name: t.name,
			  status: t.status?.status || "cs reply",
			  url: t.url,
			  due_date: "HOY",
			  local_time: clientLocalTime,
			  tz_tag: tzTag,
			  phone: phoneVal,
			  sort_val: priorityIndex,
			  answered_at: answeredAt,
			  priority: priorityValue
			});
		  } else {
			const dueMs = parseInt(due);
			if (dueMs < endOfTodayMs) {
			  const dt = new Date(dueMs);
			  const fechaStr = `${dt.getDate().toString().padStart(2, "0")}/${(dt.getMonth() + 1).toString().padStart(2, "0")}/${dt.getFullYear()}`;
			  todayTasks.push({
				id: t.id,
				name: t.name,
				status: t.status?.status || "cs reply",
				url: t.url,
				due_date: fechaStr,
				local_time: clientLocalTime,
				tz_tag: tzTag,
				phone: phoneVal,
				sort_val: priorityIndex,
				answered_at: answeredAt,
				priority: priorityValue
			  });
			}
		  }
		}

		// Sort east-to-west zone priority
		todayTasks.sort((a, b) => a.sort_val - b.sort_val);
		todayTasks.forEach(item => delete item.sort_val);

		res.json({ tasks: todayTasks });
	  } catch (error: any) {
		res.status(500).json({ error: error.message });
	  }
	});

	// Pending Cases
	app.get("/api/pending-cases", async (req, res) => {
	  try {
		const tasks = await fetchAllActiveTasks();
		const myTasks = tasks.filter((t: any) => t.assignees && t.assignees.some((a: any) => String(a.id) === String(ID_DONNA)));
		const formatted = myTasks.map((t: any) => {
		  const due = t.due_date;
		  const dueStr = due ? new Date(parseInt(due)).toLocaleDateString("es-ES") : "Sin fecha";
		  return {
			id: t.id,
			name: t.name,
			status: t.status?.status || "unknown",
			url: t.url,
			due_date: dueStr
		  };
		});
		res.json({ cases: formatted });
	  } catch (error: any) {
		res.status(500).json({ error: error.message });
	  }
	});

	// Helper functions for US Area Code distribution history
	async function guardarHistoricoDistribucion(distribucion: Record<string, number>, totalClients: number) {
	  const filePath = path.join(process.cwd(), "src", "data", "historical_metrics.json");
	  let data: { history: any[] } = { history: [] };
	  try {
		const content = await fsp.readFile(filePath, "utf-8");
		data = JSON.parse(content);
	  } catch (e) {
		data = { history: [] };
	  }

	  const newEntry = {
		timestamp: new Date().toISOString(),
		distribution: distribucion,
		total_clients: totalClients
	  };

	  // Avoid saving duplicate distributions if they are identical and less than 5 minutes old
	  const lastEntry = data.history[data.history.length - 1];
	  const isDuplicate = lastEntry && 
		JSON.stringify(lastEntry.distribution) === JSON.stringify(distribucion) &&
		(Date.now() - new Date(lastEntry.timestamp).getTime() < 5 * 60 * 1000);

	  if (!isDuplicate) {
		data.history.push(newEntry);
		if (data.history.length > 50) {
		  data.history.shift();
		}
		try {
		  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
		  await supabaseUpsert("historical_metrics", data);
		} catch (err) {
		  console.error("Error saving historical metrics:", err);
		}
	  }
	}

	async function obtenerHistoricoDistribucion(): Promise<any[]> {
	  const filePath = path.join(process.cwd(), "src", "data", "historical_metrics.json");
	  try {
		const content = await fsp.readFile(filePath, "utf-8");
		const data = JSON.parse(content);
		return data.history || [];
	  } catch (e) {
		return [];
	  }
	}

	// Metrics
	app.get("/api/metrics", async (req, res) => {
	  try {
		const tasks = await fetchAllActiveTasks();
		const phonesMap = await obtenerPhones();
		
		const stateCounts: Record<string, number> = {};
		let totalWithPhone = 0;
		let totalWithUSState = 0;
		
		for (const t of tasks) {
		  let phoneVal = phonesMap[t.id] || "";
		  if (!phoneVal) {
			const phoneField = (t.custom_fields || []).find((f: any) => 
			  f.name && (
				f.name.toLowerCase().includes("phone") || 
				f.name.toLowerCase().includes("tel")
			  )
			);
			if (phoneField && phoneField.value !== undefined) {
			  phoneVal = phoneField.value;
			}
		  }
		  
		  if (phoneVal) {
			totalWithPhone += 1;
			const state = getStateByPhone(phoneVal);
			if (state) {
			  stateCounts[state] = (stateCounts[state] || 0) + 1;
			  totalWithUSState += 1;
			} else {
			  stateCounts["Otros / No US"] = (stateCounts["Otros / No US"] || 0) + 1;
			}
		  } else {
			stateCounts["Sin teléfono"] = (stateCounts["Sin teléfono"] || 0) + 1;
		  }
		}
		
		// Calculate percentages
		const totalClients = tasks.length || 1;
		const distribution: Record<string, number> = {};
		for (const [state, count] of Object.entries(stateCounts)) {
		  distribution[state] = Math.round((count / totalClients) * 100 * 10) / 10;
		}
		
		// Save to history
		await guardarHistoricoDistribucion(distribution, totalClients);
		
		// Get full history for graphing
		const historyData = await obtenerHistoricoDistribucion();
		
		res.json({
		  metrics: {
			...metrics,
			state_distribution: distribution,
			total_active_clients: totalClients,
			total_with_phone: totalWithPhone,
			total_with_us_state: totalWithUSState,
			history: historyData
		  }
		});
	  } catch (err: any) {
		console.error("Error in /api/metrics:", err);
		res.json({
		  metrics: {
			...metrics,
			state_distribution: {},
			total_active_clients: 0,
			total_with_phone: 0,
			total_with_us_state: 0,
			history: []
		  }
		});
	  }
	});

	// API endpoint for retrieving auto-closed task logs
	app.get("/api/auto-closed-logs", async (req, res) => {
	  const filePath = path.join(process.cwd(), "src", "data", "auto_closed_tasks_log.json");
	  try {
		const content = await fsp.readFile(filePath, "utf-8");
		const data = JSON.parse(content);
		res.json({ logs: data.logs || [] });
	  } catch (e) {
		res.json({ logs: [] });
	  }
	});

	// Verify address
	app.post("/api/verify-tax-address", (req, res) => {
	  const { address } = req.body;
	  logMetric("tax_address_check", 0.1, { address });
	  res.json({ valid: true, message: "Verificación fiscal simulada exitosa" });
	});
	
	async function callZapierMcp(zapierUrl: string, params: any, toolName: string = "execute_zapier_write_action") {
  if (!params.output && params.action !== "_zap_raw_request") {
    params.output = "id, status, subject";
  }

  // Extract token from zapierUrl and check if it is legacy; if so, override with the new valid token
  let finalZapierUrl = zapierUrl;
  try {
    const urlObj = new URL(zapierUrl);
    const token = urlObj.searchParams.get("token");
    if (token) {
      const decoded = Buffer.from(token, "base64").toString("utf8");
      // (Opcional: detección de token legacy, mantenlo como estaba originalmente)
    }
  } catch (e) {
    // Ignore URL parse error
  }

  const payload = {
    jsonrpc: "2.0" as const,
    id: 1,
    method: "tools/call" as const,
    params: {
      name: toolName,
      arguments: params,
    },
  };

  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream"
  };

  console.log(`📡 Zapier MCP (callZapierMcp) → ${toolName}`);
  console.log(`📦 Params:`, JSON.stringify(params, null, 2));

  let response;
  try {
    response = await fetch(finalZapierUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
  } catch (fetchErr: any) {
    const errString = `${fetchErr.message || ""} ${fetchErr.stack || ""}`.toLowerCase();
    const isQuotaError = errString.includes("402") || 
                        errString.includes("payment required") || 
                        errString.includes("insufficient tasks") || 
                        errString.includes("zapierfacadeerror");

    if (isQuotaError) {
      throw new Error("Límite de tareas excedido en Zapier (402 Payment Required). Por favor, actualiza tu plan en Zapier, recarga tu saldo de tareas o espera a que se reinicie tu cupo de tareas mensuales.");
    }

    console.log(`⚠️ Zapier MCP connection failed: ${fetchErr.message}`);
    return { success: false, warning: `Network connection failed: ${fetchErr.message}`, results: [] };
  }

  if (!response.ok) {
    const errText = await response.text();
    const textLower = (errText || "").toLowerCase();
    const statusTextLower = (response.statusText || "").toLowerCase();
    const isQuotaError = response.status === 402 || 
                        statusTextLower.includes("payment required") || 
                        textLower.includes("insufficient tasks") || 
                        textLower.includes("payment required") || 
                        textLower.includes("zapierfacadeerror");

    if (isQuotaError) {
      throw new Error("Límite de tareas excedido en Zapier (402 Payment Required). Por favor, actualiza tu plan en Zapier, recarga tu saldo de tareas o espera a que se reinicie tu cupo de tareas mensuales.");
    }

    if (response.status === 404 || errText.includes("not found or invalid secret") || errText.includes("-31999")) {
      console.log(`⚠️ Zapier MCP is unconfigured or token is invalid (HTTP ${response.status}). Skipping.`);
      return { success: false, warning: `Zapier unconfigured (HTTP ${response.status})`, results: [] };
    }
    if (response.status === 504 || errText.includes("504 ERROR") || errText.includes("The request could not be satisfied") || errText.includes("Gateway Time-out")) {
      throw new Error("La integración de Zapier/Zendesk experimentó un tiempo de espera (504 Gateway Timeout). Por favor, intenta de nuevo en unos momentos.");
    }
    throw new Error(`Error HTTP de Zapier: ${response.statusText} (${response.status}) - ${errText.substring(0, 400)}`);
  }

  const responseText = await response.text();
  const contentType = response.headers.get("content-type") || "";

  let body: any;

  // Detect and parse SSE
  if (contentType.includes("text/event-stream") || responseText.trim().startsWith("event:")) {
    body = parseSseBody(responseText);
  } else {
    try {
      body = JSON.parse(responseText);
    } catch {
      body = parseSseBody(responseText);
    }
  }

  if (body.error) {
    const errorString = JSON.stringify(body.error).toLowerCase();
    const isBodyQuotaError = errorString.includes("402") || 
                            errorString.includes("payment required") || 
                            errorString.includes("insufficient tasks") || 
                            errorString.includes("zapierfacadeerror");

    if (isBodyQuotaError) {
      throw new Error("Límite de tareas excedido en Zapier (402 Payment Required). Por favor, actualiza tu plan en Zapier, recarga tu saldo de tareas o espera a que se reinicie tu cupo de tareas mensuales.");
    }

    const msgLower = (body.error.message || "").toLowerCase();
    if (msgLower && (msgLower.includes("not found") || msgLower.includes("notfound") || msgLower.includes("secret") || body.error.code === -31999)) {
      console.log(`⚠️ Zapier MCP Error (Gracefully handled): ${body.error.message}`);
      return { success: false, warning: body.error.message, results: [] };
    }
    
    const errorStringRaw = JSON.stringify(body.error);
    if (errorStringRaw.includes("504") || errorStringRaw.includes("Gateway Time-out") || errorStringRaw.includes("The request could not be satisfied") || errorStringRaw.includes("<!DOCTYPE") || errorStringRaw.includes("<HTML")) {
      throw new Error("La integración de Zapier/Zendesk experimentó un tiempo de espera (504 Gateway Timeout) al comunicarse con el servidor. Por favor, intenta de nuevo en unos momentos.");
    }
    
    throw new Error(`Zapier MCP error: ${errorStringRaw}`);
  }

  const result = body.result;
  if (result) {
    const resultStr = JSON.stringify(result).toLowerCase();
    const isResultQuotaError = result.isError === true || 
                               resultStr.includes("402") || 
                               resultStr.includes("payment required") || 
                               resultStr.includes("insufficient tasks") || 
                               resultStr.includes("zapierfacadeerror");

    if (isResultQuotaError && (resultStr.includes("insufficient tasks") || resultStr.includes("402") || resultStr.includes("payment required") || resultStr.includes("zapierfacadeerror"))) {
      throw new Error("Límite de tareas excedido en Zapier (402 Payment Required). Por favor, actualiza tu plan en Zapier, recarga tu saldo de tareas o espera a que se reinicie tu cupo de tareas mensuales.");
    }
  }

  const content = result?.content || [];
  
  if (content.length === 0) {
    return { raw: body };
  }

  const rawText = content[0]?.text || "{}";

  try {
    const parsed = JSON.parse(rawText);
    console.log(`✅ Respuesta parseada:`, JSON.stringify(parsed, null, 2));

    if (parsed && typeof parsed === "object") {
      const parsedStr = JSON.stringify(parsed).toLowerCase();
      const isParsedQuotaError = parsed.isError === true || 
                                 parsedStr.includes("402") || 
                                 parsedStr.includes("payment required") || 
                                 parsedStr.includes("insufficient tasks") || 
                                 parsedStr.includes("zapierfacadeerror");

      if (isParsedQuotaError && (parsedStr.includes("insufficient tasks") || parsedStr.includes("402") || parsedStr.includes("payment required") || parsedStr.includes("zapierfacadeerror"))) {
        throw new Error("Límite de tareas excedido en Zapier (402 Payment Required). Por favor, actualiza tu plan en Zapier, recarga tu saldo de tareas o espera a que se reinicie tu cupo de tareas mensuales.");
      }
    }

    return parsed;
  } catch (err: any) {
    if (err.message && err.message.includes("Límite de tareas excedido")) {
      throw err;
    }
    console.log(`✅ Respuesta texto:`, rawText);
    return { raw: rawText };
  }
}

	// Update Task Timezone
	app.post("/api/update-timezone", async (req, res) => {
	  const { task_id, timezone } = req.body;
	  await guardarTimezone(task_id, timezone);
	  logMetric("timezone_updated_manually", 0.05, { task_id, timezone });

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

	  const zone = tzOficiales[timezone] || "America/New_York";
	  const newLocalTime = new Intl.DateTimeFormat("en-US", {
		timeZone: zone,
		hour: "2-digit",
		minute: "2-digit",
		hour12: true
	  }).format(new Date());

	  res.json({ status: "ok", new_time: newLocalTime, tz_tag: timezone });
	});

	// Spy Custom Field Options
	app.get("/api/spy-options", async (req, res) => {
	  const fieldId = req.query.field_id as string;
	  const url = `https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/field`;
	  try {
		const response = await fetch(url, { headers: { "Authorization": CLICKUP_API_KEY } });
		if (!response.ok) {
		  return res.status(400).json({ error: "Error obteniendo campos de ClickUp" });
		}
		const data = await response.json() as any;
		const fields = data.fields || [];

		if (fieldId) {
		  const target = fields.find((f: any) => f.id === fieldId);
		  if (!target) {
			return res.status(404).json({ error: "Campo no encontrado" });
		  }
		  const options = target.type_config?.options || [];
		  return res.json({
			field_id: target.id,
			field_name: target.name,
			options: options.map((opt: any) => ({ name: opt.name, id: opt.id }))
		  });
		}

		res.json({
		  fields: fields.map((f: any) => ({
			id: f.id,
			name: f.name,
			type: f.type,
			has_options: !!f.type_config?.options
		  }))
		});
	  } catch (error: any) {
		res.status(500).json({ error: error.message });
	  }
	});

	// AI Search Engine
	app.post("/api/ai-search", async (req, res) => {
	  const startTime = Date.now();
	  const { query } = req.body;

	  try {
		const { data: manual, filename: sourceFilename } = await seleccionarManualPorContexto(query);
		const tasks = await fetchAllActiveTasks();
		const myTasks = tasks.filter((t: any) => t.assignees && t.assignees.some((a: any) => String(a.id) === String(ID_DONNA)));

		const numbers = query.match(/\b\d{4,}\b/g) || [];
		const possibleIdMatch = query.match(/\b([a-f0-9]{8,})\b/i);
		const queryTokens = query.toLowerCase().match(/\b[a-zA-Záéíóúüñ]{3,}\b/g) || [];

		let target: any = null;
		let suggestions: any[] = [];

		if (possibleIdMatch) {
		  const tid = possibleIdMatch[1];
		  target = myTasks.find((t: any) => t.id === tid);
		}
		if (!target && numbers.length > 0) {
		  for (const num of numbers) {
			target = myTasks.find((t: any) => t.name.includes(num));
			if (target) break;
		  }
		}
		if (!target) {
		  const qlower = query.toLowerCase();
		  target = myTasks.find((t: any) => t.name.toLowerCase().includes(qlower));
		}
		if (!target && queryTokens.length > 0) {
		  const scored = myTasks.map((t: any) => {
			const score = queryTokens.reduce((acc, token) => acc + (t.name.toLowerCase().includes(token) ? 1 : 0), 0);
			return { score, task: t };
		  }).filter(s => s.score > 0);

		  if (scored.length > 0) {
			scored.sort((a, b) => b.score - a.score);
			target = scored[0].task;
			if (scored.length > 1 && scored[0].score === scored[1].score) {
			  suggestions = scored.slice(0, 3).map(s => s.task);
			}
		  }
		}

		if (!target && suggestions.length === 0) {
		  const resumenTareas = myTasks.map((t: any) => `- ${t.name} (ID: ${t.id}) | Estatus: ${t.status?.status.toUpperCase()}`).join("\n");

		  const promptGlobal = `Eres Donna, la asistente ejecutiva de inteligencia artificial. El usuario no buscó un ticket en específico, sino que está platicando contigo.
				
				CONSULTA DEL USUARIO: ${query}
				
				INVENTARIO ACTUAL DE TODAS TUS TAREAS ACTIVAS:
				${resumenTareas ? resumenTareas : "No hay tareas asignadas actualmente."}
				
				INSTRUCCIONES:
				1. Actúa como una IA conversacional súper inteligente (estilo ChatGPT o Claude). Sé amigable y profesional.
				2. Si el usuario te pide un resumen de los estatus, cuéntale cuántas tareas tienes y en qué estatus están basándote en tu Inventario.
				3. Si hace una pregunta general o te saluda, platica con él de forma natural.
				4. Si te pregunta por *comentarios específicos* de todas las tareas a la vez, explícale amablemente que, por seguridad de memoria, necesitas que te diga el nombre o ID de una tarea en específico para sumergirte en ese historial.`;

		  const answer = await callGroq(promptGlobal, "Eres una asistente conversacional de alto nivel. Puedes dar reportes generales del inventario de tareas.", 0.4);
		  const elapsed = (Date.now() - startTime) / 1000;
		  logMetric("ai_search_global", elapsed, { query });
		  return res.json({ found: false, answer, task_url: null, source_file: sourceFilename });
		}

		if (suggestions.length > 0) {
		  const txt = suggestions.map((s: any) => `- ${s.name} (ID: ${s.id})`).join("\n");
		  return res.json({ found: false, answer: `Posibles casos encontrados:\n${txt}\nUsa el ID exacto para buscar.`, source_file: sourceFilename });
		}

		// Detail analysis on specific target
		const [fechaUlt, textoUlt, diasSin] = await getLatestCustomerResponse(target.id);
		const hilo = await fetchTaskComments(target.id, 30);

		let comentariosCompletos = hilo;
		try {
		  const resC = await fetch(`https://api.clickup.com/api/v2/task/${target.id}/comment`, { headers: { "Authorization": CLICKUP_API_KEY } });
		  if (resC.ok) {
			const dataC = await resC.json() as any;
			const allComments = dataC.comments || [];
			allComments.sort((a: any, b: any) => parseInt(b.date) - parseInt(a.date));
			for (const c of allComments) {
			  const cText = c.comment_text || "";
			  comentariosCompletos += " " + cText;
			  const cTextLimpio = censurarIntentosFallidos(cText);
			  const cTextLower = cTextLimpio.toLowerCase();
			  if (cTextLower.includes("she claimed to have received") || cTextLower.includes("the client contacted us") || cTextLower.includes("she claimed")) {
				const cDateMs = parseInt(c.date);
				if (cDateMs) {
				  const fUlt = new Date(cDateMs);
				  const dSin = Math.floor((Date.now() - cDateMs) / (1000 * 60 * 60 * 24));
				  // Update with found values
				  comentariosCompletos += ` [Vestige detected date: ${fUlt.toISOString()}, Days: ${dSin}]`;
				}
			  }
			}
		  }
		} catch (err) {
		  console.error("Error detecting vestige in comments:", err);
		}

		const trackingNumbers = comentariosCompletos.match(/\b(1Z[A-Z0-9]{16}|\d{12,22})\b/gi) || [];
		const trackingStr = trackingNumbers.length > 0 ? Array.from(new Set(trackingNumbers)).join(", ") : "No detectados";

		const dineroMencionado = comentariosCompletos.match(/\$\d+(?:,\d{3})*(?:\.\d{2})?/g) || [];
		const dineroStr = dineroMencionado.length > 0 ? Array.from(new Set(dineroMencionado)).join(", ") : "No se mencionan montos";

		const emailsDetectados = comentariosCompletos.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
		const emailsStr = emailsDetectados.length > 0 ? Array.from(new Set(emailsDetectados)).join(", ") : "No detectados";

		const descripcionTarea = target.description || "Sin descripción";
		const cfData: string[] = [];
		for (const cf of (target.custom_fields || [])) {
		  if (cf.value !== undefined && cf.value !== null) {
			cfData.push(`${cf.name}: ${cf.value}`);
		  }
		}
		const camposPersonalizados = cfData.length > 0 ? cfData.join(" | ") : "Sin datos extra";

		const hoyDt = new Date();
		const formattedToday = hoyDt.toLocaleDateString("es-ES", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

		const ultMsg = textoUlt ? `${textoUlt.slice(0, 300)} (Fecha: ${fechaUlt?.toLocaleDateString("es-ES")}, Días: ${diasSin})` : "Sin respuesta previa";
		const statusActual = (target.status?.status || "").toUpperCase();

		const manualFiltrado = filtrarManualRelevante(query, manual);

		const promptFinal = `FECHA HOY: ${formattedToday}
	TAREA: ${target.name}
	ESTATUS ACTUAL EN CLICKUP: ${statusActual}

	--- METADATA EXTRAÍDA AUTOMÁTICAMENTE ---
	DESCRIPCIÓN DE LA TAREA (Posibles Productos): ${descripcionTarea}
	CAMPOS PERSONALIZADOS: ${camposPersonalizados}
	TRACKING/GUÍAS DETECTADAS: ${trackingStr}
	MONTOS FINANCIEROS DETECTADOS: ${dineroStr}
	EMAILS DETECTADOS: ${emailsStr}
	-----------------------------------------

	CONSULTA DEL USUARIO: ${query}
	ÚLTIMA RESPUESTA SISTEMA AUTOMÁTICO: ${ultMsg}
	COMENTARIOS DISPONIBLES (HILO): ${hilo}
	MANUAL OPERATIVO: ${manualFiltrado}

	INSTRUCCIONES DE MAPEO SEMÁNTICO DE ACTORES:
	- "Yo" / "Nosotros" / "Agente": El equipo humano de Morena Mía.
	- "Tú": Eres tú (la IA analista).
	- "Ella" / "The client": Se refiere ÚNICA Y EXCLUSIVAMENTE a la cliente final. 

	⚠️ CRÍTICO - REGLAS DE ESTATUS, CÁLCULO DE DÍAS Y "PRUEBA DE VIDA":
	El contador de días se reinicia a DÍA CERO cada vez que encuentres evidencia REAL de interacción del cliente.
	1. PRUEBA DE VIDA OBLIGATORIA: Si vas a afirmar que "el cliente respondió" o "nos contactó", ESTÁS OBLIGADA a citar la frase exacta donde el cliente habla, envía algo o actúa (Ej: "She sent her ID", "She claimed..."). Si el comentario solo dice lo que hizo el agente, el cliente NO respondió.
	2. 🚫 FALSOS POSITIVOS (PROHIBICIÓN ESTRICTA): 
	   - 🚨 JAMÁS asumas que el cliente respondió solo porque hay un comentario reciente. 
	   - 🚨 Frases como "We attempted to contact", "We informed her", o "The customer was required to" SON UN MONÓLOGO DEL AGENTE. El cliente está en SILENCIO. Si usas estas frases para decir que el cliente respondió, estarás cometiendo un error grave.
	3. 🚫 DEFINICIÓN ESTRICTA DE ESTATUS (INTERNAL WAITING vs CS REPLY):
	   - "INTERNAL WAITING": Espera INTERNA de la empresa (guías, autorizaciones, cheques). JAMÁS significa esperar al cliente.
	   - Si estamos esperando que el cliente responda o mande un documento (como el Docusign), el estatus es "CS REPLY".
	4. MATEMÁTICA ESTRICTA: A partir del comentario válido detectado, calcula tú misma los días exactos transcurridos hasta HOY (${formattedToday}). 

	DIRECTRICES DE RESPUESTA SEGÚN LA INTENCIÓN DEL USUARIO (MODO VERSÁTIL):

	CASO 1: RESÚMENES, PRODUCTOS Y PREGUNTAS ABIERTAS (MODO DETECTIVE).
	Si el usuario te pide "resume el caso", "qué producto se mencionó", "de qué trata el problema", o hace una pregunta específica que NO sea sobre el estatus o el deadline:
	- 🚨 ABANDONA POR COMPLETO el formato rígido de 5 puntos. No lo uses.
	- Analiza profúndamente la 'DESCRIPCIÓN' y todo el 'HILO DE COMENTARIOS'.
	- Escribe una respuesta natural, fluida y estructurada. 

	CASO 2: QUÉ HACER HOY, ESTADO DEL CASO O PIPELINE (MODO ESTRICTO).
	SOLO si el usuario pregunta "¿Qué sigue?", "¿Cómo vamos?", "¿Qué le pongo?" o "¿Qué procede hoy?", debes responder ESTRICTAMENTE con el formato corporativo de 5 puntos:
	- Diagnóstico: (Breve).
	- Última interacción real: (Fecha extraída).
	- Cálculo de días: (Días hasta hoy).
	- Regla aplicable: (Ej: Envío de Deadline).
	- Acción recomendada hoy: (Jamás saltar de CS REPLY a LOST LEAD).

	💼 OFFICIAL CORPORATE TONE & VOCABULARY (INTERNAL REPORTING ONLY):
	Cuando redactes tus resúmenes o diagnósticos, utiliza el vocabulario corporativo oficial de Morena Mia Beauty Group. 
	- Refiérete a los problemas como "Concerns" o "Inconveniences".
	- Si el cliente quiere cancelar, identifícalo como "Regret (CXL Request)" y recuerda la "no-refund, no-return policy signed upon agreement".
	- Si el producto falló, identifícalo como "Defective Device" o "Defective Syringe".
	- Mantén una postura ejecutiva, analítica y extremadamente profesional en todas tus respuestas.
	- 🚨 PROHIBICIÓN ESTRICTA DE FORMATO EMAIL: Tu respuesta es un REPORTE INTERNO para mí (Donna). JAMÁS redactes tu respuesta como si fuera un correo o carta para el cliente. Tienes ESTRICTAMENTE PROHIBIDO usar saludos (Ej: "Dear...", "Estimado cliente...") o despedidas (Ej: "Best regards", "Atentamente"). Ve directo a la información y a los hechos.`;

		const answer = await callGroq(promptFinal, "Eres una IA analista experta. Tienes permiso absoluto para salirte de formatos rígidos si el usuario te pide un resumen o investigar los comentarios a fondo. Si te piden un resumen, hazlo fluido e inteligente.");
		const elapsed = (Date.now() - startTime) / 1000;
		logMetric("ai_search", elapsed, { query });

		res.json({ found: true, answer, task_url: target.url, source_file: sourceFilename });
	  } catch (error: any) {
		console.error("AI Search Error:", error);
		res.status(500).json({ found: false, answer: `Error: ${error.message}` });
	  }
	});

	// Create ClickUp Ticket
	app.post("/api/create-ticket", async (req, res) => {
	  const startTime = Date.now();
	  const { invoice, name, phone, reason, sale_date, contact_date, amount_usd, sharefile_link, initial_comment, timezone, clickup_task_id, zendesk_ticket_id, email, store_location, zapier_token, seller_id, region_id, store_id, create_zendesk } = req.body;

	  try {
		let comentarioCorregido = corregirDiccion(initial_comment || "");

		let finalReason = reason;
		if (comentarioCorregido.toLowerCase().includes("instrucciones")) {
		  finalReason = "Instructions";
		}

		const detectedStatus = await analyzeStatusTrigger(comentarioCorregido);
		const finalStatus = normalizeClickUpStatus(detectedStatus !== "none" ? detectedStatus : "cs reply");

		const promptIa = `Task: Translate and paraphrase the following Spanish customer service log into a highly professional, ultra-concise English log entry for ClickUp internal comments.

	Strict Rules for ClickUp Internal Comments:
	1. NO CONVERSATIONAL FILLER: Do not include intros, outros, greetings, or pleasantries (e.g., NO "Dear Customer", "Best regards", or "We hope you are well").
	2. CONCISE & PROCEDURAL: Strictly paraphrase the Spanish input into a short, direct executive summary of facts. Keep it brief.
	3. TONE & PERSPECTIVE: Use first-person plural ("We") for company/agent actions and third-person for the customer.
	4. FACTS ONLY: Retain all critical metrics, amounts (like phone numbers), and dates from the original text without summarizing them out.
	5. DO NOT wrap your response in quotes and DO NOT include labels or prefixes like 'Log:'.

	💼 TERM ALIGNMENT (BUSINESS TERMS):
	- Align terminology with company guides (e.g., "no-refund, no-return policy signed upon agreement", "escalate to superiors", "Regret (CXL Request)").
	- 🚨 ANTI-VERBORREA: DO NOT use the word "unresponsive". It sounds pedantic and unnatural. Always use "did not respond", "did not answer", or "has not replied" instead.

	Text to translate and paraphrase: ${comentarioCorregido}`;

		const translated = (await callGroq(promptIa, "You are a professional corporate translator.")).trim();

		let parsedAmount = parseFloat((amount_usd || "").toString().replace(/[^0-9.]/g, ""));
		if (isNaN(parsedAmount)) {
		  parsedAmount = 0;
		}

		const customFields: any[] = [
		  { id: ID_CF_AMOUNT_USD, value: parsedAmount },
		  { id: ID_CF_SHAREFILE, value: sharefile_link || "" },
		  { id: "edf8c00b-d2a2-45a5-a363-f52b5629bd7a", value: true },   // "OK"
		  { id: "0958d23f-b017-4f6a-9f43-c90c3edbf8e9", value: true },   // "Match"
		  { id: "2d5018c1-906d-44cc-be24-732eb38653bd", value: true },   // "Signed"
		];

		if (seller_id) {
		  customFields.push({ id: "af1663e3-9d94-4edd-ad6a-cd775d0a1a70", value: [seller_id] });
		}

		if (region_id) {
		  customFields.push({ id: "47368acc-f166-4b7b-ae11-ee0001cd0ad1", value: region_id });
		}

		if (store_id) {
		  customFields.push({ id: "eea12258-757a-4cf0-b7cc-d67839c9d369", value: store_id });
		}

		const specificReasonMap = await getSpecificReasonMap();
		const reasonUuid = specificReasonMap[reason] || specificReasonMap[reason?.toLowerCase()] || (await getReasonUuid(reason));
		if (reasonUuid) {
		  customFields.push({ id: ID_CF_REASON, value: reasonUuid });
		}

		if (sale_date) {
		  try {
			const saleDt = new Date(sale_date);
			const ts = saleDt.getTime();
			if (!isNaN(ts)) {
			  customFields.push({ id: ID_CF_SALE_DATE, value: ts });
			}
		  } catch (err) {}
		}

		let contactTs = Date.now();
		if (contact_date) {
		  try {
			const contactDt = new Date(contact_date);
			const ts = contactDt.getTime();
			if (!isNaN(ts)) {
			  contactTs = ts;
			}
		  } catch (err) {}
		}
		customFields.push({ id: ID_CF_CONTACT_DATE, value: contactTs });

		// Weekend skips
		const hoy = new Date();
		let daysToAdd = hoy.getDay() === 5 ? 3 : 1; // Friday -> Monday
		const newDate = new Date(hoy);
		newDate.setDate(hoy.getDate() + daysToAdd);
		newDate.setHours(9, 0, 0, 0);

		if (newDate.getDay() === 6) {
		  newDate.setDate(newDate.getDate() + 2);
		} else if (newDate.getDay() === 0) {
		  newDate.setDate(newDate.getDate() + 1);
		}

		const newDue = newDate.getTime();

		let taskId = clickup_task_id ? clickup_task_id.trim() : null;
		let taskResultUrl = "";

		if (taskId) {
		  // Update existing ClickUp task
		  const clickupUrl = `https://api.clickup.com/api/v2/task/${taskId}`;
		  const response = await fetch(clickupUrl, {
			method: "PUT",
			headers: await getClickupHeaders(),
			body: JSON.stringify({
			  name: `${invoice} - ${name}`.toUpperCase(),
			  description: reason || "",
			  assignees: [ID_DONNA],
			  status: finalStatus,
			  due_date: newDue
			})
		  });

		  if (!response.ok) {
			const errorText = await response.text();
			return res.status(400).json({ error: `ClickUp Error (updating task ${taskId}): ${errorText}` });
		  }

		  const taskResult = await response.json() as any;
		  taskResultUrl = taskResult.url || `https://app.clickup.com/t/${taskId}`;

		  // Update custom fields one by one for existing task
		  for (const cf of customFields) {
			try {
			  const updateUrl = `https://api.clickup.com/api/v2/task/${taskId}/field/${cf.id}`;
			  await fetch(updateUrl, {
				method: "POST",
				headers: await getClickupHeaders(),
				body: JSON.stringify({ value: cf.value })
			  });
			} catch (cfErr) {
			  console.error(`Error updating custom field ${cf.id} for task ${taskId}:`, cfErr);
			}
		  }
		} else {
		  // Create new ClickUp task
		  const clickupUrl = `https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task`;
		  const taskPayload = {
			name: `${invoice} - ${name}`.toUpperCase(),
			description: reason || "",
			assignees: [ID_DONNA],
			status: finalStatus,
			due_date: newDue
		  };
		  console.log("[ClickUp Create Task] URL:", clickupUrl);
		  console.log("[ClickUp Create Task] Payload (without custom fields):", JSON.stringify(taskPayload, null, 2));

		  const response = await fetch(clickupUrl, {
			method: "POST",
			headers: await getClickupHeaders(),
			body: JSON.stringify(taskPayload)
		  });

		  if (!response.ok) {
			const errorText = await response.text();
			console.error("[ClickUp Create Task Error] Status:", response.status, "Body:", errorText);
			return res.status(400).json({ error: `ClickUp Error (creating task): ${errorText}` });
		  }

		  const taskResult = await response.json() as any;
		  console.log("[ClickUp Create Task Success] ID:", taskResult.id, "URL:", taskResult.url);
		  taskId = taskResult.id;
		  taskResultUrl = taskResult.url;

		  // Update custom fields individually
		  console.log(`[ClickUp Create Task] Updating ${customFields.length} custom fields individually for task ${taskId}...`);
		  for (const cf of customFields) {
			try {
			  const cfUrl = `https://api.clickup.com/api/v2/task/${taskId}/field/${cf.id}`;
			  const cfResponse = await fetch(cfUrl, {
				method: "POST",
				headers: await getClickupHeaders(),
				body: JSON.stringify({ value: cf.value })
			  });
			  if (!cfResponse.ok) {
				const cfErrText = await cfResponse.text();
				console.error(`[ClickUp Custom Field Error] Failed to set field ${cf.id} to value ${cf.value}: Status ${cfResponse.status} - ${cfErrText}`);
			  } else {
				console.log(`[ClickUp Custom Field Success] Set field ${cf.id} to value ${cf.value}`);
			  }
			} catch (cfErr) {
			  console.error(`Error updating custom field ${cf.id} for task ${taskId}:`, cfErr);
			}
		  }
		}

		// Save task timezone
		await guardarTimezone(taskId, timezone || "EST");

		// Save task phone if any
		if (phone) {
		  await guardarPhone(taskId, phone);
		}

		// Post translated comment
		  const finalCommentText = translated;
		  await fetch(`https://api.clickup.com/api/v2/task/${taskId}/comment`, {
			method: "POST",
			headers: await getClickupHeaders(),
			body: JSON.stringify({ comment_text: finalCommentText })
		  });

		// Optionally create Zendesk Ticket if email is provided and create_zendesk is truthy
		let zendeskResult = null;
		const manualZendeskId = zendesk_ticket_id ? String(zendesk_ticket_id).trim() : null;

		if (manualZendeskId) {
		  console.log(`[Process Zendesk Case] Manual Zendesk Ticket ID provided: ${manualZendeskId}`);
		  zendeskResult = { id: manualZendeskId };
		} else if (email && create_zendesk) {
		  try {
			const zapierToken = zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
			const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${zapierToken}`;

			const cleanEmail = email ? email.trim() : "";
			const cleanPhone = phone ? phone.trim() : "";
			const cleanStore = store_location || "N/A";
			const cleanRegion = region_id || "N/A";
			const cleanComment = initial_comment || "";

			// 0. Buscar si ya existe un ticket de Zendesk para este Invoice para evitar duplicados
			let existingTicket = null;
			if (invoice) {
			  try {
				existingTicket = await findTicketByInvoice(zapierUrl, String(invoice));
			  } catch (findErr: any) {
				console.log("[Process Zendesk Case] Error searching for existing ticket:", findErr.message);
			  }
			}

			if (existingTicket) {
			  console.log(`[Process Zendesk Case] El ticket de Zendesk para el invoice ${invoice} ya existe: ID ${existingTicket.id}. No crearemos duplicado.`);
			  zendeskResult = existingTicket;
			} else {
			  // 1. Verificar si el usuario ya existe para evitar errores de email duplicado
			  let existingUser: any = null;
			  try {
				existingUser = await findUserByEmail(zapierUrl, cleanEmail);
				if (existingUser) {
				  console.log(`[Process Zendesk Case] Found existing user with ID: ${existingUser.id}`);
				} else {
				  console.log("[Process Zendesk Case] No existing user found.");
				}
			  } catch (err: any) {
				console.log("[Process Zendesk Case] Search for existing user failed:", err.message);
			  }

			  const params = {
				name: name || cleanEmail.split("@")[0],
				email: cleanEmail,
				phone: cleanPhone,
				external_id: String(invoice),
				details: `Store: ${cleanStore}\nRegion: ${cleanRegion}\nComment: ${cleanComment || ""}`
			  };

			  let userResult = null;
			  try {
				if (existingUser && existingUser.id) {
				  // 2. Si existe: Se actualizan los detalles y el número de teléfono con PUT
				  console.log(`[Process Zendesk Case] User already exists with ID ${existingUser.id}. Updating user details via raw API PUT...`);
				  const subdomain = process.env.ZENDESK_SUBDOMAIN || "vipcosmetics";
				  const zendeskSub = subdomain.toLowerCase().trim();
				  const updateUserUrl = `https://${zendeskSub}.zendesk.com/api/v2/users/${existingUser.id}.json`;
				  userResult = await callZapierMcp(zapierUrl, {
					selected_api: "ZendeskV2CLIAPI",
					action: "_zap_raw_request",
					instructions: `Make a PUT request to update user details in Zendesk. URL is "${updateUserUrl}".`,
					params: {
					  url: updateUserUrl,
					  method: "PUT",
					  headers: {
						"Content-Type": "application/json"
					  },
					  body: JSON.stringify({
						user: {
						  phone: cleanPhone,
						  external_id: String(invoice),
						  notes: `Store: ${cleanStore}\nRegion: ${cleanRegion}\nComment: ${cleanComment}`
						}
					  }),
					  fail_on_errors: false
					},
					output: "user"
				  });
				  console.log("[Process Zendesk Case] User updated successfully via raw PUT:", JSON.stringify(userResult));
				} else {
				  // 3. Si no existe: Se crea el usuario nuevo en Zendesk usando raw POST primero
				  const subdomain = process.env.ZENDESK_SUBDOMAIN || "vipcosmetics";
				  const zendeskSub = subdomain.toLowerCase().trim();
				  const createUserUrl = `https://${zendeskSub}.zendesk.com/api/v2/users.json`;
				  
				  try {
					console.log("[Process Zendesk Case] Creating user via raw POST...", params);
					userResult = await callZapierMcp(zapierUrl, {
					  selected_api: "ZendeskV2CLIAPI",
					  action: "_zap_raw_request",
					  instructions: `Make a POST request to create a new user in Zendesk. URL is "${createUserUrl}".`,
					  params: {
						url: createUserUrl,
						method: "POST",
						headers: {
						  "Content-Type": "application/json"
						},
						body: JSON.stringify({
						  user: {
							name: params.name,
							email: params.email,
							phone: params.phone,
							external_id: params.external_id,
							details: params.details
						  }
						}),
						fail_on_errors: false
					  },
					  output: "user"
					});
					console.log("[Process Zendesk Case] User created successfully via raw POST:", JSON.stringify(userResult));
				  } catch (rawCreateErr: any) {
					console.log(`[Process Zendesk Case] Raw user creation failed: ${rawCreateErr.message}. Trying standard create_user...`);
					userResult = await callZapierMcp(zapierUrl, {
					  selected_api: "ZendeskV2CLIAPI",
					  action: "create_user",
					  instructions: `Create a new user with name "${params.name}", email "${params.email}", and phone "${params.phone}".`,
					  params: {
						name: params.name,
						email: params.email,
						phone: params.phone,
						external_id: params.external_id,
						details: params.details
					  },
					  output: "id, name, email"
					});
					console.log("[Process Zendesk Case] User created successfully via standard action:", userResult);
				  }
				}
			  } catch (err: any) {
				const errMsg = err.message || "";
				console.log(`[Process Zendesk Case] User setup block caught an error: ${errMsg}`);
				
				// Manejo robusto de conflictos (por si el usuario se creó en paralelo o la búsqueda previa falló)
				if (errMsg.includes("already being used") || errMsg.includes("already exists") || errMsg.includes("taken")) {
				  console.log("[Process Zendesk Case] Note: Customer already registered in Zendesk. Fetching existing user by email to update phone...");
				  existingUser = await findUserByEmail(zapierUrl, cleanEmail);
				  if (existingUser && existingUser.id) {
					console.log(`[Process Zendesk Case] Found existing user ID ${existingUser.id} after creation conflict. Updating phone details via PUT...`);
					try {
					  const subdomain = process.env.ZENDESK_SUBDOMAIN || "vipcosmetics";
					  const zendeskSub = subdomain.toLowerCase().trim();
					  const updateUserUrl = `https://${zendeskSub}.zendesk.com/api/v2/users/${existingUser.id}.json`;
					  userResult = await callZapierMcp(zapierUrl, {
						selected_api: "ZendeskV2CLIAPI",
						action: "_zap_raw_request",
						instructions: `Make a PUT request to update user details in Zendesk. URL is "${updateUserUrl}".`,
						params: {
						  url: updateUserUrl,
						  method: "PUT",
						  headers: {
							"Content-Type": "application/json"
						  },
						  body: JSON.stringify({
							user: {
							  phone: cleanPhone,
							  external_id: String(invoice),
							  notes: `Store: ${cleanStore}\nRegion: ${cleanRegion}\nComment: ${cleanComment}`
							}
						  }),
						  fail_on_errors: false
						},
						output: "user"
					  });
					  console.log("[Process Zendesk Case] Conflict fallback user updated successfully:", JSON.stringify(userResult));
					} catch (updateErr: any) {
					  console.log("[Process Zendesk Case] Failed to update user during conflict fallback:", updateErr.message);
					}
				  }
				} else {
				  console.log("[Process Zendesk Case] User setup error (not duplicate), proceeding directly to ticket creation.");
				}
			  }

			  // Configuración de la URL y el asunto del ticket
			  const subdomain = process.env.ZENDESK_SUBDOMAIN || "vipcosmetics";
			  const zendeskSub = subdomain.toLowerCase().trim();
			  const createTicketUrl = `https://${zendeskSub}.zendesk.com/api/v2/tickets.json`;

			  const computedSubject = `Invoice #${invoice} - ${cleanStore} - ${cleanRegion} - PURCHASE FOLLOW-UP`;
			  const ASSIGNEE_ID = 50176296447379;

			  // Construcción del Payload del Ticket
			  const ticketPayload: any = {
				ticket: {
				  subject: computedSubject,
				  comment: {
					body: `Caso para el cliente ${name} (${cleanEmail}).\nSucursal: ${cleanStore}\nRegión: ${cleanRegion}\nComentario inicial: ${cleanComment}`,
					public: false // Comentario interno por defecto
				  },
				  external_id: String(invoice), // Usamos el número de factura como ID externo
				  status: "new",
				  priority: "normal",
				  assignee_id: ASSIGNEE_ID
				}
			  };

			  const finalRequesterId = existingUser && existingUser.id ? existingUser.id : null;
			  const userTimeZone = timezone || "America/New_York";

			  // Asociación del "Requester" (Solicitante)
			  if (finalRequesterId) {
				// Si el usuario ya existe, usamos su ID
				ticketPayload.ticket.requester_id = finalRequesterId;
			  } else {
				// Si es nuevo, pasamos el objeto para que Zendesk lo cree automáticamente
				ticketPayload.ticket.requester = {
				  name: name,
				  email: cleanEmail,
				  time_zone: userTimeZone
				};
			  }

			  console.log(`🚀 Creando ticket en Zendesk usando _zap_raw_request POST...`);
			  const ticketResult = await callZapierMcp(zapierUrl, {
				selected_api: "ZendeskV2CLIAPI",
				action: "_zap_raw_request",
				instructions: `Make a POST request to create a ticket in Zendesk. URL is "${createTicketUrl}". Set headers Content-Type to application/json.`,
				params: {
				  url: createTicketUrl,
				  method: "POST",
				  headers: {
					"Content-Type": "application/json"
				  },
				  body: JSON.stringify(ticketPayload),
				  fail_on_errors: false
				},
				output: "ticket, results"
			  }, "execute_zapier_write_action");

			  let zendeskResultObj = null;
			  if (ticketResult && typeof ticketResult === "object") {
				if (ticketResult.ticket && typeof ticketResult.ticket === "object") {
				  zendeskResultObj = ticketResult.ticket;
				} else if (ticketResult.results && typeof ticketResult.results === "object") {
				  if (ticketResult.results.ticket && typeof ticketResult.results.ticket === "object") {
					zendeskResultObj = ticketResult.results.ticket;
				  } else {
					zendeskResultObj = ticketResult.results;
				  }
				} else if (ticketResult.raw && typeof ticketResult.raw === "object" && ticketResult.raw.ticket && typeof ticketResult.raw.ticket === "object") {
				  zendeskResultObj = ticketResult.raw.ticket;
				} else if (ticketResult.id) {
				  zendeskResultObj = ticketResult;
				}
			  }
			  zendeskResult = zendeskResultObj || ticketResult;
			  console.log("✅ Automatic Zendesk Ticket created via Zapier MCP SSE (Raw request):", zendeskResult);
			}

			if (zendeskResult) {
			  try {
				let zdId = null;
				if (zendeskResult.id) {
				  zdId = zendeskResult.id.toString();
				} else if (zendeskResult.ticket_id) {
				  zdId = zendeskResult.ticket_id.toString();
				} else if (typeof zendeskResult === "object") {
				  const foundKey = Object.keys(zendeskResult).find(k => k.toLowerCase() === "id" || k.toLowerCase().includes("ticket"));
				  if (foundKey) {
					zdId = zendeskResult[foundKey]?.toString();
				  }
				}
				if (zdId) {
				  await guardarZendeskTicketId(taskId, zdId);
				  console.log(`✅ Automatically stored Zendesk Ticket ID ${zdId} for ClickUp task ${taskId}`);
				  
				  // Push translated English comment to Zendesk ticket as an internal note
				  try {
					console.log(`[Process Zendesk Case] Pushing translated comment to Zendesk ticket ${zdId}...`);
					await addNoteByTicketIdRaw(zapierUrl, zdId, translated);
					console.log(`[Process Zendesk Case] Translated comment pushed to Zendesk successfully.`);
				  } catch (noteErr: any) {
					console.error(`[Process Zendesk Case] Error pushing translated comment to Zendesk:`, noteErr.message);
				  }
				}
			  } catch (err: any) {
				console.warn("Warning storing auto-created zendesk ticket id:", err.message);
			  }
			}
		  } catch (zErr: any) {
			console.log("ℹ️ Zendesk auto-creation skipped or unconfigured:", zErr.message);
		  }
		}

		const elapsed = (Date.now() - startTime) / 1000;
		logMetric("create_ticket", elapsed, { invoice });

		res.json({ 
		  task_url: taskResultUrl, 
		  task_id: taskId,
		  zendesk_result: zendeskResult 
		});
	  } catch (error: any) {
		console.warn("Create Ticket Warning or Error:", error.message);
		res.status(500).json({ error: error.message });
	  }
	});

	// ---------------------------------------------------------------------------
	// Endpoint: Crear Ticket y añadir Comentario vía Zapier MCP (Directo)
	// ---------------------------------------------------------------------------
	app.post("/api/zendesk/create-ticket", async (req, res) => {
	  // 1. Extraemos los datos del frontend (incluyendo el teléfono extraído por OCR o manual)
	  const { nombre, email, telefono, invoice, comentario, store_location, zapier_token } = req.body;

	  // Validación temprana (Mejor práctica de seguridad y UX)
	  if (!nombre || !email || !invoice) {
		return res.status(400).json({ 
		  success: false, 
		  error: "Faltan datos obligatorios: nombre, email o invoice." 
		});
	  }

	  // Credenciales (Asegúrate de tener ZAPIER_MCP_TOKEN en tu .env)
	  const zapierToken = zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
	  const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${zapierToken}`;

	  try {
		console.log(`🚀 Enviando petición de Ticket a Zapier MCP para Invoice: ${invoice}`);

		let existingUser = null;
		try {
		  existingUser = await findUserByEmail(zapierUrl, email);
		} catch (err: any) {
		  console.log("Search for existing user failed:", err.message);
		}

		// Configuración de la URL y el asunto del ticket
		const subdomain = process.env.ZENDESK_SUBDOMAIN || "vipcosmetics";
		const zendeskSub = subdomain.toLowerCase().trim();
		const createTicketUrl = `https://${zendeskSub}.zendesk.com/api/v2/tickets.json`;

		const cleanStore = store_location || "N/A";
		const cleanRegion = "N/A";
		const cleanComment = comentario || "";

		const computedSubject = `Invoice #${invoice} - ${cleanStore} - ${cleanRegion} - PURCHASE FOLLOW-UP`;
		const ASSIGNEE_ID = 50176296447379;

		// Construcción del Payload del Ticket
		const ticketPayload: any = {
		  ticket: {
			subject: computedSubject,
			comment: {
			  body: `Caso para el cliente ${nombre} (${email}).\nSucursal: ${cleanStore}\nRegión: ${cleanRegion}\nComentario inicial: ${cleanComment}`,
			  public: false // Comentario interno por defecto
			},
			external_id: String(invoice), // Usamos el número de factura como ID externo
			status: "new",
			priority: "normal",
			assignee_id: ASSIGNEE_ID
		  }
		};

		const finalRequesterId = existingUser && existingUser.id ? existingUser.id : null;
		const userTimeZone = "America/New_York";

		// Asociación del "Requester" (Solicitante)
		if (finalRequesterId) {
		  // Si el usuario ya existe, usamos su ID
		  ticketPayload.ticket.requester_id = finalRequesterId;
		} else {
		  // Si es nuevo, pasamos el objeto para que Zendesk lo cree automáticamente
		  ticketPayload.ticket.requester = {
			name: nombre,
			email: email,
			time_zone: userTimeZone
		  };
		}

		// Ejecución de la llamada a través de Zapier
		const result = await callZapierMcp(zapierUrl, {
		  selected_api: "ZendeskV2CLIAPI",
		  action: "_zap_raw_request",
		  instructions: `Make a POST request to create a ticket in Zendesk. URL is "${createTicketUrl}". Set headers Content-Type to application/json.`,
		  params: {
			url: createTicketUrl,
			method: "POST",
			headers: {
			  "Content-Type": "application/json"
			},
			body: JSON.stringify(ticketPayload),
			fail_on_errors: false
		  },
		  output: "ticket, results"
		}, "execute_zapier_write_action");
		
		console.log("✅ Ticket creado en Zendesk exitosamente:", result);

		// 4. Respuesta exitosa al Frontend
		res.json({
		  success: true,
		  message: `Ticket creado exitosamente para el Invoice ${invoice}`,
		  zapier_mcp_response: result
		});

	  } catch (error: any) {
		console.log("ℹ️ Error al crear el ticket en Zapier MCP (unconfigured):", error.message);
		
		res.status(500).json({ 
		  success: false, 
		  error: "Error al procesar el ticket en Zendesk (sin configurar).",
		  details: error.message 
		});
	  }
	});



	// Log and Push Comment
	app.post("/api/log-and-push", async (req, res) => {
	  const startTime = Date.now();
	  const { task_id, spanish_comment, zapier_token, zendesk_ticket_id } = req.body;

	  try {
		const normalizeText = (str: string) => {
		  return str
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase();
		};

		const comentarioCorregido = corregirDiccion(spanish_comment);
		let detectedStatus = await analyzeStatusTrigger(comentarioCorregido);
		const msgLower = normalizeText(comentarioCorregido);

		const isLogNuevo = msgLower.includes("log nuevo");
		if (isLogNuevo) {
		  await guardarAnsweredTime(task_id, new Date().toISOString());
		}

		const giftTriggers = [
		  "acepto regalo", "acepto regalo", "acepta regalo", "acepto el regalo", "acepto el regalo",
		  "accepted gift", "accepts gift", "accepted the gift", 
		  "de acuerdo en recibir los productos", "de acuerdo con recibir los productos",
		  "agreed to receive the products", "recibir los productos en compensacion",
		  "productos en compensacion", "productos como compensacion", 
		  "products as compensation", "regalo de compensacion"
		];

		const hasGiftAcceptance = giftTriggers.some(frase => msgLower.includes(normalizeText(frase)));
		if (hasGiftAcceptance) {
		  const idx = giftTriggers.findIndex(frase => msgLower.includes(normalizeText(frase)));
		  const fraseEncontrada = giftTriggers[idx];
		  const matchIdx = msgLower.indexOf(normalizeText(fraseEncontrada));
		  const prefijo = msgLower.substring(Math.max(0, matchIdx - 15), matchIdx);
		  if (!["no", "not", "t "].some(neg => prefijo.includes(neg))) {
			// Set resolution custom field to GIFT
			const cfUrl = `https://api.clickup.com/api/v2/task/${task_id}/field/55638270-b614-4783-ad1c-0bd994d6484b`;
			await fetch(cfUrl, {
			  method: "POST",
			  headers: await getClickupHeaders(),
			  body: JSON.stringify({ value: "94dad466-99f5-4f62-b6a1-f7d0a567ffae" }) // GIFT UUID
			});
		  }
		}

		const triggersCierre = [
		  "cerraremos esta tarea", "cerraremos este ticket", "ticket cerrado", 
		  "cerrar ticket", "cerrar tarea", "cerramos la tarea",
		  "se cerrara esta tarea", "se cierra esta tarea",
		  "cerrar esta tarea", "cerrar este caso", "cerrar el caso", "cerrar el ticket", "cerrar la tarea",
		  "procederemos a cerrar esta tarea", "procederemos a cerrar el caso", "procederemos a cerrar la tarea", "procederemos a cerrar este ticket", "procederemos a cerrar",
		  "proceder a cerrar esta tarea", "proceder a cerrar la tarea", "proceder a cerrar el ticket", "proceder a cerrar",
		  "procedo a cerrar esta tarea", "procedo a cerrar la tarea", "procedo a cerrar el ticket", "procedo a cerrar el caso", "procedo a cerrar",
		  "daremos por cerrada la tarea", "daremos por cerrado el caso", "daremos por cerrado el ticket", "daremos por cerrado",
		  "dar por cerrada la tarea", "dar por cerrado el caso", "dar por cerrado el ticket", "dar por cerrado",
		  "caso cerrado", "caso resuelto", "tarea cerrada", "tarea resuelta",
		  "cerramos este caso", "cerramos esta tarea", "cerramos este ticket",
		  "to close the task", "close the task", "close this task", "close task", "close ticket", "close the ticket", "close this ticket",
		  "proceed to close this task", "proceed to close the task", "proceed to close task", "proceed to close this ticket", "proceed to close",
		  "proceeding to close this task", "proceeding to close the task",
		  "will proceed to close this task", "will proceed to close",
		  "closing this task", "closing the task", "closing task", "closing ticket",
		  "task closed", "ticket closed", "case closed",
		  "resolved and closed", "resolved & closed"
		];

		const esCierre = triggersCierre.some(t => msgLower.includes(normalizeText(t)));
		let extraPrompt = "";

		if (esCierre) {
		  detectedStatus = "Closed";
		  const pastHilo = await fetchTaskComments(task_id, 20);
		  extraPrompt = `\n\nCRÍTICO: El usuario ordenó cerrar la tarea. DEBES agregar un 'SUMMARY' (Resumen Ejecutivo) al final de tu traducción, resumiendo el historial de este caso y su resolución final basado en los siguientes comentarios pasados: ${pastHilo}`;
		}

		const promptIa = `Task: Translate and paraphrase the following Spanish customer service log into a highly professional, ultra-concise English log entry for ClickUp internal comments.

	Strict Rules for ClickUp Internal Comments:
	1. NO CONVERSATIONAL FILLER: Do not include intros, outros, greetings, or pleasantries (e.g., NO "Dear Customer", "Best regards", or "We hope you are well").
	2. CONCISE & PROCEDURAL: Strictly paraphrase the Spanish input into a short, direct executive summary of facts. Keep it brief.
	3. TONE & PERSPECTIVE: Use first-person plural ("We") for company/agent actions and third-person for the customer.
	4. FACTS ONLY: Retain all critical metrics, amounts, and dates from the original text without summarizing them out.
	5. DO NOT wrap your response in quotes and DO NOT include labels or prefixes like 'Log:'.${extraPrompt}

	💼 TERM ALIGNMENT (BUSINESS TERMS):
	- Align terminology with company guides (e.g., "no-refund, no-return policy signed upon agreement", "escalate to superiors", "Regret (CXL Request)").
	- 🚨 ANTI-VERBORREA: DO NOT use the word "unresponsive". It sounds pedantic and unnatural. Always use "did not respond", "did not answer", or "has not replied" instead.

	Text to translate and paraphrase: ${comentarioCorregido}`;

		let commentText = (await callGroq(promptIa, "You are a professional corporate customer service translator.")).trim();

		if (esCierre) {
		  commentText = "🔒 CLOSURE NOTE & SUMMARY:\n\n" + commentText;
		}

		const hoy = new Date();
		let newDate = new Date();
		if (detectedStatus === "deadline") {
		  newDate.setDate(hoy.getDate() + 4);
		} else {
		  const daysToAdd = hoy.getDay() === 5 ? 3 : 1;
		  newDate.setDate(hoy.getDate() + daysToAdd);
		}
		newDate.setHours(9, 0, 0, 0);

		if (newDate.getDay() === 6) {
		  newDate.setDate(newDate.getDate() + 2);
		} else if (newDate.getDay() === 0) {
		  newDate.setDate(newDate.getDate() + 1);
		}

		const newDue = newDate.getTime();
		
		// Post comment
		await fetch(`https://api.clickup.com/api/v2/task/${task_id}/comment`, {
		  method: "POST",
		  headers: await getClickupHeaders(),
		  body: JSON.stringify({ comment_text: commentText })
		});

		// Update task status and due date
		const updatePayload: any = { due_date: newDue };
		if (detectedStatus !== "none") {
		  updatePayload.status = normalizeClickUpStatus(detectedStatus);
		}

		await fetch(`https://api.clickup.com/api/v2/task/${task_id}`, {
		  method: "PUT",
		  headers: await getClickupHeaders(),
		  body: JSON.stringify(updatePayload)
		});

		// If there is an associated Zendesk Ticket ID, push internal comment to Zendesk as well
		// Subdomain: vipcosmetics
		let zendeskStatus = "none";
		let zendeskMessage = "";
		try {
		  const zendeskMap = await obtenerZendeskTicketIds();
		  let rawTicketId = (zendesk_ticket_id || zendeskMap[task_id] || "").toString().trim();
		  
		  // Fallback: Si no hay ticket_id, intentar parsear del nombre de la tarea de ClickUp (igual que en close-task)
		  if (!rawTicketId || ["none", "null", "undefined", "n/a", "sin ticket"].includes(rawTicketId.toLowerCase())) {
			try {
			  console.log(`🔍 Intentando auto-detectar ID de Ticket Zendesk desde el nombre de ClickUp para la tarea ${task_id}`);
			  const taskRes = await fetch(`https://api.clickup.com/api/v2/task/${task_id}`, { headers: { "Authorization": CLICKUP_API_KEY } });
			  if (taskRes.ok) {
				const taskData = await taskRes.json() as any;
				const origName = taskData.name || "";
				let parsedTicket = "";
				if (origName.includes("-")) {
				  const parts = origName.split("-");
				  parsedTicket = parts[0].trim();
				} else {
				  const match = origName.match(/\b([A-Z0-9]{3,10})\b/i);
				  if (match) {
					parsedTicket = match[1];
				  }
				}
				if (parsedTicket) {
				  rawTicketId = parsedTicket;
				  console.log(`✅ Auto-detectado ID de Ticket Zendesk de ClickUp: ${rawTicketId}`);
				}
			  }
			} catch (parseErr: any) {
			  console.warn("ℹ️ No se pudo parsear el ID del ticket desde el nombre de ClickUp:", parseErr.message);
			}
		  }

		  const hasValidTicket = rawTicketId !== "" && !["none", "null", "undefined", "n/a", "sin ticket"].includes(rawTicketId.toLowerCase());
		  
		  if (hasValidTicket) {
			const targetTicketId = rawTicketId;
			console.log(`📍 Found associated Zendesk Ticket ID ${targetTicketId} for ClickUp task ${task_id}. Pushing internal comment...`);
			const zapierToken = zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
			const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${zapierToken}`;
			
			// ✅ Usar la función mejorada que busca con API cruda y luego agrega la nota
			const noteResult = await addNoteByTicketIdRaw(zapierUrl, targetTicketId, commentText);
			zendeskStatus = "success";
			zendeskMessage = `Nota interna agregada correctamente al ticket "${noteResult.ticket_found}".`;
		  } else {
			zendeskMessage = "No se detectó un ID de ticket válido para Zendesk.";
		  }
		} catch (zErr: any) {
		  console.log("ℹ️ Zendesk auto-push comment skipped or error:", zErr.message);
		  zendeskStatus = "failed";
		  zendeskMessage = zErr.message;
		}

		const elapsed = (Date.now() - startTime) / 1000;
		logMetric("log_and_push", elapsed, { task_id });
		res.json({ 
		  status: "ok", 
		  zendesk_status: zendeskStatus, 
		  zendesk_message: zendeskMessage,
		  trigger_schedule: isLogNuevo
		});

	  } catch (e: any) {
		console.error("Log and Push Error:", e);
		res.status(500).json({ error: e.message });
	  }
	});

	// Schedule Call
	app.post("/api/schedule-call", async (req, res) => {
	  const { task_id, timestamp, zapier_token, zendesk_ticket_id } = req.body;
	  if (!task_id || !timestamp) {
		return res.status(400).json({ error: "Faltan parámetros obligatorios: task_id y timestamp." });
	  }

	  try {
		const dueMs = parseInt(timestamp);
		const targetDate = new Date(dueMs);

		// Resolve timezone
		const timezonesMap = await obtenerTimezones();
		const tzTag = timezonesMap[task_id] || "EST";
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
		const timezoneZone = tzOficiales[tzTag] || "America/New_York";

		// Format system/server local time
		const systemDateTimeStr = targetDate.toLocaleString("es-MX", {
		  year: "numeric",
		  month: "2-digit",
		  day: "2-digit",
		  hour: "2-digit",
		  minute: "2-digit",
		  hour12: true
		});

		// Format client local time
		const clientDateTimeStr = new Intl.DateTimeFormat("es-MX", {
		  timeZone: timezoneZone,
		  year: "numeric",
		  month: "2-digit",
		  day: "2-digit",
		  hour: "2-digit",
		  minute: "2-digit",
		  hour12: true
		}).format(targetDate);

		// Update due_date in ClickUp
		const cfRes = await fetch(`https://api.clickup.com/api/v2/task/${task_id}`, {
		  method: "PUT",
		  headers: {
			"Authorization": CLICKUP_API_KEY,
			"Content-Type": "application/json"
		  },
		  body: JSON.stringify({ due_date: dueMs })
		});

		if (!cfRes.ok) {
		  console.error(`Error updating ClickUp due_date: ${cfRes.statusText}`);
		}

		// Prepare English comment for ClickUp
		const commentText = `📞 CALL SCHEDULED: Follow-up call set for ${systemDateTimeStr} (Client local time: ${clientDateTimeStr}).`;

		// Post comment to ClickUp
		await fetch(`https://api.clickup.com/api/v2/task/${task_id}/comment`, {
		  method: "POST",
		  headers: {
			"Authorization": CLICKUP_API_KEY,
			"Content-Type": "application/json"
		  },
		  body: JSON.stringify({ comment_text: commentText })
		});

		// Sincronizar con Zendesk si es posible
		let zendeskStatus = "none";
		let zendeskMessage = "";
		try {
		  const zendeskMap = await obtenerZendeskTicketIds();
		  let rawTicketId = (zendesk_ticket_id || zendeskMap[task_id] || "").toString().trim();
		  
		  if (!rawTicketId || ["none", "null", "undefined", "n/a", "sin ticket"].includes(rawTicketId.toLowerCase())) {
			// Fallback name parsing
			const taskRes = await fetch(`https://api.clickup.com/api/v2/task/${task_id}`, { headers: { "Authorization": CLICKUP_API_KEY } });
			if (taskRes.ok) {
			  const taskData = await taskRes.json() as any;
			  const origName = taskData.name || "";
			  let parsedTicket = "";
			  if (origName.includes("-")) {
				parsedTicket = origName.split("-")[0].trim();
			  } else {
				const match = origName.match(/\b([A-Z0-9]{3,10})\b/i);
				if (match) parsedTicket = match[1];
			  }
			  if (parsedTicket) rawTicketId = parsedTicket;
			}
		  }

		  const hasValidTicket = rawTicketId !== "" && !["none", "null", "undefined", "n/a", "sin ticket"].includes(rawTicketId.toLowerCase());
		  if (hasValidTicket) {
			const zapierToken = zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
			const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${zapierToken}`;
			const noteResult = await addNoteByTicketIdRaw(zapierUrl, rawTicketId, commentText);
			zendeskStatus = "success";
			zendeskMessage = `Nota de agenda agregada correctamente al ticket "${noteResult.ticket_found}".`;
		  }
		} catch (zErr: any) {
		  console.log("ℹ️ Zendesk schedule comment auto-push skipped:", zErr.message);
		  zendeskStatus = "failed";
		  zendeskMessage = zErr.message;
		}

		res.json({ success: true, zendesk_status: zendeskStatus, zendesk_message: zendeskMessage });
	  } catch (err: any) {
		console.error("Schedule Call Error:", err);
		res.status(500).json({ error: err.message });
	  }
	});

	// Bank Pause
	app.post("/api/bank-pause", async (req, res) => {
	  const { task_id, days } = req.body;
	  if (!days || days <= 0) {
		return res.status(400).json({ error: "Días debe ser mayor que 0" });
	  }

	  try {
		const comment = `🏦 Pausa bancaria: ${days} días. No seguimiento diario.`;
		await fetch(`https://api.clickup.com/api/v2/task/${task_id}/comment`, {
		  method: "POST",
		  headers: await getClickupHeaders(),
		  body: JSON.stringify({ comment_text: comment })
		});

		const futureDate = new Date();
		futureDate.setDate(futureDate.getDate() + parseInt(days));
		const newDue = futureDate.getTime();

		const response = await fetch(`https://api.clickup.com/api/v2/task/${task_id}`, {
		  method: "PUT",
		  headers: await getClickupHeaders(),
		  body: JSON.stringify({ due_date: newDue })
		});

		if (!response.ok) {
		  return res.status(400).json({ error: `ClickUp Error: ${await response.text()}` });
		}

		logMetric("bank_pause", 0.1, { task_id, days });
		res.json({ status: "ok", new_due_date: newDue });
	  } catch (err: any) {
		res.status(500).json({ error: err.message });
	  }
	});

	// Close Task with Resolution
	app.post("/api/close-task", async (req, res) => {
	  const { task_id, spanish_comment, resolution_id, zapier_token, ticket_number } = req.body;

	  try {
		const promptIa = `Translate the following Spanish text exactly and professionally to English. Do not add any conversational filler or change the tone. Just translate: ${spanish_comment}`;
		const translated = (await callGroq(promptIa, "You are a professional corporate translator. Provide only the direct English translation.")).trim();

		// Fetch current task to rearrange the name
		let rearrangedName = "";
		try {
		  const taskRes = await fetch(`https://api.clickup.com/api/v2/task/${task_id}`, { headers: { "Authorization": CLICKUP_API_KEY } });
		  if (taskRes.ok) {
			const taskData = await taskRes.json() as any;
			const origName = taskData.name || "";
			
			let clientName = "";
			const finalTicketNum = (ticket_number || "").trim();
			
			if (origName.includes("-")) {
			  const parts = origName.split("-");
			  const firstPart = parts[0].trim();
			  const restOfParts = parts.slice(1).join("-").trim();
			  
			  if (finalTicketNum && firstPart.toLowerCase().includes(finalTicketNum.toLowerCase())) {
				clientName = restOfParts;
			  } else {
				clientName = restOfParts || firstPart;
			  }
			} else {
			  clientName = origName;
			  if (finalTicketNum) {
				const regex = new RegExp(`\\b${finalTicketNum}\\b`, "gi");
				clientName = clientName.replace(regex, "");
			  }
			}
			
			// Clean leading/trailing spaces, non-alphanumeric at boundaries
			clientName = clientName.replace(/^[\s\-_#]+|[\s\-_#]+$/g, "").trim();
			if (!clientName) {
			  clientName = origName;
			}
			
			const displayTicket = finalTicketNum || "TICKET";
			rearrangedName = `${clientName} - #${displayTicket} [RESOLVED]`.toUpperCase();
		  }
		} catch (nameErr) {
		  console.error("Error fetching task for name rearrangement:", nameErr);
		}

		// Post comment to ClickUp
		await fetch(`https://api.clickup.com/api/v2/task/${task_id}/comment`, {
		  method: "POST",
		  headers: await getClickupHeaders(),
		  body: JSON.stringify({ comment_text: `CLOSURE NOTE: ${translated}` })
		});

		// Update status in ClickUp (Do NOT touch the name of the task)
		const updatePayload: any = { status: "Closed" };
		await fetch(`https://api.clickup.com/api/v2/task/${task_id}`, {
		  method: "PUT",
		  headers: await getClickupHeaders(),
		  body: JSON.stringify(updatePayload)
		});

		// Post resolution ID if present
		if (resolution_id) {
		  const cfId = "55638270-b614-4783-ad1c-0bd994d6484b";
		  await fetch(`https://api.clickup.com/api/v2/task/${task_id}/field/${cfId}`, {
			method: "POST",
			headers: await getClickupHeaders(),
			body: JSON.stringify({ value: resolution_id })
		  });
		}

		// Call Zapier MCP Connect Webhook
		const finalZapierToken = zapier_token || process.env.ZAPIER_MCP_TOKEN || "";
		const zapierUrl = `https://mcp.zapier.com/api/v1/connect?token=${finalZapierToken}`;
		try {
		  await fetch(zapierUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
			  event: "ticket_closed",
			  task_id,
			  rearranged_name: rearrangedName,
			  comment: translated,
			  resolution_id,
			  ticket_number
			})
		  });
		} catch (zapierErr: any) {
		  console.warn("Warning triggering Zapier MCP Webhook:", zapierErr.message);
		}

		// Try to solve/close the ticket directly on Zendesk via Zapier MCP Action
		let zendeskStatus = "no_attempted";
		let zendeskMessage = "No se proporcionó número de ticket de Zendesk.";

		if (ticket_number && ticket_number.trim()) {
		  const cleanTicketNum = ticket_number.trim();

		  try {
			console.log(`🚀 Intentando cerrar Ticket de Zendesk "${cleanTicketNum}" mediante Zapier MCP`);
			
			// Paso 1: Agregar nota interna usando el helper canónico addNoteByTicketIdRaw (que maneja pre-lookup internamente)
			console.log(`📝 Paso 1/2: Agregando nota interna al ticket "${cleanTicketNum}"...`);
			const noteResult = await addNoteByTicketIdRaw(zapierUrl, cleanTicketNum, `CLOSURE NOTE: ${translated}`);
			console.log("✅ Nota interna agregada vía canonical helper:", noteResult);

			// Paso 2: Cerrar ticket usando la acción update_ticket_v2 o raw PUT
			console.log(`🔒 Paso 2/2: Cerrando ticket "${cleanTicketNum}"...`);
			const subdomain = process.env.ZENDESK_SUBDOMAIN || "vipcosmetics";
			const zendeskSub = subdomain.toLowerCase().trim();
			const updateTicketUrl = `https://${zendeskSub}.zendesk.com/api/v2/tickets/${cleanTicketNum}.json`;
			let closeResult = null;
			try {
			  closeResult = await callZapierMcp(zapierUrl, {
				selected_api: "ZendeskV2CLIAPI",
				action: "_zap_raw_request",
				instructions: `Make a PUT request to solve/close Zendesk ticket with ID ${cleanTicketNum}. URL is "${updateTicketUrl}".`,
				params: {
				  url: updateTicketUrl,
				  method: "PUT",
				  headers: {
					"Content-Type": "application/json"
				  },
				  body: JSON.stringify({
					ticket: {
					  status: "solved"
					}
				  }),
				  fail_on_errors: false
				},
				output: "ticket"
			  });
			  console.log("✅ Ticket cerrado vía raw PUT:", closeResult);
			} catch (rawCloseErr: any) {
			  console.log(`ℹ️ Cierre raw falló, intentando método clásico: ${rawCloseErr.message}`);
			  closeResult = await callZapierMcp(zapierUrl, {
				selected_api: "ZendeskV2CLIAPI",
				action: "update_ticket_v2",
				instructions: `Update ticket with numeric ID "${cleanTicketNum}" in Zendesk. Set its status to 'solved' and its status category to 'solve'. Do not ask for confirmation.`,
				params: {
				  ticket: cleanTicketNum,
				  status: "solved"
				},
				output: "id, status, subject"
			  });
			  console.log("✅ Ticket cerrado vía clásica:", closeResult);
			}
	 
			zendeskStatus = "success";
			zendeskMessage = `Ticket "${cleanTicketNum}" cerrado exitosamente en Zendesk con nota interna registrada.`;
		  } catch (zErr: any) {
			zendeskStatus = "failed";
			zendeskMessage = `Zapier unconfigured or action failed: ${zErr.message}`;
			console.log("ℹ️ Zendesk auto-closure skipped or failed:", zErr.message);
		  }
		}

		res.json({ 
		  status: "Updated", 
		  rearranged_name: rearrangedName,
		  zendesk_status: zendeskStatus,
		  zendesk_message: zendeskMessage
		});
	  } catch (err: any) {
		res.status(500).json({ error: err.message });
	  }
	});

	// Get task details, phone and timezone
	app.get("/api/task-details/:id", async (req, res) => {
	  const { id } = req.params;
	  try {
		const url = `https://api.clickup.com/api/v2/task/${id}`;
		const response = await fetch(url, { headers: { "Authorization": CLICKUP_API_KEY } });
		if (!response.ok) {
		  return res.status(400).json({ error: "Error fetching task details from ClickUp" });
		}
		const data = await response.json() as any;

		// Resolve phone
		const phonesMap = await obtenerPhones();
		let phone = phonesMap[id] || "";
		if (!phone) {
		  const phoneField = (data.custom_fields || []).find((f: any) => 
			f.name && typeof f.name === "string" && (
			  f.name.toLowerCase().includes("phone") || 
			  f.name.toLowerCase().includes("teléfono") || 
			  f.name.toLowerCase().includes("telefono")
			)
		  );
		  if (phoneField && phoneField.value !== undefined) {
			phone = phoneField.value;
		  }
		}

		// Resolve timezone
		const timezonesMap = await obtenerTimezones();
		const tz = timezonesMap[id] || "EST";

		// Resolve Zendesk Ticket ID
		const zendeskMap = await obtenerZendeskTicketIds();
		const zendeskTicketId = zendeskMap[id] || "";

		// Resolve Answered Time
		const answeredTimesMap = await obtenerAnsweredTimes();
		const answeredAt = answeredTimesMap[id] || null;

		res.json({
		  id: data.id,
		  name: data.name,
		  description: data.description,
		  status: data.status?.status,
		  phone,
		  timezone: tz,
		  zendesk_ticket_id: zendeskTicketId,
		  custom_fields: data.custom_fields || [],
		  answered_at: answeredAt
		});
	  } catch (err: any) {
		res.status(500).json({ error: err.message });
	  }
	});

	// Update client details: phone, timezone and optionally ClickUp Task ID association
	app.post("/api/update-client-info", async (req, res) => {
	  const { task_id, phone, timezone, new_task_id, zendesk_ticket_id } = req.body;
	  try {
		let activeTaskId = task_id;

		if (new_task_id && new_task_id.trim() && new_task_id.trim() !== task_id) {
		  const targetNewTaskId = new_task_id.trim();
		  
		  // Move timezone record
		  const tzMap = await obtenerTimezones();
		  const existingTz = tzMap[task_id] || timezone || "EST";
		  tzMap[targetNewTaskId] = existingTz;
		  if (tzMap[task_id]) {
			delete tzMap[task_id];
		  }
		  await fsp.writeFile(path.join(process.cwd(), "src", "data", "timezones.json"), JSON.stringify(tzMap, null, 2), "utf-8");
		  
		  // Move phone record
		  const phMap = await obtenerPhones();
		  const existingPh = phMap[task_id] || phone || "";
		  if (existingPh) {
			phMap[targetNewTaskId] = existingPh;
		  }
		  if (phMap[task_id]) {
			delete phMap[task_id];
		  }
		  await fsp.writeFile(path.join(process.cwd(), "src", "data", "phones.json"), JSON.stringify(phMap, null, 2), "utf-8");

		  // Move Zendesk Ticket record
		  const zdMap = await obtenerZendeskTicketIds();
		  const existingZd = zdMap[task_id] || zendesk_ticket_id || "";
		  if (existingZd) {
			zdMap[targetNewTaskId] = existingZd;
		  }
		  if (zdMap[task_id]) {
			delete zdMap[task_id];
		  }
		  await fsp.writeFile(path.join(process.cwd(), "src", "data", "zendesk_tickets.json"), JSON.stringify(zdMap, null, 2), "utf-8");

		  activeTaskId = targetNewTaskId;
		}

		if (timezone) {
		  await guardarTimezone(activeTaskId, timezone);
		}
		if (phone) {
		  await guardarPhone(activeTaskId, phone);
		}
		if (zendesk_ticket_id !== undefined) {
		  await guardarZendeskTicketId(activeTaskId, zendesk_ticket_id.trim());
		}

		// Try to update phone in ClickUp custom fields
		if (phone) {
		  try {
			const getUrl = `https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/field`;
			const fResponse = await fetch(getUrl, { headers: { "Authorization": CLICKUP_API_KEY } });
			if (fResponse.ok) {
			  const fData = await fResponse.json() as any;
			  const fields = fData.fields || [];
			  const phoneField = fields.find((f: any) => 
				f.name && typeof f.name === "string" && (
				  f.name.toLowerCase().includes("phone") || 
				  f.name.toLowerCase().includes("teléfono") || 
				  f.name.toLowerCase().includes("telefono")
				)
			  );
			  if (phoneField) {
				const updateUrl = `https://api.clickup.com/api/v2/task/${activeTaskId}/field/${phoneField.id}`;
				await fetch(updateUrl, {
				  method: "POST",
				  headers: await getClickupHeaders(),
				  body: JSON.stringify({ value: phone })
				});
			  }
			}
		  } catch (clickupErr) {
			console.error("Could not update phone in ClickUp custom fields:", clickupErr);
		  }
		}

		logMetric("client_info_updated", 0.05, { task_id: activeTaskId, phone, timezone });
		res.json({ status: "ok", task_id: activeTaskId });
	  } catch (err: any) {
		res.status(500).json({ error: err.message });
	  }
	});

	// Task specific AI chat endpoint
	app.post("/api/task-chat", async (req, res) => {
	  const { task_id, query } = req.body;

	  try {
		const { data: manual, filename: sourceFilename } = await seleccionarManualPorContexto(query);
		const clickupUrl = `https://api.clickup.com/api/v2/task/${task_id}`;
		const response = await fetch(clickupUrl, { headers: { "Authorization": CLICKUP_API_KEY } });

		if (!response.ok) {
		  return res.json({ answer: "Error: No pude descargar los datos de esta tarea desde ClickUp." });
		}

		const target = await response.json() as any;
		const hilo = await fetchTaskComments(task_id, 30);
		const descripcionTarea = target.description || "Sin descripción";
		const statusActual = (target.status?.status || "Desconocido").toUpperCase();

		const manualFiltrado = filtrarManualRelevante(query, manual);

		const promptFinal = `TAREA EN CLICKUP: ${target.name}
	ESTATUS ACTUAL: ${statusActual}
	DESCRIPCIÓN ORIGINAL: ${descripcionTarea}

	HILO DE COMENTARIOS DISPONIBLES: 
	${hilo}

	MANUAL OPERATIVO Y POLÍTICAS (SI APLICA): 
	${manualFiltrado}

	PREGUNTA DEL USUARIO SOBRE ESTE CASO ESPECÍFICO: ${query}

	INSTRUCCIONES:
	Eres Donna, la IA de asistencia ejecutiva de Morena Mia Beauty Group. El usuario tiene este ticket abierto frente a él. 
	Lee todo el hilo de comentarios y responde su pregunta basándote ÚNICAMENTE en la información de este caso y tu manual.
	Sé clara, directa, amigable y muy profesional. Si te pide un resumen, cuéntale la historia del ticket de forma breve y fluida. 

	💼 OFFICIAL CORPORATE TONE (INTERNAL):
	Usa el vocabulario oficial de la empresa. Reconoce términos como "First Sale Refund", "GBK (Give Back tax refund)", "Shalem (Payment plan)", y "Docusign". Si sugieres respuestas para el cliente, usa un tono ejecutivo: "We would like to compensate you by offering..." o "Please let us know your preference to continue with the process".
	- 🚨 PROHIBICIÓN DE FORMATO EMAIL: A menos que yo te pida explícitamente "redacta un correo", tu respuesta debe ser una plática directa y al grano conmigo. Cero saludos formales ("Dear...") ni despedidas ("Best regards").

	🚫 REGLA ESTRICTA DE "FALSOS POSITIVOS" Y CITAS: 
	- 🚨 JAMÁS uses frases como "[AGENTE INTENTÓ CONTACTAR PERO CLIENTE NO RESPONDIÓ]" para justify que hubo contacto. Esas etiquetas significan que el contacto FALLÓ rotundamente.`;

		const answer = await callGroq(promptFinal, "Eres una IA asistente de atención al cliente experta. Respondes de manera clara, directa y natural sobre el caso que se te presenta.");
		res.json({ answer, source_file: sourceFilename });
	  } catch (err: any) {
		console.error("Task Chat Error:", err);
		res.json({ answer: `Error interno: ${err.message}` });
	  }
	});

	// Specific ClickUp List Fetch (223500803)
	app.get("/api/v2/list/223500803", async (req, res) => {
	  try {
		const url = "https://api.clickup.com/api/v2/list/223500803/task?include_closed=false";
		const response = await fetch(url, { headers: { "Authorization": CLICKUP_API_KEY } });

		if (!response.ok) {
		  console.error("Error fetching list 223500803:", await response.text());
		  return res.status(400).json({ error: "Error al conectar con la lista de reembolsos de ClickUp." });
		}

		const data = await response.json() as any;
		const tasks = data.tasks || [];
		const formatted = tasks.map((t: any) => {
		  const due = t.due_date;
		  const dueStr = due ? new Date(parseInt(due)).toLocaleDateString("es-ES") : "Sin fecha";
		  return {
			id: t.id,
			name: t.name,
			status: (t.status?.status || "").toUpperCase(),
			url: t.url,
			due_date: dueStr
		  };
		});

		res.json({ tasks: formatted });
	  } catch (err: any) {
		res.status(500).json({ error: err.message });
	  }
	});

	// Spy Statuses
	app.get("/api/spy-statuses", async (req, res) => {
	  const listId = req.query.list_id as string || "223500803";
	  const url = `https://api.clickup.com/api/v2/list/${listId}`;

	  try {
		const response = await fetch(url, { headers: { "Authorization": CLICKUP_API_KEY } });
		if (!response.ok) {
		  return res.status(400).json({ error: "No se pudo obtener la lista de ClickUp" });
		}
		const data = await response.json() as any;
		res.json({
		  list_name: data.name,
		  valid_statuses: (data.statuses || []).map((s: any) => s.status)
		});
	  } catch (err: any) {
		res.status(500).json({ error: err.message });
	  }
	});

	// Duplicate to Refunds List
	app.post("/api/duplicate-refund", async (req, res) => {
	  const { task_id, method, type } = req.body;
	  const targetMethod = method || "CHECK / WIRE TRANSFER";
	  const targetType = type || "FULL/PARTIAL REFUND";

	  try {
		const url = `https://api.clickup.com/api/v2/task/${task_id}`;
		const response = await fetch(url, { headers: { "Authorization": CLICKUP_API_KEY } });

		if (!response.ok) {
		  return res.status(400).json({ error: "No se pudo descargar la tarea original de ClickUp." });
		}

		const original = await response.ok ? await response.json() as any : null;
		const originalName = original.name || "INVOICE";
		const invoice = originalName.includes("-") ? originalName.split("-")[0].trim() : originalName;

		const nuevoNombre = `${invoice} + ${targetMethod.toUpperCase()} + ${targetType.toUpperCase()}`;

		let plantillaDatos = "";
		if (targetMethod.toUpperCase().includes("WIRE") || targetMethod.toUpperCase().includes("TRANSFER")) {
		  plantillaDatos = `\n\n======================================\n🏦 REQUIRED INFO FOR WIRE TRANSFER:\n======================================\nCustomer name: \nBank name: \nBank account number: \nBilling address: \nPhone: \nSWIFT code / ABA: \nAmount in USD: \nIntermediary bank info (if provided): \n`;
		} else if (targetMethod.toUpperCase().includes("CHECK") || targetMethod.toUpperCase().includes("CHEQUE")) {
		  plantillaDatos = `\n\n======================================\n✉️ REQUIRED INFO FOR CHECK:\n======================================\nFull name: \nHome address: \nBilling address: \n`;
		}

		const descripcionFinal = (original.description || "") + plantillaDatos;

		const customFields: any[] = [];
		for (const cf of (original.custom_fields || [])) {
		  if (cf.value !== undefined && cf.value !== null) {
			customFields.push({ id: cf.id, value: cf.value });
		  }
		}

		// Post to list 223500803
		const postUrl = "https://api.clickup.com/api/v2/list/223500803/task";
		const createRes = await fetch(url_for_list_tasks(223500803), {
		  method: "POST",
		  headers: { "Authorization": CLICKUP_API_KEY, "Content-Type": "application/json" },
		  body: JSON.stringify({
			name: nuevoNombre,
			description: descripcionFinal,
			assignees: [ID_LORENZO],
			custom_fields: customFields
		  })
		});

		if (!createRes.ok) {
		  const errorText = await createRes.text();
		  return res.status(400).json({ error: `ClickUp error cloning task: ${errorText}` });
		}

		const nuevaTarea = await createRes.json() as any;
		logMetric("task_cloned_to_refunds", 0.2, { original_id: task_id, new_id: nuevaTarea.id });

		res.json({ status: "ok", new_task_url: nuevaTarea.url, new_name: nuevoNombre });

	  } catch (error: any) {
		res.status(500).json({ error: error.message });
	  }
	});

	// Helper for 223500803 duplication endpoint vars
	function url_for_list_tasks(listId: number) {
	  return `https://api.clickup.com/api/v2/list/${listId}/task`;
	}

	// 3b-1. Citrix ShareFile Directory Listing Endpoint
	async function refreshShareFileAccessToken(): Promise<string | null> {
	  const clientId = process.env.SHAREFILE_CLIENT_ID;
	  const clientSecret = process.env.SHAREFILE_CLIENT_SECRET;
	  const username = process.env.SHAREFILE_USERNAME;
	  const password = process.env.SHAREFILE_PASSWORD;
	  const apiBaseUrl = process.env.SHAREFILE_API_BASE_URL;

	  if (!clientId || !clientSecret || !username || !password) {
		console.log("[ShareFile Token Refresh] Missing OAuth credentials in env variables.");
		return null;
	  }

	  let subdomain = "MorenaMiaBeautyGroup";
	  if (apiBaseUrl) {
		const match = apiBaseUrl.match(/https?:\/\/([^.]+)\.(?:sf-api\.com|sharefile\.com)/i);
		if (match && match[1]) {
		  subdomain = match[1];
		}
	  }

	  const tokenUrl = `https://${subdomain}.sharefile.com/oauth/token`;
	  console.log(`[ShareFile Token Refresh] Attempting auto-renewal at: ${tokenUrl}`);

	  try {
		const params = new URLSearchParams();
		params.append("grant_type", "password");
		params.append("client_id", clientId);
		params.append("client_secret", clientSecret);
		params.append("username", username);
		params.append("password", password);

		const response = await fetch(tokenUrl, {
		  method: "POST",
		  headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		  },
		  body: params.toString(),
		});

		if (!response.ok) {
		  const errText = await response.text();
		  console.error(`[ShareFile Token Refresh Failed] Status: ${response.status}. Body:`, errText);
		  return null;
		}

		const data = await response.json() as any;
		const accessToken = data.access_token;
		if (accessToken) {
		  console.log("[ShareFile Token Refresh] Successfully acquired new Access Token!");
		  process.env.SHAREFILE_ACCESS_TOKEN = accessToken;

		  // Persist to .env
		  try {
			const envPath = path.join(process.cwd(), ".env");
			let envLines: string[] = [];
			if (fs.existsSync(envPath)) {
			  const envContent = await fsp.readFile(envPath, "utf-8");
			  envLines = envContent.split("\n");
			}
			const setEnvVar = (key: string, value: string) => {
			  const idx = envLines.findIndex(line => line.trim().startsWith(`${key}=`));
			  if (idx !== -1) {
				envLines[idx] = `${key}="${value}"`;
			  } else {
				envLines.push(`${key}="${value}"`);
			  }
			};
			setEnvVar("SHAREFILE_ACCESS_TOKEN", accessToken);
			await fsp.writeFile(envPath, envLines.join("\n"), "utf-8");
			await backupEnvToSupabase();
		  } catch (e: any) {
			console.error("[ShareFile Token Refresh] Failed to save new token to .env:", e.message);
		  }

		  return accessToken;
		}
	  } catch (err: any) {
		console.error("[ShareFile Token Refresh Error]", err);
	  }

	  return null;
	}

	app.get("/api/sharefile/items", async (req, res) => {
	  try {
		let token = process.env.SHAREFILE_ACCESS_TOKEN;
		const apiBaseUrl = process.env.SHAREFILE_API_BASE_URL;
		const searchQuery = req.query.search;
		const orderby = req.query.orderby || "name";
		const maxResults = req.query.maxResults || 50;

		let subdomain = "MorenaMiaBeautyGroup";
		if (apiBaseUrl) {
		  const match = apiBaseUrl.match(/https?:\/\/([^.]+)\.(?:sf-api\.com|sharefile\.com)/i);
		  if (match && match[1]) {
			subdomain = match[1];
		  }
		}

		if (searchQuery) {
		  if (!token || !apiBaseUrl) {
			console.log(`[ShareFile Items API] No credentials. Returning filtered demo items for query: ${searchQuery}`);
			const demoItems = [
			  { Id: "fo32815666-b256-426d-a2c1-96739be6ee7f", Name: "Carpeta Principal (MMBG Demo)", "odata.type": "ShareFile.Api.Models.Folder", FileCount: 4, CreationDate: new Date().toISOString() },
			  { Id: "foee4bfc-ec95-4a6f-8f53-440619269669", Name: "Terminal A (Demo Folder)", "odata.type": "ShareFile.Api.Models.Folder", FileCount: 2, CreationDate: new Date().toISOString() },
			  { Id: "fida6f93-a3a5-2ea0-c174-5eee5e020526", Name: "EMPIRETECH_INV.jpg (Demo File)", "odata.type": "ShareFile.Api.Models.File", FileSizeBytes: 204800, CreationDate: new Date().toISOString(), ParentName: "Terminal A (Demo Folder)", ParentId: "foee4bfc-ec95-4a6f-8f53-440619269669" },
			  { Id: "fida6f93-a3a5-2ea0-c174-5eee5e020527", Name: "COSTA_MAY_INV.png (Demo File)", "odata.type": "ShareFile.Api.Models.File", FileSizeBytes: 145000, CreationDate: new Date().toISOString(), ParentName: "Terminal A (Demo Folder)", ParentId: "foee4bfc-ec95-4a6f-8f53-440619269669" },
			  { Id: "fida6f93-a3a5-2ea0-c174-5eee5e020528", Name: "CANCUN_STORE_INV_992.jpg (Demo File)", "odata.type": "ShareFile.Api.Models.File", FileSizeBytes: 189000, CreationDate: new Date().toISOString(), ParentName: "Carpeta Principal (MMBG Demo)", ParentId: "fo32815666-b256-426d-a2c1-96739be6ee7f" }
			];
			const normalizedDemo = demoItems.map(normalizeShareFileItem);
			const filteredDemo = normalizedDemo.filter(item => 
			  item.Name.toLowerCase().includes(String(searchQuery).toLowerCase()) ||
			  item.Id.toLowerCase().includes(String(searchQuery).toLowerCase())
			);
			const processedDemo = applyBackendFiltersAndPagination(filteredDemo, req.query);
			return res.json({
			  success: true,
			  isDemo: true,
			  subdomain,
			  items: processedDemo
			});
		  }

		  const baseUrl = apiBaseUrl.replace(/\/$/, "");
		  const url = `${baseUrl}/Items/Search?query=${encodeURIComponent(searchQuery as string)}&orderby=${encodeURIComponent(orderby as string)}&maxResults=${maxResults}`;
		  console.log(`[ShareFile Items API] Searching for items matching: ${searchQuery} (orderby=${orderby}, maxResults=${maxResults})`);
		  
		  let sfResponse = await fetch(url, {
			headers: { 
			  "Authorization": `Bearer ${token}`,
			  "Accept": "application/json"
			}
		  });

		  if (!sfResponse.ok && sfResponse.status === 401) {
			console.warn("[ShareFile Items API] Access token expired (401) during search. Attempting auto-renew...");
			const newToken = await refreshShareFileAccessToken();
			if (newToken) {
			  console.log("[ShareFile Items API] Token renewed successfully. Retrying search...");
			  token = newToken;
			  sfResponse = await fetch(url, {
				headers: { 
				  "Authorization": `Bearer ${newToken}`,
				  "Accept": "application/json"
				}
			  });
			}
		  }

		  if (!sfResponse.ok) {
			const errText = await sfResponse.text();
			console.error(`[ShareFile Items Search Failed] Status: ${sfResponse.status}. Body:`, errText);
			throw new Error(`ShareFile Search returned status ${sfResponse.status}: ${errText}`);
		  }

		  const data = await sfResponse.json();
		  const rawResults = data.value || data.Results || data.results || (Array.isArray(data) ? data : []);
		  const normalizedResults = Array.isArray(rawResults)
			? rawResults.map(normalizeShareFileItem).filter(Boolean)
			: [];

		  // Aplicamos el motor de filtrado y paginación en el Backend
		  const processedResults = applyBackendFiltersAndPagination(normalizedResults, req.query);

		  console.log(`[ShareFile Items API] Found ${normalizedResults.length} search results. After backend filters & pagination: ${processedResults.length}`);
		  return res.json({
			success: true,
			isDemo: false,
			actualFolderId: "search",
			subdomain,
			items: processedResults
		  });
		}

		if (!token || !apiBaseUrl) {
		  // Return demo items when live credentials are not set up
		  console.log("[ShareFile Items API] No credentials. Returning demo item listing.");
		  const demoItems = [
			{ Id: "fo32815666-b256-426d-a2c1-96739be6ee7f", Name: "Carpeta Principal (MMBG Demo)", "odata.type": "ShareFile.Api.Models.Folder", FileCount: 4, CreationDate: new Date().toISOString() },
			{ Id: "foee4bfc-ec95-4a6f-8f53-440619269669", Name: "Terminal A (Demo Folder)", "odata.type": "ShareFile.Api.Models.Folder", FileCount: 2, CreationDate: new Date().toISOString() },
			{ Id: "fida6f93-a3a5-2ea0-c174-5eee5e020526", Name: "EMPIRETECH_INV.jpg (Demo File)", "odata.type": "ShareFile.Api.Models.File", FileSizeBytes: 204800, CreationDate: new Date().toISOString(), ParentName: "Terminal A (Demo Folder)", ParentId: "foee4bfc-ec95-4a6f-8f53-440619269669" },
			{ Id: "fida6f93-a3a5-2ea0-c174-5eee5e020527", Name: "COSTA_MAY_INV.png (Demo File)", "odata.type": "ShareFile.Api.Models.File", FileSizeBytes: 145000, CreationDate: new Date().toISOString(), ParentName: "Terminal A (Demo Folder)", ParentId: "foee4bfc-ec95-4a6f-8f53-440619269669" },
			{ Id: "fida6f93-a3a5-2ea0-c174-5eee5e020528", Name: "CANCUN_STORE_INV_992.jpg (Demo File)", "odata.type": "ShareFile.Api.Models.File", FileSizeBytes: 189000, CreationDate: new Date().toISOString(), ParentName: "Carpeta Principal (MMBG Demo)", ParentId: "fo32815666-b256-426d-a2c1-96739be6ee7f" }
		  ];
		  const processedDemo = applyBackendFiltersAndPagination(demoItems.map(normalizeShareFileItem), req.query);
		  return res.json({
			success: true,
			isDemo: true,
			subdomain,
			items: processedDemo
		  });
		}

		let itemId = (req.query.id as string) || "fo32815666-b256-426d-a2c1-96739be6ee7f"; // Morena Mia Beauty Group home folder ID default
		if (itemId && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(itemId)) {
		   itemId = `fo${itemId}`;
		}
		const baseUrl = apiBaseUrl.replace(/\/$/, "");
		// Código modificado correcto:
		let url = `${baseUrl}/Items(${itemId})/Children?$top=1000`;

		console.log(`[ShareFile Items API] Fetching children for Item ID: ${itemId}`);
		let sfResponse = await fetch(url, {
		  headers: { 
			"Authorization": `Bearer ${token}`,
			"Accept": "application/json"
		  }
		});

		if (!sfResponse.ok && sfResponse.status === 401) {
		  console.warn("[ShareFile Items API] Access token expired (401) during children listing. Attempting auto-renew...");
		  const newToken = await refreshShareFileAccessToken();
		  if (newToken) {
			console.log("[ShareFile Items API] Token renewed successfully. Retrying children listing...");
			token = newToken;
			sfResponse = await fetch(url, {
			  headers: { 
				"Authorization": `Bearer ${newToken}`,
				"Accept": "application/json"
			  }
			});
		  }
		}

		let actualFolderId = itemId;

		// Handle 404 fallback chain
		if (!sfResponse.ok && sfResponse.status === 404) {
		  console.warn(`[ShareFile Items API 404] Item ID ${itemId} not found. Attempting fallback to 'allfolders'...`);
		  actualFolderId = "allfolders";
		  url = `${baseUrl}/Items(${actualFolderId})/Children`;
		  sfResponse = await fetch(url, {
			headers: { 
			  "Authorization": `Bearer ${token}`,
			  "Accept": "application/json"
			}
		  });

		  if (!sfResponse.ok && sfResponse.status === 404) {
			console.warn(`[ShareFile Items API 404] 'allfolders' not found. Attempting fallback to 'root'...`);
			actualFolderId = "root";
			url = `${baseUrl}/Items(${actualFolderId})/Children`;
			sfResponse = await fetch(url, {
			  headers: { 
				"Authorization": `Bearer ${token}`,
				"Accept": "application/json"
			  }
			});

			if (!sfResponse.ok && sfResponse.status === 404) {
			  console.warn(`[ShareFile Items API 404] 'root' not found. Attempting fallback to 'home'...`);
			  actualFolderId = "home";
			  url = `${baseUrl}/Items(${actualFolderId})/Children`;
			  sfResponse = await fetch(url, {
				headers: { 
				  "Authorization": `Bearer ${token}`,
				  "Accept": "application/json"
				}
			  });
			}
		  }
		}

		if (!sfResponse.ok) {
		  const errText = await sfResponse.text();
		  console.error(`[ShareFile Items API Failed] Status: ${sfResponse.status}. Body:`, errText);
		  throw new Error(`ShareFile Items request returned status ${sfResponse.status}: ${errText}`);
		}

		const data = await sfResponse.json();
		const rawResults = data.value || [];
		const normalizedResults = Array.isArray(rawResults)
		  ? rawResults.map(normalizeShareFileItem).filter(Boolean)
		  : [];

		// Aplicamos el motor de filtrado y paginación en el Backend
		const processedResults = applyBackendFiltersAndPagination(normalizedResults, req.query);

		res.json({
		  success: true,
		  isDemo: false,
		  actualFolderId: actualFolderId,
		  items: processedResults
		});
	  } catch (e: any) {
		console.error("[ShareFile Items API Error - Falling back to Demo]", e);
		const demoItems = [
		  { Id: "fo32815666-b256-426d-a2c1-96739be6ee7f", Name: "Carpeta Principal (MMBG Demo)", "odata.type": "ShareFile.Api.Models.Folder", FileCount: 4, CreationDate: new Date().toISOString() },
		  { Id: "foee4bfc-ec95-4a6f-8f53-440619269669", Name: "Terminal A (Demo Folder)", "odata.type": "ShareFile.Api.Models.Folder", FileCount: 2, CreationDate: new Date().toISOString() },
		  { Id: "fida6f93-a3a5-2ea0-c174-5eee5e020526", Name: "EMPIRETECH_INV.jpg (Demo File)", "odata.type": "ShareFile.Api.Models.File", FileSizeBytes: 204800, CreationDate: new Date().toISOString(), ParentName: "Terminal A (Demo Folder)", ParentId: "foee4bfc-ec95-4a6f-8f53-440619269669" },
		  { Id: "fida6f93-a3a5-2ea0-c174-5eee5e020527", Name: "COSTA_MAY_INV.png (Demo File)", "odata.type": "ShareFile.Api.Models.File", FileSizeBytes: 145000, CreationDate: new Date().toISOString(), ParentName: "Terminal A (Demo Folder)", ParentId: "foee4bfc-ec95-4a6f-8f53-440619269669" },
		  { Id: "fida6f93-a3a5-2ea0-c174-5eee5e020528", Name: "CANCUN_STORE_INV_992.jpg (Demo File)", "odata.type": "ShareFile.Api.Models.File", FileSizeBytes: 189000, CreationDate: new Date().toISOString(), ParentName: "Carpeta Principal (MMBG Demo)", ParentId: "fo32815666-b256-426d-a2c1-96739be6ee7f" }
		];

		const searchQuery = req.query.search;
		let filteredDemo = demoItems.map(normalizeShareFileItem);
		if (searchQuery) {
		  filteredDemo = filteredDemo.filter(item => 
			item.Name.toLowerCase().includes(String(searchQuery).toLowerCase()) ||
			item.Id.toLowerCase().includes(String(searchQuery).toLowerCase())
		  );
		}
		const processedDemo = applyBackendFiltersAndPagination(filteredDemo, req.query);
		
		const isAuthError = !!(e.message && (e.message.includes("401") || e.message.includes("Unauthorized") || e.message.includes("NotAuthenticated")));

		res.json({
		  success: true,
		  isDemo: true,
		  authError: isAuthError,
		  actualFolderId: "demo_fallback",
		  items: processedDemo,
		  warning: `Las credenciales de ShareFile fallaron (${e.message}). Mostrando datos de demostración.`
		});
	  }
	});

	// Endpoint especializado para buscar la carpeta de ShareFile según criterios complejos (Sistema de 2 Consultas)
	app.post("/api/sharefile/search-folder", async (req, res) => {
	  try {
		const { invoice, name, saleDate, storeLocation } = req.body;
		let token = process.env.SHAREFILE_ACCESS_TOKEN;
		const apiBaseUrl = process.env.SHAREFILE_API_BASE_URL;

		if (!token || !apiBaseUrl) {
		  console.log(`[ShareFile Search Folder] No credentials. Returning demo folder URL for invoice: ${invoice}`);
		  return res.json({
			success: true,
			isDemo: true,
			url: `https://morenamia.sharefile.com/d/s-demo-${invoice}`
		  });
		}

		const baseUrl = apiBaseUrl.replace(/\/$/, "");
		const firstPartName = (name || "").split(" ")[0].toLowerCase();
		const cleanInvoice = String(invoice).trim().toLowerCase();

		// --- ESTRATEGIA DE 2 CONSULTAS ---

		// 1. Primera Consulta: Localización Quirúrgica por Invoice (Búsqueda Global de JPGs)
		console.log(`[ShareFile Search Folder] Stage 1: Global search for JPGs containing invoice ${cleanInvoice}`);
		const searchUrl = `${baseUrl}/Items/Search?query=${encodeURIComponent(cleanInvoice)}&maxResults=50`;
		
		let searchRes = await fetch(searchUrl, {
		  headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
		});

		if (!searchRes.ok && searchRes.status === 401) {
		  console.warn("[ShareFile Search Folder] Access token expired (401) during stage 1 search. Attempting auto-renew...");
		  const newToken = await refreshShareFileAccessToken();
		  if (newToken) {
			console.log("[ShareFile Search Folder] Token renewed successfully. Retrying stage 1 search...");
			token = newToken;
			searchRes = await fetch(searchUrl, {
			  headers: { "Authorization": `Bearer ${newToken}`, "Accept": "application/json" }
			});
		  }
		}

		if (!searchRes.ok) {
		  throw new Error(`ShareFile Search API returned ${searchRes.status}`);
		}

		const searchData = await searchRes.json();
		const rawResults = searchData.value || searchData.Results || searchData.results || [];
		const isBlacklistedId = (id?: string) => {
		  if (!id) return false;
		  const cleanId = id.toLowerCase().replace(/^fo/, "");
		  return (
			cleanId === "6b2509-a991-44b8-ad3c-9487044e1a1b" ||
			cleanId === "9c5582-8d50-4b3e-b804-8c515257a597" ||
			cleanId === "1c26e6-259d-44aa-a7b6-ef411e0a51cf" ||
			cleanId === "1c26e6e6-259d-44aa-a7b6-ef411e0a51cf" ||
			cleanId === "allfolders" ||
			cleanId === "root" ||
			cleanId === "home" ||
			cleanId === "shared"
		  );
		};

		const candidates = rawResults.map(normalizeShareFileItem).filter((item: any) => {
		  if (!item) return false;
		  if (isBlacklistedId(item.Id) || isBlacklistedId(item.ParentId)) return false;
		  const itemName = (item.Name || "").toLowerCase();
		  return itemName.includes(cleanInvoice) || itemName.replace(/[^a-z0-9]/g, "").includes(cleanInvoice.replace(/[^a-z0-9]/g, ""));
		});

		if (candidates.length === 0) {
		  console.log("[ShareFile Search Folder] No candidates found globally matching invoice.");
		  return res.status(404).json({ success: false, message: "No se encontró ningún archivo o carpeta con el número de invoice especificado." });
		}

		// Calificación inteligente y ordenamiento de candidatos (no restrictivo)
		const getCandidateScore = (item: any) => {
		  let score = 0;
		  const itemName = (item.Name || "").toLowerCase();
		  const parentName = (item.ParentName || "").toLowerCase();
		  const itemPath = (item.Path || "").toLowerCase();
		  const isFolder = !!(
			item["odata.type"]?.includes("Folder") ||
			item.typename === "Folder" ||
			item.type === "Folder" ||
			item.FileCount !== undefined ||
			item.FolderCount !== undefined
		  );

		  // 1. Invoice Match
		  const hasInvoice = itemName.includes(cleanInvoice) || 
							itemName.replace(/[^a-z0-9]/g, "").includes(cleanInvoice.replace(/[^a-z0-9]/g, ""));
		  if (hasInvoice) {
			score += 150;
			if (!isFolder) {
			  score += 30;
			  if (itemName.endsWith(".jpg") || itemName.endsWith(".jpeg") || itemName.endsWith(".png")) {
				score += 50;
			  }
			} else {
			  score += 20;
			}
		  }

		  // 2. Coincidencia con sucursal / tienda en nombre de la carpeta o ruta
		  if (storeLocation) {
			const loc = String(storeLocation).trim().toLowerCase();
			if (loc && (parentName.includes(loc) || itemPath.includes(loc) || itemName.includes(loc))) {
			  score += 120;
			}
		  }

		  // 3. Coincidencia de fecha de venta y creación
		  if (saleDate) {
			try {
			  const d1 = new Date(saleDate);
			  const dateStr = item.CreationDate || item.creationDate || "";
			  if (dateStr) {
				const d2 = new Date(dateStr);
				if (d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth()) {
				  score += 80;
				  if (d1.getDate() === d2.getDate()) {
					score += 40; // Bonus por día exacto
				  }
				}
			  }
			} catch (e) {}
		  }

		  // 4. Coincidencia de nombre de cliente en archivo o carpeta
		  if (name) {
			const clientFirstPart = String(name).trim().split(" ")[0].toLowerCase();
			if (clientFirstPart.length > 2) {
			  if (itemName.includes(clientFirstPart) || parentName.includes(clientFirstPart)) {
				score += 30;
			  }
			}
		  }

		  return score;
		};

		const sortedCandidates = [...candidates].sort((a, b) => getCandidateScore(b) - getCandidateScore(a));

		// Tomamos el candidato con mejor puntuación que no esté en la lista negra
		const validCandidate = sortedCandidates.find((item: any) => {
		  const pId = item.ParentId || item.parentId;
		  return !isBlacklistedId(pId);
		});

		if (!validCandidate) {
		  console.log("[ShareFile Search Folder] No candidates found outside blacklisted folder.");
		  return res.status(404).json({ success: false, message: "No se encontró ningún archivo fuera de la carpeta excluida." });
		}

		const findingFile = validCandidate;
		const parentFolderId = findingFile.ParentId || findingFile.parentId;

		if (!parentFolderId) {
		  return res.status(404).json({ success: false, message: "Se encontró el archivo pero no se pudo determinar su carpeta contenedora." });
		}

		// 2. Segunda Consulta: Listado Directo de la Carpeta de Hallazgo
		console.log(`[ShareFile Search Folder] Stage 2: Listing contents of parent folder ID ${parentFolderId}`);
		const childrenUrl = `${baseUrl}/Items(${parentFolderId})/Children`;
		let childrenRes = await fetch(childrenUrl, {
		  headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
		});

		if (!childrenRes.ok && childrenRes.status === 401) {
		  console.warn("[ShareFile Search Folder] Access token expired (401) during stage 2 children fetch. Attempting auto-renew...");
		  const newToken = await refreshShareFileAccessToken();
		  if (newToken) {
			console.log("[ShareFile Search Folder] Token renewed successfully. Retrying stage 2 children fetch...");
			token = newToken;
			childrenRes = await fetch(childrenUrl, {
			  headers: { "Authorization": `Bearer ${newToken}`, "Accept": "application/json" }
			});
		  }
		}

		if (!childrenRes.ok) {
		   throw new Error(`ShareFile Children API returned ${childrenRes.status}`);
		}

		const childrenData = await childrenRes.json();
		const rawChildren = childrenData.value || [];
		const normalizedChildren = rawChildren.map(normalizeShareFileItem).filter(Boolean);

		// --- FUSIÓN, DESDUPLICACIÓN Y COINCIDENCIA FLEXIBLE ---
		// En este caso, ya tenemos los archivos de la carpeta. Vamos a buscar el ítem ID (objeto ShareFile) que cumpla las condiciones.
		// El usuario quiere la URL del ítem ID (objeto de Sharefile que contiene archivos) que cumpla las condiciones.
		// Interpretamos que se refiere a la carpeta contenedora si cumple los requisitos.

		// Verificamos si la carpeta contenedora cumple los requisitos adicionales:
		// a) Fecha de creación coincide con saleDate (new caseform)
		// b) Nombre del archivo contiene invoice + nombre del cliente (primera cadena)
		// c) Carpeta contenedora nombrada similar con "Sucursal / Store Location"

		// Buscamos si alguno de los archivos en esta carpeta (o la carpeta misma) cumple los criterios.
		// El prompt pide "la dirección url del ítem ID ( objeto de Sharefile que contiene archivos) que cumplan con las siguientes condiciones"

		// Verificamos la carpeta padre primero
		const parentUrl = `${baseUrl}/Items(${parentFolderId})`;
		let parentRes = await fetch(parentUrl, {
		  headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
		});

		if (!parentRes.ok && parentRes.status === 401) {
		  console.warn("[ShareFile Search Folder] Access token expired (401) during parent details fetch. Attempting auto-renew...");
		  const newToken = await refreshShareFileAccessToken();
		  if (newToken) {
			console.log("[ShareFile Search Folder] Token renewed successfully. Retrying parent details fetch...");
			token = newToken;
			parentRes = await fetch(parentUrl, {
			  headers: { "Authorization": `Bearer ${newToken}`, "Accept": "application/json" }
			});
		  }
		}
		
		let targetFolder = null;
		if (parentRes.ok) {
		   const parentData = await parentRes.json();
		   targetFolder = normalizeShareFileItem(parentData);
		}

		if (!targetFolder) {
		  return res.status(404).json({ success: false, message: "No se pudo recuperar la información de la carpeta contenedora." });
		}

		const folderName = (targetFolder.Name || "").toLowerCase();
		const folderCreationDate = targetFolder.CreationDate || targetFolder.creationDate;

		// Condición 1: Fecha de creación
		let dateMatches = true;
		if (saleDate && folderCreationDate) {
			const d1 = new Date(saleDate);
			const d2 = new Date(folderCreationDate);
		dateMatches = (d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth());
	}

		// Condición 2: Nombre del cliente y Invoice en los archivos internos
		const hasValidFile = normalizedChildren.some((child: any) => {
		const childName = (child.Name || "").toLowerCase();
		return childName.includes(cleanInvoice);
		});

		// Condición 3: Sucursal / Store Location en el nombre de la carpeta
		let locationMatches = true;
		if (storeLocation) {
			const loc = storeLocation.toLowerCase();
			locationMatches = folderName.includes(loc) || normalizedChildren.some((child: any) => 
				(child.Name || "").toLowerCase().includes(loc)
			);
	}

		// Si la carpeta cumple o contiene archivos que cumplen, devolvemos su URL
		// --- Respuesta flexible: siempre devuelve la URL si se encontró una carpeta ---
		let warnings: string[] = [];
		if (!dateMatches) warnings.push("se verifico mediante #invoice y año/mes).");
		if (!hasValidFile) warnings.push("No se encontró un archivo que contenga el número de invoice en esta carpeta.");
		if (!locationMatches) warnings.push("La carpeta no contiene el nombre de la sucursal en su nombre o en sus archivos.");

// Construir la URL de la carpeta
		let subdomain = "MorenaMiaBeautyGroup";
		const match = apiBaseUrl.match(/https?:\/\/([^.]+)\.(?:sf-api\.com|sharefile\.com)/i);
		if (match && match[1]) subdomain = match[1];

		const folderId = targetFolder.Id.startsWith("fo") ? targetFolder.Id : `fo${targetFolder.Id}`;
		const folderUrl = `https://${subdomain.toLowerCase()}.sharefile.com/home/shared/${folderId}`;

// Siempre devolver éxito, con advertencias si las hay
return res.json({
  success: true,
  url: folderUrl,
  folder: targetFolder,
  warnings: warnings.length > 0 ? warnings : undefined,
  strategy: "2-query-invoice-surgical"
});

		res.status(404).json({ 
		  success: false, 
		  message: "Se localizó una carpeta por invoice, pero no cumple con los criterios de fecha, nombre de cliente o sucursal.",
		  debug: { dateMatches, hasValidFile, locationMatches, folderName, saleDate, folderCreationDate }
		});

	  } catch (error: any) {
		console.error("[ShareFile Search Folder Error]", error);
		const isAuthError = !!(error.message && (error.message.includes("401") || error.message.includes("Unauthorized") || error.message.includes("NotAuthenticated")));
		res.status(500).json({ success: false, error: error.message, authError: isAuthError });
	  }
	});

	// Batch Disputes Sync to Google Sheets
	app.post("/api/batch-disputes-sheets", async (req, res) => {
	  const { invoices } = req.body;
	  logMetric("iniciando_sincronizador", 0.05, { invoices });

	  const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbyGmddG_s2iODqmObggNM8Z97uDjMu6Pey2rGrHJ3DzsCNgpqCypODUWIA2qfeXshNuNA/exec";
	  const LIST_DISPUTES = "48493938";
	  const ID_CF_REASON = "ee1a1e07-a9b6-4209-a7bc-87162005e2f2";

	  try {
		const tasks: any[] = [];
		let page = 0;
		const dateLimit = new Date(2026, 0, 1).getTime(); // Jan 1 2026

		while (true) {
		  const url = `https://api.clickup.com/api/v2/list/${LIST_DISPUTES}/task?include_closed=true&date_updated_gt=${dateLimit}&page=${page}`;
		  const response = await fetch(url, { headers: { "Authorization": CLICKUP_API_KEY } });
		  if (!response.ok) {
			return res.status(400).json({ error: "Error leyendo la lista de disputas de ClickUp." });
		  }
		  const data = await response.json() as any;
		  const pageTasks = data.tasks || [];
		  if (pageTasks.length === 0) {
			break;
		  }
		  tasks.push(...pageTasks);
		  page += 1;
		}

		const resultados: any[] = [];

		for (const invoice of invoices) {
		  const match = tasks.find((t: any) => String(t.name || "").includes(String(invoice)));

		  if (match) {
			let reasonText = "Desconocido";
			for (const cf of (match.custom_fields || [])) {
			  if (cf.id === ID_CF_REASON && cf.value !== undefined && cf.value !== null) {
				const opciones = cf.type_config?.options || [];
				const val = cf.value;
				if (typeof val === "number" && val < opciones.length) {
				  reasonText = opciones[val].name;
				} else if (typeof val === "string") {
				  const optMatch = opciones.find((opt: any) => opt.id === val);
				  if (optMatch) {
					reasonText = optMatch.name;
				  }
				}
			  }
			}

			const leyendaFinal = `dispute/${reasonText}`;

			try {
			  const gasRes = await fetch(WEBHOOK_URL, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ invoice, leyenda: leyendaFinal }),
				redirect: "follow"
			  });

			  if (!gasRes.ok) {
				resultados.push({ invoice, status: `⚠️ HTTP ${gasRes.status}`, leyenda: leyendaFinal });
				continue;
			  }

			  const responseText = await gasRes.text();
			  let gasData: any = {};
			  try {
				gasData = JSON.parse(responseText);
			  } catch (e) {
				gasData = { status: "error", message: responseText };
			  }

			  if (gasData.status === "ok") {
				resultados.push({ invoice, status: `✅ Guardado en Sheets (${gasData.message || "Exitoso"})`, leyenda: leyendaFinal });
			  } else if (gasData.status === "not_found") {
				resultados.push({ invoice, status: "❌ Invoice no encontrado en la Columna A", leyenda: leyendaFinal });
			  } else {
				resultados.push({ invoice, status: `⚠️ Error Apps Script: ${gasData.message || "Desconocido"}`, leyenda: leyendaFinal });
			  }
			} catch (e: any) {
			  resultados.push({ invoice, status: `⚠️ Falla de conexión: ${e.message}`, leyenda: leyendaFinal });
			}
		  } else {
			resultados.push({ invoice, status: "No en Disputes", leyenda: null });
		  }
		}

		res.json({ procesados: invoices.length, resultados });

	  } catch (error: any) {
		console.error("Batch Disputes Error:", error);
		res.status(500).json({ error: error.message });
	  }
	});

	// Vite Middleware for development / Static Server for production
	async function startServer() {
	  // Initialize synchronization from Supabase to local filesystem
	  await syncSupabaseToLocal();

	  if (process.env.NODE_ENV !== "production") {
		const vite = await createViteServer({
		  server: { middlewareMode: true },
		  appType: "spa",
		});
		app.use(vite.middlewares);
	  } else {
		const distPath = path.join(process.cwd(), "dist");
		app.use(express.static(distPath));
		app.get("*", (req, res) => {
		  res.sendFile(path.join(distPath, "index.html"));
		});
	  }

	  app.listen(PORT, "0.0.0.0", () => {
		console.log(`🚀 Morena OS Server running on http://localhost:${PORT}`);
	  });
	}

	// Global Helper Mappings used inside Express endpoints
	function matched_option_id_or_similar(name: string, mapping: any): string {
	  const options = mapping.options || [];
	  const found = options.find((o: any) => o.name.toLowerCase() === name.toLowerCase());
	  return found ? found.id : "";
	}

	const reasonOptionsList: any = {
	  "deffective": "1da2df32-4113-4002-a0d7-40b571025ea0",
	  "deffective device": "1da2df32-4113-4002-a0d7-40b571025ea0",
	  "charge": "b0da2e25-7b71-4e41-8aef-e0c59a262235",
	  "wrong product": "a8964e72-36eb-4331-be02-33c898df29d5",
	  "taxes": "934206c9-8241-4c17-9c2f-b4737b74634f",
	  "amount not agreed": "cab3c885-c260-48a2-9575-27529e601133",
	  "gbk": "69953f67-c3b9-407a-a143-00aa2273133f",
	  "instructions": "d03ff44c-ae1c-4526-aaf9-75998f70975a",
	  "shalem": "2add531d-a523-4988-85c4-fd0c42ecf9b0",
	  "shippings": "fa6512ce-a88e-4c94-ba01-a114c05444e4",
	  "reaction": "350f5c9b-3935-4868-b0c5-17c07c2cd508",
	  "first sale refund": "4cce58ae-620c-488c-9d6d-3d866ef5a363",
	  "missing product": "b90d657a-f315-4fa4-b570-4aa35941bfc1",
	  "sales person misinformed": "ff1356b9-ca85-4505-8b95-00fd35b4d239",
	  "regret": "64ce361e-f014-4103-96ed-c373b330680a",
	  "unkowns": "0eab1c14-a0de-49a6-b0be-ebc45e6abc1e",
	  "no results": "e0ad09bc-4646-43ff-b7de-630eedc90024"
	};

	// Start it up
	startServer();
