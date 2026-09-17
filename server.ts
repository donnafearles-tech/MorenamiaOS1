	import express from "express";
	import path from "path";
	import fs from "fs";
	const fsp = fs.promises;
	import { createServer as createViteServer } from "vite";
	import dotenv from "dotenv";
	import { createRequire } from "module";
	const require = createRequire(import.meta.url);
	const archiver = require("archiver");
	import { getStateByPhone, getTimezoneByPhone } from "./src/data/areaCodes";
	import { getVertexClient, getGeminiClient } from "./src/services/geminiClient.js";
	import { google } from "googleapis";
	import cron from "node-cron";

	// Preserve original valid service account credentials from container environment
	const INITIAL_CONTAINER_SA_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

	dotenv.config({ override: true });

	// Restore valid container Service Account JSON if dotenv corrupted or truncated it
	if (INITIAL_CONTAINER_SA_JSON) {
	  try {
	    JSON.parse(INITIAL_CONTAINER_SA_JSON);
	    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = INITIAL_CONTAINER_SA_JSON;
	  } catch {}
	}

	// Ensure dummy placeholder values or revoked keys never override real working keys
	const PLACEHOLDERS = ["MY_GROQ_API_KEY", "MY_APP_URL"];
	const REVOKED_KEYS = ["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"];

	for (const key of Object.keys(process.env)) {
	  let val = process.env[key];
	  if (val !== undefined) {
		// Strip surrounding quotes if present and trim whitespace
		val = val.trim().replace(/^["']+|["']+$/g, "").trim();
		process.env[key] = val;
		if (PLACEHOLDERS.includes(val) || REVOKED_KEYS.some(rk => val.includes(rk)) || val === "") {
		  delete process.env[key];
		}
	  }
	}

	// Sanitize GOOGLE_APPLICATION_CREDENTIALS if it points to an invalid/non-existent path (e.g. Windows C:\...)
	if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
	  console.warn(`[Init] Descartando GOOGLE_APPLICATION_CREDENTIALS inválido: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
	  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
	}

	// Fallback to .env.example for any missing variables
	try {
	  if (fs.existsSync(".env.example")) {
		const exampleConfig = dotenv.parse(fs.readFileSync(".env.example"));
		for (const key of Object.keys(exampleConfig)) {
		  if (!process.env[key] && exampleConfig[key]) {
			let val = exampleConfig[key].trim().replace(/^["']+|["']+$/g, "").trim();
			if (val !== "" && val !== "tu_token_aqui" && !PLACEHOLDERS.includes(val)) {
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

	// Normalizar el subdominio de Zendesk para corregir posibles typos o fallbacks erróneos
	if (process.env.ZENDESK_SUBDOMAIN) {
	  const cleanSub = process.env.ZENDESK_SUBDOMAIN.trim().toLowerCase().replace(/^"+|"+$/g, "");
	  if (!cleanSub || cleanSub === "vipcpsmetics" || cleanSub === "vipcosmetic" || cleanSub === "vipcpsmetic" || cleanSub === "emacaribbean" || cleanSub.includes("emacaribbean")) {
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
		  
		  // Remote cloud environment variables take precedence over local container .env files
		  const merged: any = { ...localParsed };
		  for (const [k, v] of Object.entries(remoteEnv)) {
			if (v !== undefined && v !== null && String(v).trim() !== "") {
			  merged[k] = String(v);
			}
		  }
		  // Sanitize revoked/invalid keys, invalid file paths, and corrupted JSON
		  for (const [k, v] of Object.entries(merged)) {
		    const valStr = String(v || "");
		    if (REVOKED_KEYS.some(rk => valStr.includes(rk))) {
		      delete merged[k];
		    }
		    if (k === "GOOGLE_APPLICATION_CREDENTIALS" && !fs.existsSync(valStr)) {
		      console.warn(`[Supabase Sync] Descartando GOOGLE_APPLICATION_CREDENTIALS remoto no existente: ${valStr}`);
		      delete merged[k];
		    }
		    if (k === "GOOGLE_SERVICE_ACCOUNT_JSON") {
		      try {
		        JSON.parse(valStr);
		      } catch {
		        console.warn(`[Supabase Sync] Descartando GOOGLE_SERVICE_ACCOUNT_JSON remoto corrupto o truncado.`);
		        if (INITIAL_CONTAINER_SA_JSON) {
		          merged[k] = INITIAL_CONTAINER_SA_JSON;
		        } else {
		          delete merged[k];
		        }
		      }
		    }
		  }

		  // Write clean env without breaking multiline variables
		  const envLines: string[] = [];
		  for (const [k, v] of Object.entries(merged)) {
		    if (k === "GOOGLE_SERVICE_ACCOUNT_JSON") continue; // Keep SA JSON in container environment
		    const cleanV = String(v).replace(/\r?\n/g, "");
		    envLines.push(`${k}="${cleanV}"`);
		  }
		  fs.writeFileSync(envPath, envLines.join("\n"), "utf-8");
		  
		  dotenv.config({ override: true });
		  if (INITIAL_CONTAINER_SA_JSON) {
		    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = INITIAL_CONTAINER_SA_JSON;
		  }
		  for (const k of Object.keys(merged)) {
			process.env[k] = merged[k];
		  }
		  // Push sanitized env back to Supabase so remote db is updated
		  await supabaseUpsert("env_variables", merged);
		  console.log("✅ [Supabase Sync] Merged environment variables applied & sanitized successfully.");
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

	// Key Rotator Helper for Environment Variables containing comma-separated keys
	class KeyRotator {
	  private keyName: string;
	  private currentIndex: number = 0;

	  constructor(keyName: string) {
		this.keyName = keyName;
	  }

	  public getKeys(): string[] {
		const raw = process.env[this.keyName] || "";
		return raw
		  .split(",")
		  .map(k => k.trim())
		  .filter(k => k.length > 0 && !k.includes("YOUR_") && !k.startsWith("MY_") && !REVOKED_KEYS.includes(k));
	  }

	  public getActiveKey(): string {
		const keys = this.getKeys();
		if (keys.length === 0) return (process.env[this.keyName] || "").trim();
		return keys[this.currentIndex % keys.length];
	  }

	  public rotateKey(): string {
		const keys = this.getKeys();
		if (keys.length <= 1) return this.getActiveKey();
		this.currentIndex = (this.currentIndex + 1) % keys.length;
		console.log(`🔄 [KeyRotator] ${this.keyName} rotado a la clave ${this.currentIndex + 1} de ${keys.length}`);
		return keys[this.currentIndex];
	  }

	  public async execute<T>(fn: (apiKey: string) => Promise<T>): Promise<T> {
		const keys = this.getKeys();
		if (keys.length === 0) {
		  const single = (process.env[this.keyName] || "").trim();
		  return await fn(single);
		}

		let lastError: any = null;
		const startIdx = this.currentIndex;

		for (let i = 0; i < keys.length; i++) {
		  const idx = (startIdx + i) % keys.length;
		  const apiKey = keys[idx];
		  try {
			const result = await fn(apiKey);
			this.currentIndex = idx;
			return result;
		  } catch (err: any) {
			console.warn(`⚠️ [KeyRotator] ${this.keyName} (Clave ${idx + 1}/${keys.length}) falló: ${err.message}. Rotando a la siguiente clave...`);
			lastError = err;
		  }
		}

		throw lastError || new Error(`Todas las ${keys.length} claves para ${this.keyName} fallaron.`);
	  }
	}

	const groqKeyRotator = new KeyRotator("GROQ_API_KEY");

	async function ocrWithGroq(imageBase64: string, mimeType: string): Promise<{ telefono: string, texto_completo: string }> {
	  const normalizedMimeType = mimeType && mimeType.startsWith("image/") ? mimeType : "image/jpeg";

	  // 1. Primary: Google Vertex AI (Gemini 2.5 Flash Multimodal)
	  try {
	    console.log("[OCR] Attempting transcription with Vertex AI (Gemini 2.5 Flash)...");
	    const ai = getVertexClient();
	    const result = await ai.models.generateContent({
	      model: "gemini-2.5-flash",
	      contents: [
	        {
	          text: "Transcribe todo el texto de esta imagen. Luego, dime cuál es el número de teléfono. Formatea tu respuesta EXACTAMENTE así:\n\nTELÉFONO: [número aquí]\n\nTEXTO COMPLETO:\n[texto completo aquí]"
	        },
	        {
	          inlineData: {
	            mimeType: normalizedMimeType,
	            data: imageBase64
	          }
	        }
	      ],
	      config: {
	        temperature: 0.0
	      }
	    });

	    const content = cleanAiThinkingProcess(result.text || "");
	    if (content) {
	      console.log("[OCR] Vertex AI transcription successful!");
	      return parseOcrResult(content);
	    }
	  } catch (vertexErr: any) {
	    console.warn(`[OCR] Vertex AI OCR failed, checking fallback: ${vertexErr.message}`);
	  }

	  // 2. Secondary Fallback: Groq Llama Vision (if valid key exists)
	  const groqKeys = groqKeyRotator.getKeys();
	  if (groqKeys.length > 0) {
		try {
		  return await groqKeyRotator.execute(async (groqApiKey) => {
			console.log(`[OCR] Attempting transcription with Groq Llama (using key pool of ${groqKeys.length})...`);
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
			  throw new Error(`Groq HTTP ${groqResponse.status}: ${errorText}`);
			}
		  });
		} catch (err: any) {
		  console.warn(`[OCR] Groq key pool failed: ${err.message}`);
		  throw err;
		}
	  }

	  throw new Error("No fue posible realizar OCR ni con Vertex AI ni con Groq.");
	}

	const app = express();
	const PORT = 3000;

	// Helper to dynamically get & clean ClickUp API Token from env
	function getClickUpApiKey(): string {
	  let key = (
	    process.env.CLICKUP_API_KEY ||
	    process.env.CLICKUP_API_TOKEN ||
	    process.env.CLICKUP_TOKEN ||
	    process.env.CLICKUP_PERSONAL_TOKEN ||
	    ""
	  ).trim();
	  // Clean any quotes or leading 'Bearer ' prefixes
	  key = key.replace(/^["']|["']$/g, '').trim();
	  if (key.toLowerCase().startsWith("bearer ")) {
	    key = key.substring(7).trim();
	  }
	  return key || "pk_101113624_8RMC5NKNQGI5PUEISZUULL567WL8214Z";
	}

	async function fetchClickUp(url: string, init: any = {}): Promise<Response> {
	  const token = getClickUpApiKey();
	  const headers: any = {
	    "Authorization": token,
	    "Content-Type": "application/json",
	    ...(init.headers || {})
	  };
	  let res = await fetch(url, { ...init, headers });
	  if (res.status === 401 && token !== "pk_101113624_8RMC5NKNQGI5PUEISZUULL567WL8214Z") {
	    console.warn("ClickUp 401 received with env key, retrying with fallback token pk_101113624_8RMC5NKNQGI5PUEISZUULL567WL8214Z...");
	    headers["Authorization"] = "pk_101113624_8RMC5NKNQGI5PUEISZUULL567WL8214Z";
	    res = await fetch(url, { ...init, headers });
	  }
	  return res;
	}

	// Dynamic ClickUp API Key getter proxy
	const CLICKUP_CONFIG = {
	  get apiKey(): string {
	    return getClickUpApiKey();
	  }
	};
	let CLICKUP_API_KEY = getClickUpApiKey();
	setInterval(() => {
	  CLICKUP_API_KEY = getClickUpApiKey();
	}, 2000);
	const CLICKUP_LIST_ID = "48494459";
	const ID_DONNA = 101113624;
	const ID_LORENZO = 10678227;

	const ID_CF_SALE_DATE = "f910021f-74df-426d-bdf2-586867dbf5c6";
	const ID_CF_AMOUNT_USD = "a51386cd-755e-4c9c-af58-5686b5c2a82d";
	const ID_CF_SHAREFILE = "d074e0d9-a8ce-4bf4-a49b-5eab81ee477f";
	const ID_CF_REASON = "ee1a1e07-a9b6-4209-a7bc-87162005e2f2";
	const ID_CF_CONTACT_DATE = "63946f1c-7c02-455a-af2d-af7f5f41e3ea";
	const ID_CF_SELLER = "af1663e3-9d94-4edd-ad6a-cd775d0a1a70";
	const ID_CF_ZENDESK_TICKET = "3fc1dccf-e684-44f9-84ff-706481a7b4bc";

	function formatCustomFieldValue(cf: any): string {
	  if (cf.value === undefined || cf.value === null || cf.value === "") {
		return "No especificado";
	  }

	  // Handle Date field type
	  if (cf.type === "date" || cf.id === ID_CF_CONTACT_DATE || cf.id === ID_CF_SALE_DATE || (cf.name && cf.name.toLowerCase().includes("date"))) {
		const num = Number(cf.value);
		if (!isNaN(num) && num > 100000000) {
		  const d = new Date(num);
		  if (!isNaN(d.getTime())) {
			return `${d.toISOString().split("T")[0]} (${d.toLocaleDateString("es-ES", { year: "numeric", month: "short", day: "numeric" })})`;
		  }
		}
		if (typeof cf.value === "string" && cf.value.length >= 8) {
		  return cf.value;
		}
	  }

	  // Handle Dropdown / Labels / Select option
	  if (cf.type_config?.options && Array.isArray(cf.type_config.options)) {
		const opts = cf.type_config.options;
		if (typeof cf.value === "string") {
		  const matchOpt = opts.find((o: any) => o.id === cf.value || o.name === cf.value);
		  if (matchOpt) return matchOpt.name;
		} else if (typeof cf.value === "number") {
		  const matchOpt = opts.find((o: any) => o.orderindex === cf.value);
		  if (matchOpt) return matchOpt.name;
		  if (opts[cf.value]) return opts[cf.value].name;
		} else if (Array.isArray(cf.value)) {
		  const names = cf.value.map((v: any) => {
			const o = opts.find((opt: any) => opt.id === v || opt.name === v || opt.orderindex === v);
			return o ? o.name : String(v);
		  });
		  return names.join(", ");
		}
	  }

	  // Handle Array of Users or Objects
	  if (Array.isArray(cf.value)) {
		return cf.value.map((item: any) => {
		  if (typeof item === "object" && item !== null) {
			return item.username || item.name || item.email || item.id || JSON.stringify(item);
		  }
		  return String(item);
		}).join(", ");
	  }

	  // Handle Object
	  if (typeof cf.value === "object" && cf.value !== null) {
		return cf.value.name || cf.value.text || cf.value.url || cf.value.value || JSON.stringify(cf.value);
	  }

	  // Currency / Number
	  if (cf.id === ID_CF_AMOUNT_USD || (cf.name && cf.name.toLowerCase().includes("monto"))) {
		const num = parseFloat(cf.value);
		if (!isNaN(num)) return `$${num.toFixed(2)} USD`;
	  }

	  return String(cf.value);
	}

	function extractDetailedCustomFields(customFields: any[]): { 
	  contactDate: string;
	  saleDate: string;
	  seller: string;
	  amountUsd: string;
	  summaryText: string;
	  formattedFieldsMap: Record<string, string>;
	} {
	  const fields = Array.isArray(customFields) ? customFields : [];
	  
	  let contactDate = "No especificado";
	  let saleDate = "No especificado";
	  let seller = "No especificado";
	  let amountUsd = "No especificado";

	  const formattedFieldsMap: Record<string, string> = {};
	  const formattedList: string[] = [];

	  for (const cf of fields) {
		if (!cf || !cf.id) continue;
		const valFormatted = formatCustomFieldValue(cf);
		const fieldName = cf.name || cf.id;
		formattedFieldsMap[cf.id] = valFormatted;

		if (cf.id === ID_CF_CONTACT_DATE || fieldName.toLowerCase().includes("fecha de contacto") || fieldName.toLowerCase().includes("contact date")) {
		  contactDate = valFormatted;
		} else if (cf.id === ID_CF_SALE_DATE || fieldName.toLowerCase().includes("fecha de venta") || fieldName.toLowerCase().includes("sale date")) {
		  saleDate = valFormatted;
		} else if (cf.id === ID_CF_SELLER || fieldName.toLowerCase().includes("vendedor") || fieldName.toLowerCase().includes("seller")) {
		  seller = valFormatted;
		} else if (cf.id === ID_CF_AMOUNT_USD || fieldName.toLowerCase().includes("monto") || fieldName.toLowerCase().includes("amount")) {
		  amountUsd = valFormatted;
		}

		if (valFormatted !== "No especificado") {
		  formattedList.push(`  • ${fieldName} [ID: ${cf.id}]: ${valFormatted}`);
		}
	  }

	  const summaryText = [
		`CAMPOS PERSONALIZADOS CLAVE Y SOLICITADOS:`,
		`  • 📅 Fecha de Contacto (ID 63946f1c-7c02-455a-af2d-af7f5f41e3ea): ${contactDate}`,
		`  • 🛒 Fecha de Venta (ID f910021f-74df-426d-bdf2-586867dbf5c6): ${saleDate}`,
		`  • 👤 Vendedor / Rep (ID af1663e3-9d94-4edd-ad6a-cd775d0a1a70): ${seller}`,
		`  • 💵 Monto USD (ID a51386cd-755e-4c9c-af58-5686b5c2a82d): ${amountUsd}`,
		formattedList.length > 0 ? `\nTODOS LOS CAMPOS PERSONALIZADOS REGISTRADOS:\n${formattedList.join("\n")}` : ""
	  ].filter(Boolean).join("\n");

	  return {
		contactDate,
		saleDate,
		seller,
		amountUsd,
		summaryText,
		formattedFieldsMap
	  };
	}

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
  const { ticket_id } = req.body;
  if (!ticket_id) {
    return res.status(400).json({ error: "Campo requerido: ticket_id" });
  }

  const DEFAULT_AGENT_ID = 50176296447379;
  const AGENT_ID = process.env.ZENDESK_AGENT_ID ? Number(process.env.ZENDESK_AGENT_ID) : DEFAULT_AGENT_ID;

  try {
    const result = await zendeskFetch(`/tickets/${ticket_id}.json`, {
      method: "PUT",
      body: {
        ticket: {
          status: "solved",
          assignee_id: AGENT_ID
        }
      }
    });
    return res.json({ status: "ok", message: `Ticket ${ticket_id} resuelto (solved) y asignado a agente #${AGENT_ID}`, response: result });
  } catch (e: any) {
    if (e.message && e.message.includes("closed prevents ticket update")) {
      return res.json({ status: "ok", message: `El ticket ${ticket_id} ya se encuentra cerrado en Zendesk` });
    }
    console.error(`❌ Error cerrando ticket: ${e.message}`);
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

  try {
    console.log(`📝 Agregando nota y resolviendo ticket #${ticket_id}...`);
    const noteText = `[RESOLUCION] ${resolution_note || "Ticket resuelto"}`;
    const closeResult = await addNoteByTicketIdRaw(zapierUrl, String(ticket_id), noteText, true, false);

    return res.json({
      status: "ok",
      message: `Ticket ${ticket_id} resuelto (solved) con nota`,
      response: closeResult
    });
  } catch (e: any) {
    if (e.message && e.message.includes("closed prevents ticket update")) {
      return res.json({ status: "ok", message: `El ticket ${ticket_id} ya se encuentra cerrado en Zendesk` });
    }
    console.error(`❌ Error cerrando ticket con nota: ${e.message}`);
    return res.status(500).json({ error: e.message });
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
	async function searchTicketById(_zapierUrl: string, ticketId: string): Promise<any> {
	  console.log(`🔍 [Zendesk Direct API] Buscando ticket con ID exacto: ${ticketId}`);
	  try {
	    const directRes = await zendeskFetch(`/tickets/${ticketId}.json`);
	    if (directRes?.ticket) {
	      return {
	        results: [directRes.ticket],
	        id: directRes.ticket.id,
	        subject: directRes.ticket.subject,
	        status: directRes.ticket.status
	      };
	    }
	  } catch (err: any) {
	    console.warn(`[searchTicketById Direct API] ${err.message}`);
	  }

	  try {
	    const searchRes = await zendeskFetch(`/search.json?query=type:ticket id:${ticketId}`);
	    if (searchRes?.results?.[0]) {
	      const exactTicket = searchRes.results[0];
	      return {
	        results: [exactTicket],
	        id: exactTicket.id,
	        subject: exactTicket.subject,
	        status: exactTicket.status
	      };
	    }
	  } catch (e: any) {}

	  throw new Error(`No se encontró ningún ticket con el ID exacto: ${ticketId}`);
	}

	// Helper directo para la API v2 de Zendesk con Token de API
	async function zendeskFetch(
	  endpointPath: string, 
	  options: { method?: string; body?: any; subdomain?: string; email?: string; token?: string } = {}
	): Promise<any> {
	  let subdomain = (options.subdomain || process.env.ZENDESK_SUBDOMAIN || "vipcosmetics").toLowerCase().trim();
	  if (!subdomain || subdomain === "emacaribbean" || subdomain.includes("emacaribbean") || subdomain === "vipcpsmetics" || subdomain === "vipcosmetic" || subdomain === "vipcpsmetic") {
	    subdomain = "vipcosmetics";
	    process.env.ZENDESK_SUBDOMAIN = "vipcosmetics";
	  }
	  const email = (options.email || process.env.ZENDESK_EMAIL || process.env.ZENDESK_USER || "").trim();
	  const token = (options.token || process.env.ZENDESK_API_TOKEN || process.env.ZENDESK_TOKEN || "").trim();

	  if (!email || !token || token === "tu_token_aqui") {
	    throw new Error("Credenciales directas de Zendesk no configuradas en entorno (ZENDESK_API_TOKEN / ZENDESK_TOKEN o ZENDESK_EMAIL / ZENDESK_USER vacío)");
	  }

	  const authHeader = `Basic ${Buffer.from(`${email}/token:${token}`).toString("base64")}`;
	  const url = endpointPath.startsWith("http")
	    ? endpointPath
	    : `https://${subdomain}.zendesk.com/api/v2${endpointPath.startsWith('/') ? '' : '/'}${endpointPath}`;

	  const headers: Record<string, string> = {
	    "Authorization": authHeader,
	    "Content-Type": "application/json",
	    "Accept": "application/json"
	  };

	  const init: RequestInit = {
	    method: options.method || "GET",
	    headers
	  };

	  if (options.body) {
	    init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
	  }

	  const response = await fetch(url, init);
	  if (!response.ok) {
	    const errText = await response.text();
	    throw new Error(`Zendesk API ${response.status}: ${errText}`);
	  }
	  return await response.json();
	}

	async function addNoteByTicketId(
	  _zapierUrl: string,
	  ticketId: string,
	  note: string,
	  solveTicket: boolean = false,
	  isPublic: boolean = false
	): Promise<{ ticket_found: string; note_result: any }> {
	  const cleanTicketNum = ticketId.trim();
	  let ticketSubject: string | null = null;
	  let currentTicketStatus: string | null = null;

	  const DEFAULT_AGENT_ID = 50176296447379;
	  const AGENT_ID = process.env.ZENDESK_AGENT_ID ? Number(process.env.ZENDESK_AGENT_ID) : DEFAULT_AGENT_ID;

	  console.log(`🚀 [Zendesk Direct API] Agregando ${isPublic ? "respuesta pública" : "nota interna"} al ticket #${cleanTicketNum}${solveTicket ? " (y cambiando estado a SOLVED)" : ""}...`);
	  try {
	    const ticketData = await zendeskFetch(`/tickets/${cleanTicketNum}.json`);
	    if (ticketData?.ticket) {
	      if (ticketData.ticket.subject) {
	        ticketSubject = ticketData.ticket.subject;
	      }
	      if (ticketData.ticket.status) {
	        currentTicketStatus = String(ticketData.ticket.status).toLowerCase().trim();
	      }
	    }
	  } catch (err: any) {
	    console.log(`ℹ️ [addNoteByTicketId] Ticket fetch direct note: ${err.message}`);
	  }

	  const ticketPayload: any = {
	    comment: {
	      body: note,
	      public: isPublic
	    },
	    assignee_id: AGENT_ID
	  };

	  if (solveTicket) {
	    ticketPayload.status = "solved";
	  } else if (currentTicketStatus === "open") {
	    ticketPayload.status = "pending";
	    console.log(`🔄 [Zendesk Direct API] Ticket #${cleanTicketNum} estado actual es 'open' -> Cambiando automáticamente a 'pending'`);
	  }

	  const noteRes = await zendeskFetch(`/tickets/${cleanTicketNum}.json`, {
	    method: "PUT",
	    body: {
	      ticket: ticketPayload
	    }
	  });

	  if (!ticketSubject && noteRes?.ticket?.subject) {
	    ticketSubject = noteRes.ticket.subject;
	  }

	  console.log(`✅ [Zendesk Direct API] ${isPublic ? "Respuesta pública" : "Nota interna"} agregada exitosamente al ticket #${cleanTicketNum} (Asignado a agente #${AGENT_ID}, Estado: ${noteRes?.ticket?.status || ticketPayload.status || "mantenido"})`);
	  return {
	    ticket_found: ticketSubject || cleanTicketNum,
	    note_result: noteRes
	  };
	}

	async function searchTicketByIdRaw(_zapierUrl: string, ticketId: string): Promise<any> {
	  try {
	    console.log(`🔍 [Zendesk Direct API] Obteniendo ticket #${ticketId}...`);
	    const directRes = await zendeskFetch(`/tickets/${ticketId}.json`);
	    if (directRes?.ticket) return directRes.ticket;
	  } catch (directErr: any) {
	    console.warn(`[searchTicketByIdRaw Direct API] ${directErr.message}`);
	  }

	  try {
	    const searchRes = await zendeskFetch(`/search.json?query=type:ticket id:${ticketId}`);
	    if (searchRes?.results?.[0]) return searchRes.results[0];
	  } catch (e: any) {}

	  return null;
	}

	async function getMacroById(_zapierUrl: string, macroId: string): Promise<any> {
	  try {
	    console.log(`🔍 [Zendesk Direct API] Obteniendo macro #${macroId}...`);
	    const directRes = await zendeskFetch(`/macros/${macroId}.json`);
	    if (directRes?.macro) return directRes.macro;
	  } catch (directErr: any) {
	    console.warn(`[getMacroById Direct API] ${directErr.message}`);
	  }
	  return {};
	}

	async function getTicketComments(_zapierUrl: string, ticketId: string): Promise<any[]> {
	  try {
	    console.log(`💬 [Zendesk Direct API] Obteniendo comentarios del ticket #${ticketId}...`);
	    const directRes = await zendeskFetch(`/tickets/${ticketId}/comments.json`);
	    if (Array.isArray(directRes?.comments)) return directRes.comments;
	  } catch (directErr: any) {
	    console.warn(`[getTicketComments Direct API] ${directErr.message}`);
	  }
	  return [];
	}

	async function getLatestComment(zapierUrl: string, ticketId: string): Promise<any> {
	  try {
		const comments = await getTicketComments(zapierUrl, ticketId);
		if (comments && comments.length > 0) {
		  return comments[comments.length - 1];
		}
	  } catch (e: any) {
		console.error(`Error obteniendo último comentario: ${e.message}`);
	  }
	  return null;
	}

	async function addNoteByTicketIdRaw(
	  zapierUrl: string,
	  ticketId: string,
	  note: string,
	  solveTicket: boolean = false,
	  isPublic: boolean = false
	): Promise<{ ticket_found: string; note_result: any }> {
	  return addNoteByTicketId(zapierUrl, ticketId, note, solveTicket, isPublic);
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

	async function guardarEmail(taskId: string, email: string) {
	  const filePath = path.join(process.cwd(), "src", "data", "emails.json");
	  try {
		let data: any = {};
		try {
		  const content = await fsp.readFile(filePath, "utf-8");
		  data = JSON.parse(content);
		} catch (e) {
		  data = {};
		}
		data[taskId] = email;
		await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
		await supabaseUpsert("emails", data);
	  } catch (e) {
		console.error("Error writing emails:", e);
	  }
	}

	async function obtenerEmails(): Promise<any> {
	  const filePath = path.join(process.cwd(), "src", "data", "emails.json");
	  try {
		const content = await fsp.readFile(filePath, "utf-8");
		return JSON.parse(content);
	  } catch (e) {
		return {};
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
		const cleanTicketId = (ticketId || "").trim();
		if (cleanTicketId) {
		  data[taskId] = cleanTicketId;
		  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
		  await supabaseUpsert("zendesk_tickets", data);

		  // Synchronize ClickUp Custom Field "Zendesk Ticket" (3fc1dccf-e684-44f9-84ff-706481a7b4bc)
		  if (taskId && CLICKUP_API_KEY) {
			try {
			  const subdomain = (process.env.ZENDESK_SUBDOMAIN || "vipcosmetics").toLowerCase().trim();
			  let valueToSend = cleanTicketId;
			  const digitsOnly = cleanTicketId.replace(/\D/g, "");
			  if (!cleanTicketId.startsWith("http://") && !cleanTicketId.startsWith("https://") && digitsOnly) {
				valueToSend = `https://${subdomain}.zendesk.com/agent/tickets/${digitsOnly}`;
			  }

			  const cfUrl = `https://api.clickup.com/api/v2/task/${taskId}/field/${ID_CF_ZENDESK_TICKET}`;
			  const cfRes = await fetch(cfUrl, {
				method: "POST",
				headers: {
				  "Authorization": getClickUpApiKey(),
				  "Content-Type": "application/json"
				},
				body: JSON.stringify({ value: valueToSend })
			  });

			  if (!cfRes.ok) {
				// Fallback: try raw cleanTicketId or digitsOnly if the field expects raw string/number
				const rawCfRes = await fetch(cfUrl, {
				  method: "POST",
				  headers: {
					"Authorization": getClickUpApiKey(),
					"Content-Type": "application/json"
				  },
				  body: JSON.stringify({ value: digitsOnly || cleanTicketId })
				});
				if (rawCfRes.ok) {
				  console.log(`✅ [ClickUp Custom Field] Updated Zendesk Ticket field (${ID_CF_ZENDESK_TICKET}) for task ${taskId} with raw ID: ${digitsOnly || cleanTicketId}`);
				} else {
				  console.error(`⚠️ [ClickUp Custom Field Error] Failed updating Zendesk Ticket field (${ID_CF_ZENDESK_TICKET}) for task ${taskId}: Status ${rawCfRes.status}`);
				}
			  } else {
				console.log(`✅ [ClickUp Custom Field] Updated Zendesk Ticket field (${ID_CF_ZENDESK_TICKET}) for task ${taskId} with: ${valueToSend}`);
			  }
			} catch (clickupErr: any) {
			  console.error("Error updating ClickUp Zendesk Ticket custom field:", clickupErr.message);
			}
		  }
		}
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

	async function findUserByEmail(_zapierUrl: string, email: string): Promise<any> {
	  try {
	    console.log(`🔍 [Zendesk Direct API] Buscar usuario por email: ${email}`);
	    const directData = await zendeskFetch(`/users/search.json?query=email:${encodeURIComponent(email)}`);
	    if (directData?.users && directData.users.length > 0) {
	      console.log(`✅ Usuario encontrado vía Zendesk Direct API: ${directData.users[0].id}`);
	      return directData.users[0];
	    }
	  } catch (directErr: any) {
	    console.warn(`[findUserByEmail Direct API]: ${directErr.message}`);
	  }
	  return null;
	}

	async function findTicketByInvoice(_zapierUrl: string, invoice: string): Promise<any> {
	  console.log(`🔍 Buscando ticket existente por Invoice en Zendesk Direct API: ${invoice}`);
	  try {
	    const searchRes = await zendeskFetch(`/search.json?query=type:ticket "${encodeURIComponent(invoice)}"`);
	    if (searchRes?.results && Array.isArray(searchRes.results)) {
	      const match = searchRes.results.find((t: any) => t && t.subject && t.subject.includes(invoice));
	      if (match) {
	        console.log(`✅ [Direct Search] Encontrado ticket existente de Zendesk para Invoice ${invoice}: ID ${match.id}`);
	        return match;
	      }
	    }
	  } catch (err: any) {
	    console.warn("[findTicketByInvoice Direct API]:", err.message);
	  }
	  return null;
	}

	async function syncZendeskUserAndTicket(params: {
	  taskId?: string;
	  zendeskTicketId?: string;
	  phone?: string;
	  email?: string;
	  externalId?: string; // Invoice number
	  name?: string;
	  notes?: string;
	  userId?: number | string;
	}): Promise<{ success: boolean; user_updated: boolean; ticket_updated: boolean; user_id?: any; details?: string; error?: string }> {
	  const { taskId, phone, email, name, notes, userId } = params;
	  let zdTicketId = (params.zendeskTicketId || "").toString().trim();
	  let externalId = (params.externalId || "").toString().trim();

	  // If no externalId or zdTicketId provided, try to extract from ClickUp task
	  if (taskId && (!externalId || !zdTicketId)) {
	    try {
	      const taskRes = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
	        headers: { "Authorization": getClickUpApiKey() }
	      });
	      if (taskRes.ok) {
	        const taskData = await taskRes.json() as any;
	        const taskName = taskData.name || "";

	        // Extract invoice from name if not provided
	        if (!externalId) {
	          if (taskName.includes("-")) {
	            const firstPart = taskName.split("-")[0].trim();
	            const invoiceMatch = firstPart.match(/\b([A-Z0-9]{3,12})\b/i);
	            if (invoiceMatch) externalId = invoiceMatch[1];
	          } else {
	            const invoiceMatch = taskName.match(/\b([0-9]{4,10})\b/);
	            if (invoiceMatch) externalId = invoiceMatch[1];
	          }
	        }

	        // Extract zendesk ticket id if not provided
	        if (!zdTicketId) {
	          const zdMap = await obtenerZendeskTicketIds();
	          if (zdMap[taskId]) {
	            zdTicketId = zdMap[taskId];
	          } else if (taskData.custom_fields) {
	            const zdField = (taskData.custom_fields || []).find((f: any) => 
	              f.id === ID_CF_ZENDESK_TICKET || 
	              (f.name && typeof f.name === "string" && f.name.toLowerCase().includes("zendesk ticket"))
	            );
	            if (zdField?.value) {
	              const rawVal = typeof zdField.value === "string" ? zdField.value : (zdField.value.url || zdField.value.text || String(zdField.value));
	              if (rawVal) zdTicketId = rawVal;
	            }
	          }
	        }
	      }
	    } catch (tErr: any) {
	      console.warn("[syncZendeskUserAndTicket] Error resolving task details:", tErr.message);
	    }
	  }

	  let cleanTicketId = zdTicketId.replace(/[^\d]/g, "") || zdTicketId;
	  let cleanExternalId = externalId ? externalId.trim() : "";
	  let cleanPhone = phone ? phone.trim() : "";
	  let cleanEmail = email ? email.trim() : "";
	  let cleanName = name ? name.trim() : "";

	  let targetUserId: number | string | null = userId || null;
	  let syncResults = {
	    success: true,
	    user_updated: false,
	    ticket_updated: false,
	    user_id: targetUserId,
	    details: ""
	  };

	  console.log(`🔄 [Zendesk Sync] Sincronizando Usuario y Ticket en Zendesk -> Ticket: #${cleanTicketId || "N/A"}, External ID (Invoice): ${cleanExternalId || "N/A"}, Tel: ${cleanPhone || "N/A"}, Email: ${cleanEmail || "N/A"}, Name: ${cleanName || "N/A"}`);

	  // 1. If we have a Ticket ID, fetch ticket to get requester_id and sync ticket's external_id
	  if (cleanTicketId) {
	    try {
	      const ticketRes = await zendeskFetch(`/tickets/${cleanTicketId}.json?include=users,requesters`);
	      if (ticketRes?.ticket) {
	        if (!targetUserId && ticketRes.ticket.requester_id) {
	          targetUserId = ticketRes.ticket.requester_id;
	          syncResults.user_id = targetUserId;
	          console.log(`✅ [Zendesk Sync] Encontrado requester_id ${targetUserId} desde Ticket #${cleanTicketId}`);
	        }

	        // Extract requester user data if present
	        const rawUsers = Array.isArray(ticketRes.users) ? ticketRes.users : [];
	        const zdRequester = rawUsers.find((u: any) => u.id === (targetUserId || ticketRes.ticket.requester_id)) || ticketRes.requester;
	        if (zdRequester) {
	          if (!cleanEmail && zdRequester.email) cleanEmail = zdRequester.email;
	          if (!cleanPhone && zdRequester.phone) cleanPhone = zdRequester.phone;
	          if (!cleanName && zdRequester.name) cleanName = zdRequester.name;
	          if (!cleanExternalId && zdRequester.external_id) cleanExternalId = zdRequester.external_id;
	        }

	        // Update ticket external_id if cleanExternalId is available and differs (unless ticket is closed)
	        const isTicketClosed = ticketRes.ticket.status === "closed" || ticketRes.ticket.status === "solved";
	        if (cleanExternalId && String(ticketRes.ticket.external_id || "").trim() !== cleanExternalId) {
	          if (isTicketClosed) {
	            console.log(`ℹ️ [Zendesk Sync] Ticket #${cleanTicketId} está cerrado/resuelto; se omite actualizar external_id en el ticket, pero se sincronizará el perfil de usuario.`);
	          } else {
	            try {
	              await zendeskFetch(`/tickets/${cleanTicketId}.json`, {
	                method: "PUT",
	                body: { ticket: { external_id: cleanExternalId } }
	              });
	              syncResults.ticket_updated = true;
	              console.log(`✅ [Zendesk Sync] Ticket #${cleanTicketId} actualizado con external_id ${cleanExternalId}`);
	            } catch (tUpdErr: any) {
	              console.warn(`⚠️ [Zendesk Sync] No se pudo actualizar external_id en Ticket #${cleanTicketId}:`, tUpdErr.message);
	            }
	          }
	        }
	      }
	    } catch (fetchTErr: any) {
	      console.warn(`⚠️ [Zendesk Sync] No se pudo consultar Ticket #${cleanTicketId}:`, fetchTErr.message);
	    }
	  }

	  // 2. If no targetUserId yet, search by email
	  if (!targetUserId && cleanEmail) {
	    try {
	      const u = await findUserByEmail("", cleanEmail);
	      if (u?.id) {
	        targetUserId = u.id;
	        syncResults.user_id = targetUserId;
	        if (!cleanPhone && u.phone) cleanPhone = u.phone;
	        if (!cleanName && u.name) cleanName = u.name;
	        if (!cleanExternalId && u.external_id) cleanExternalId = u.external_id;
	        console.log(`✅ [Zendesk Sync] Usuario localizado por email (${cleanEmail}): ID ${targetUserId}`);
	      }
	    } catch (uErr: any) {
	      console.warn(`⚠️ [Zendesk Sync] Búsqueda por email falló:`, uErr.message);
	    }
	  }

	  // 3. If no targetUserId yet, search by phone
	  if (!targetUserId && cleanPhone) {
	    try {
	      const digitsOnly = cleanPhone.replace(/[^\d+]/g, "");
	      const searchRes = await zendeskFetch(`/users/search.json?query=type:user phone:"${digitsOnly}"`);
	      if (searchRes?.users && searchRes.users.length > 0) {
	        const u = searchRes.users[0];
	        targetUserId = u.id;
	        syncResults.user_id = targetUserId;
	        if (!cleanEmail && u.email) cleanEmail = u.email;
	        if (!cleanName && u.name) cleanName = u.name;
	        if (!cleanExternalId && u.external_id) cleanExternalId = u.external_id;
	        console.log(`✅ [Zendesk Sync] Usuario localizado por teléfono (${cleanPhone}): ID ${targetUserId}`);
	      }
	    } catch (pErr: any) {
	      console.warn(`⚠️ [Zendesk Sync] Búsqueda por teléfono falló:`, pErr.message);
	    }
	  }

	  // 4. If no targetUserId yet, search by external_id (Invoice)
	  if (!targetUserId && cleanExternalId) {
	    try {
	      const searchRes = await zendeskFetch(`/users/search.json?query=type:user external_id:"${encodeURIComponent(cleanExternalId)}"`);
	      if (searchRes?.users && searchRes.users.length > 0) {
	        const u = searchRes.users[0];
	        targetUserId = u.id;
	        syncResults.user_id = targetUserId;
	        if (!cleanEmail && u.email) cleanEmail = u.email;
	        if (!cleanPhone && u.phone) cleanPhone = u.phone;
	        if (!cleanName && u.name) cleanName = u.name;
	        console.log(`✅ [Zendesk Sync] Usuario localizado por external_id (${cleanExternalId}): ID ${targetUserId}`);
	      }
	    } catch (extErr: any) {
	      console.warn(`⚠️ [Zendesk Sync] Búsqueda por external_id falló:`, extErr.message);
	    }
	  }

	  // If targetUserId exists but cleanEmail is still missing, fetch the user profile from Zendesk
	  if (targetUserId && !cleanEmail) {
	    try {
	      const uRes = await zendeskFetch(`/users/${targetUserId}.json`);
	      if (uRes?.user) {
	        if (!cleanEmail && uRes.user.email) cleanEmail = uRes.user.email;
	        if (!cleanPhone && uRes.user.phone) cleanPhone = uRes.user.phone;
	        if (!cleanName && uRes.user.name) cleanName = uRes.user.name;
	        if (!cleanExternalId && uRes.user.external_id) cleanExternalId = uRes.user.external_id;
	      }
	    } catch (uErr: any) {
	      console.warn(`⚠️ [Zendesk Sync] No se pudo consultar perfil de usuario #${targetUserId}:`, uErr.message);
	    }
	  }

	  // If targetUserId exists but cleanTicketId is missing, check user's requested tickets
	  if (targetUserId && !cleanTicketId) {
	    try {
	      const tReqRes = await zendeskFetch(`/users/${targetUserId}/tickets/requested.json?sort_by=created_at&sort_order=desc`);
	      const tickets = tReqRes?.tickets || [];
	      const activeT = tickets.find((t: any) => ["new", "open", "pending", "hold"].includes(t.status)) || tickets[0];
	      if (activeT?.id) {
	        cleanTicketId = String(activeT.id);
	        console.log(`✅ [Zendesk Sync] Asociado ticket activo #${cleanTicketId} para usuario #${targetUserId}`);
	      }
	    } catch (tErr: any) {
	      console.warn(`⚠️ [Zendesk Sync] No se pudieron consultar tickets para usuario #${targetUserId}:`, tErr.message);
	    }
	  }

	  // 5. Update the Zendesk User Profile if targetUserId is identified
	  if (targetUserId) {
	    const userPayload: any = {};
	    if (cleanPhone) userPayload.phone = cleanPhone;
	    if (cleanExternalId) userPayload.external_id = cleanExternalId;
	    if (cleanEmail) userPayload.email = cleanEmail;
	    if (cleanName) userPayload.name = cleanName;
	    if (notes) userPayload.notes = notes;

	    try {
	      await zendeskFetch(`/users/${targetUserId}.json`, {
	        method: "PUT",
	        body: { user: userPayload }
	      });
	      syncResults.user_updated = true;
	      syncResults.details = `Perfil de Zendesk #${targetUserId} sincronizado y actualizado con éxito (Email: ${cleanEmail || "N/A"}, External ID: ${cleanExternalId || "N/A"}, Teléfono: ${cleanPhone || "N/A"}).`;
	      console.log(`🎉 [Zendesk Sync] Usuario #${targetUserId} actualizado exitosamente en Zendesk:`, userPayload);
	    } catch (uUpdateErr: any) {
	      console.warn(`⚠️ [Zendesk Sync] Reintento con campos mínimos debido a: ${uUpdateErr.message}`);
	      try {
	        const corePayload: any = {};
	        if (cleanPhone) corePayload.phone = cleanPhone;
	        if (cleanExternalId) corePayload.external_id = cleanExternalId;
	        if (cleanName) corePayload.name = cleanName;
	        await zendeskFetch(`/users/${targetUserId}.json`, {
	          method: "PUT",
	          body: { user: corePayload }
	        });
	        syncResults.user_updated = true;
	        syncResults.details = `Perfil de Zendesk #${targetUserId} actualizado con campos esenciales (External ID y Teléfono).`;
	        console.log(`🎉 [Zendesk Sync] Campos esenciales de Usuario #${targetUserId} actualizados en Zendesk.`);
	      } catch (coreErr: any) {
	        console.error(`❌ [Zendesk Sync] Error definitivo al actualizar usuario #${targetUserId}:`, coreErr.message);
	        syncResults.details = `No se pudo actualizar el perfil en Zendesk: ${coreErr.message}`;
	      }
	    }
	  } else {
	    syncResults.details = `No se identificó ningún usuario en Zendesk para actualizar.`;
	    console.log(`ℹ️ [Zendesk Sync] No se encontró usuario en Zendesk.`);
	  }

	  // Save resolved values in local caches & clickup if taskId provided
	  if (taskId) {
	    if (cleanEmail) {
	      await guardarEmail(taskId, cleanEmail);
	    }
	    if (cleanPhone) {
	      await guardarPhone(taskId, cleanPhone);
	    }
	    if (cleanTicketId) {
	      await guardarZendeskTicketId(taskId, cleanTicketId);
	    }
	  }

	  (syncResults as any).email = cleanEmail;
	  (syncResults as any).phone = cleanPhone;
	  (syncResults as any).external_id = cleanExternalId;
	  (syncResults as any).name = cleanName;
	  (syncResults as any).ticket_id = cleanTicketId;

	  return syncResults;
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

	  if (["refund", "reembolso", "chargeback", "dispute", "banco", "tarjeta", "gbk", "give back", "giveback", "tax", "taxes", "impuesto", "tax refund", "shalem"].some(word => q.includes(word))) {
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

	  if (q.includes("gbk") || q.includes("give back") || q.includes("giveback") || q.includes("tax") || q.includes("impuesto")) {
		if (manual.procedimientos_especificos && manual.procedimientos_especificos.GBK_TAXES) {
		  contextFiltrado.gbk_taxes = manual.procedimientos_especificos.GBK_TAXES;
		}
		if (manual.topics && Array.isArray(manual.topics)) {
		  const gbkTopic = manual.topics.find((t: any) => t.id === "gbk_tax_refund");
		  if (gbkTopic) contextFiltrado.gbk_tax_refund = gbkTopic;
		}
		// Always ensure official Give Back contact info is present if querying about GBK
		if (!contextFiltrado.gbk_tax_refund && !contextFiltrado.gbk_taxes) {
		  contextFiltrado.gbk_official_contact = {
		    name: "Give Back (GBK) Tax Refund",
		    phone: "+1 (202) 838-4850",
		    email: "care@givebackmytaxrefund.com",
		    procedure: "Si el cliente tiene dudas sobre su estatus de tax refund de Give Back, dirigirlo a llamar al +1 (202) 838-4850 o escribir a care@givebackmytaxrefund.com. Si fue rechazado, ofrecer compensación de skincare/sueros del catálogo SPARE MMG."
		  };
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

	function cleanAiThinkingProcess(text: string): string {
	  if (!text) return "";
	  let cleaned = text;
	  // Strip <think>...</think> XML tags
	  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");
	  // Strip ```thinking ... ``` or ```thought ... ``` markdown blocks
	  cleaned = cleaned.replace(/```(?:thinking|thought)[\s\S]*?```/gi, "");
	  // Strip explicit "Thinking Process:\n..." headers at the start
	  cleaned = cleaned.replace(/^Thinking Process:[\s\S]*?\n\n/i, "");
	  cleaned = cleaned.replace(/^Thought:[\s\S]*?\n\n/i, "");
	  return cleaned.trim();
	}

	// Call Google Vertex AI / Gemini 2.5 Flash
	async function callVertexAI(prompt: string, systemMessage?: string, temperature = 0.1, responseJson = false): Promise<string> {
	  const ai = getVertexClient();
	  const config: any = {
	    temperature,
	  };
	  if (systemMessage) {
	    config.systemInstruction = systemMessage;
	  }
	  if (responseJson) {
	    config.responseMimeType = "application/json";
	  }

	  const result = await ai.models.generateContent({
	    model: "gemini-2.5-flash",
	    contents: prompt,
	    config,
	  });

	  return cleanAiThinkingProcess(result.text || "");
	}

	// Call AI completion (Primary: Vertex AI Gemini 2.5 Flash / Secondary: Gemini API / Tertiary: Groq if configured)
	async function callGroq(prompt: string, systemMessage?: string, temperature = 0.1, responseJson = false): Promise<string> {
	  // 1. Primary: Google Vertex AI (Gemini 2.5 Flash)
	  try {
	    console.log("🤖 [Donna AI] Procesando solicitud con Vertex AI (Gemini 2.5 Flash)...");
	    const text = await callVertexAI(prompt, systemMessage, temperature, responseJson);
	    if (text && text.trim().length > 0) {
	      console.log("✅ [Donna AI] Respuesta exitosa recibida desde Vertex AI!");
	      return text;
	    }
	  } catch (vertexErr: any) {
	    console.warn("⚠️ [Donna AI] Vertex AI arrojó un error, evaluando alternativas:", vertexErr.message);
	  }

	  // 2. Secondary: Fallback to Gemini Public API via GEMINI_API_KEY
	  if (process.env.GEMINI_API_KEY) {
	    try {
	      console.log("🤖 [Donna AI] Intentando con Gemini API directa...");
	      const ai = getGeminiClient();
	      const config: any = { temperature };
	      if (systemMessage) config.systemInstruction = systemMessage;
	      if (responseJson) config.responseMimeType = "application/json";
	      const res = await ai.models.generateContent({
	        model: "gemini-2.5-flash",
	        contents: prompt,
	        config,
	      });
	      const text = cleanAiThinkingProcess(res.text || "");
	      if (text && text.trim().length > 0) {
	        console.log("✅ [Donna AI] Respuesta exitosa desde Gemini API directa!");
	        return text;
	      }
	    } catch (geminiErr: any) {
	      console.warn("⚠️ [Donna AI] Falló Gemini API directa:", geminiErr.message);
	    }
	  }

	  // 3. Tertiary: Fallback to Groq only if valid keys exist
	  const groqKeys = groqKeyRotator.getKeys();
	  if (groqKeys.length > 0) {
	    const url = "https://api.groq.com/openai/v1/chat/completions";
	    const messages: any[] = [];
	    if (systemMessage) {
	      messages.push({ role: "system", content: systemMessage });
	    }
	    messages.push({ role: "user", content: prompt });

	    const groqModels = [
	      "llama-3.3-70b-versatile",
	      "llama-3.1-8b-instant",
	      "qwen/qwen3.6-27b"
	    ];

	    try {
	      return await groqKeyRotator.execute(async (groqApiKey) => {
	        let lastError: any = null;
	        for (const modelName of groqModels) {
	          try {
	            console.log(`🤖 [callGroq] Intentando Groq con modelo: ${modelName}...`);
	            const response = await fetch(url, {
	              method: "POST",
	              headers: {
	                "Authorization": `Bearer ${groqApiKey}`,
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
	              console.log(`✅ [callGroq] Respuesta Groq exitosa con modelo: ${modelName}.`);
	              const rawContent = data.choices?.[0]?.message?.content || "";
	              return cleanAiThinkingProcess(rawContent);
	            } else {
	              const errorText = await response.text();
	              if (response.status === 429) {
	                console.info(`ℹ️ [callGroq] Groq modelo ${modelName} límite de tasa (status 429).`);
	              } else {
	                console.warn(`⚠️ [callGroq] Groq error ${modelName} (status ${response.status}): ${errorText}`);
	              }
	              lastError = new Error(`Groq API error (status ${response.status}): ${errorText}`);
	            }
	          } catch (err: any) {
	            console.warn(`⚠️ [callGroq] Llamada Groq fallida para modelo ${modelName}: ${err.message}`);
	            lastError = err;
	          }
	        }
	        throw lastError || new Error("Todos los modelos de Groq fallaron.");
	      });
	    } catch (groqPoolErr: any) {
	      console.warn(`⚠️ [callGroq] Error en pool de Groq (${groqPoolErr.message}).`);
	    }
	  }

	  throw new Error("No fue posible generar respuesta con ningún proveedor de IA (Vertex AI / Gemini / Groq).");
	}

	async function isCustomerResponseLLM(commentText: string): Promise<[boolean, string]> {
	  if (commentText.trim().length < 10) {
		return [false, "corto"];
	  }

	  const lower = commentText.toLowerCase();

	  // Deterministic fast-path for direct inbound customer interactions
	  const directCustomerActionPhrases = [
		"customer called", "client called", "called us", "called customer service", "called the store", "inbound call",
		"cliente llamó", "cliente llamo", "llamó el cliente", "llamo el cliente", "llamada entrante",
		"customer contacted", "client contacted", "cliente contactó", "cliente contacto", "cliente se comunicó",
		"customer reached out", "client reached out", "customer responded", "cliente respondió", "cliente respondio",
		"interested in purchasing", "interested in buying", "interesado en comprar", "interesado en adquirir", "wants to buy"
	  ];

	  if (directCustomerActionPhrases.some(p => lower.includes(p)) && !lower.includes("[agente intentó contactar pero cliente no respondió]")) {
		return [true, "Direct customer call/inquiry detected"];
	  }

	  const prompt = `Read this customer service log. I only need to know ONE simple thing: DID THE CUSTOMER ACTUALLY REPLY, CALL, OR TAKE AN EXPLICIT ACTION IN THIS LOG? Yes or No.

	  ABSOLUTE RULES:
	  1. ZERO ASSUMPTIONS: If the log only describes what the AGENT did, tried to do, or wanted to do (e.g., "attempted to contact", "informed her", "required her", "sent an email"), the answer is NO.
	  2. PASSIVE VOICE = NO: If the text says "The customer was informed" or "She was required", that is the agent acting. The customer did NOTHING. Answer: NO.
	  3. THE "YES" CRITERIA: The answer is TRUE if there is clear proof that the customer spoke, called, wrote, or physically acted (e.g., "Customer called...", "She said...", "She replied...", "She sent the ID...", "Customer confirmed...", "Customer interested in purchasing...", "Client reached out...").
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
		"Authorization": getClickUpApiKey(),
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
		const response = await fetch(url, { headers: { "Authorization": getClickUpApiKey() } });
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
			  const author = c.user?.username || "Usuario";
			  clean.push(`[${fechaStr} - ${author}]: ${textLimpio.slice(0, 350)}`);

			  if (c.reply_count && c.reply_count > 0) {
			    try {
			      const rRes = await fetch(`https://api.clickup.com/api/v2/comment/${c.id}/reply`, { headers: { "Authorization": getClickUpApiKey() } });
			      if (rRes.ok) {
			        const rData = await rRes.json() as any;
			        for (const r of (rData.comments || [])) {
			          const rText = censurarIntentosFallidos(r.comment_text || "");
			          const rAuthor = r.user?.username || "Usuario";
			          clean.push(`  ↳ [Respuesta - ${rAuthor}]: ${rText.slice(0, 300)}`);
			        }
			      }
			    } catch {}
			  }
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
		  const response = await fetchClickUp(url);
		  if (response.ok) {
			const data = await response.json() as any;
			const pageTasks = data.tasks || [];
			if (pageTasks.length === 0) {
			  break;
			}
			tasks.push(...pageTasks);
			page += 1;
		  } else {
			const errText = await response.text();
			console.warn(`ClickUp pagination response (status ${response.status}):`, errText);
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
		const response = await fetchClickUp(url);
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

	function detectIsGift(text: string): boolean {
	  if (!text) return false;
	  const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
	  const t = normalize(text);

	  const triggers = [
		"acepto regalo", "acepta regalo", "acepto el regalo", 
		"accepted gift", "accepts gift", "accepted the gift", 
		"de acuerdo en recibir los productos", "de acuerdo con recibir los productos",
		"agreed to receive the products", "recibir los productos en compensacion",
		"productos en compensacion", "productos como compensacion", 
		"products as compensation", "regalo de compensacion",
		"compensation options", "compensation option", "pre-approved compensation",
		"pre approved compensation", "opciones de compensacion", "opcion de compensacion",
		"paint relave stick", "relave stick", "paint stick", "paint relave",
		"offered a gift", "offered compensation", "offered as compensation",
		"accepted satisfactorily", "acepto la compensacion", "aceptaron la compensacion",
		"ofrecimos compensacion", "ofrecio compensacion", "ofrecimos un regalo", "ofrecio un regalo",
		"offered a paint", "offered a paint relave", "which they accepted",
		"la clienta ha aceptado", "la clienta acepto", "la clienta acepta",
		"el cliente ha aceptado", "el cliente acepto", "el cliente acepta",
		"cliente acepto", "cliente ha aceptado", "cliente acepta",
		"la clienta acepto la resolucion", "cliente acepto la resolucion",
		"acepto la resolucion", "acepta la resolucion", "ha aceptado la resolucion",
		"the client accepted", "client accepted", "customer accepted", "the customer accepted",
		"client has accepted", "customer has accepted", "accepted the resolution",
		"accepts the resolution", "has accepted the resolution", "accepted resolution",
		"accepts resolution", "she accepted", "he accepted", "she has accepted", "he has accepted"
	  ];

	  const matched = triggers.find(trig => t.includes(normalize(trig)));
	  if (!matched) return false;

	  const matchIdx = t.indexOf(normalize(matched));
	  const prefijo = t.substring(Math.max(0, matchIdx - 20), matchIdx);
	  if (["no ", "not ", "n't ", "sin "].some(neg => prefijo.includes(neg))) {
		return false;
	  }

	  return true;
	}

	function detectIsDeadline(text: string): boolean {
	  if (!text) return false;
	  const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
	  const t = normalize(text);

	  // If it's a mention of an expired/past deadline or closing after deadline, do NOT trigger deadline status
	  const pastDeadlineMentions = [
		"been on deadline",
		"on deadline for",
		"after deadline",
		"deadline for over",
		"estuvo en deadline",
		"pasaron los 4 dias",
		"pasaron los dias",
		"dias en deadline",
		"cumplio deadline",
		"vencio deadline",
		"deadline vencido",
		"sin respuesta al deadline",
		"no reply to deadline"
	  ];
	  if (pastDeadlineMentions.some(p => t.includes(normalize(p)))) {
		return false;
	  }

	  const triggers = [
		"assign a deadline",
		"assigning a deadline",
		"assigned a deadline",
		"will assign a deadline",
		"plazo limite",
		"fecha limite",
		"send a deadline",
		"sending a deadline",
		"envio de deadline",
		"enviar deadline",
		"estatus a deadline",
		"dar deadline",
		"darle deadline",
		"colocar en deadline",
		"mover a deadline"
	  ];
	  if (triggers.some(trig => t.includes(normalize(trig)))) {
		return true;
	  }
	  // Single word trigger only if not in closure context
	  if (t.includes("deadline") && !t.includes("close") && !t.includes("cerrar") && !t.includes("closed") && !t.includes("lost lead")) {
		return true;
	  }
	  return false;
	}

	function detectIsProductAndRefund(text: string): boolean {
	  if (!text) return false;
	  const norm = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

	  // 1. Explicit acronyms & direct phrases
	  if (
	    norm.includes("p+r") ||
	    norm.includes("p + r") ||
	    norm.includes("p&r") ||
	    norm.includes("product + refund") ||
	    norm.includes("product and refund") ||
	    norm.includes("product & refund") ||
	    norm.includes("producto + reembolso") ||
	    norm.includes("producto y reembolso") ||
	    norm.includes("producto y un reembolso") ||
	    norm.includes("producto y aparte un reembolso") ||
	    norm.includes("producto y aparte reembolso") ||
	    norm.includes("producto mas reembolso") ||
	    norm.includes("producto y devolucion") ||
	    norm.includes("reembolso y producto") ||
	    norm.includes("reembolso mas producto") ||
	    norm.includes("reembolso y un producto") ||
	    norm.includes("un producto y aparte un reembolso") ||
	    norm.includes("un producto y un reembolso") ||
	    norm.includes("entregar un producto y aparte un reembolso")
	  ) {
	    return true;
	  }

	  // 2. Semantic combinations (delivering/sending product + refund)
	  const hasRefund = norm.includes("reembolso") || norm.includes("refund") || norm.includes("devolucion de dinero") || norm.includes("money back");
	  const hasProduct = norm.includes("producto") || norm.includes("product") || norm.includes("crema") || norm.includes("suero") || norm.includes("serum") || norm.includes("aparato") || norm.includes("device") || norm.includes("reposicion") || norm.includes("reemplazo") || norm.includes("regalo") || norm.includes("gift");
	  const hasDeliveryOrAction = norm.includes("entregar") || norm.includes("entrega") || norm.includes("enviar") || norm.includes("envio") || norm.includes("mandar") || norm.includes("ofrecer") || norm.includes("ofrecio") || norm.includes("acordo") || norm.includes("dar") || norm.includes("reponer");

	  if (hasRefund && (hasProduct || hasDeliveryOrAction)) {
	    if (
	      norm.includes("aparte") ||
	      norm.includes("ademas") ||
	      norm.includes("adicional") ||
	      norm.includes("tambien") ||
	      norm.includes("plus") ||
	      norm.includes(" y ") ||
	      norm.includes(" + ") ||
	      norm.includes("+") ||
	      norm.includes("&") ||
	      norm.includes("junto con") ||
	      norm.includes("con un")
	    ) {
	      return true;
	    }
	  }

	  return false;
	}

	function determineResolution(reason: string = "", text: string = ""): string | null {
	  const normText = (text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

	  // Exact ClickUp Dropdown Option UUIDs for Custom Field 55638270-b614-4783-ad1c-0bd994d6484b (RESOLUTION)
	  const ID_RES_REFUND = "e9367f41-cb3b-42f0-b612-6528d02098dc";
	  const ID_RES_GIFT = "94dad466-99f5-4f62-b6a1-f7d0a567ffae";
	  const ID_RES_DISPUTE = "a148c4e2-b2f3-4b6d-9cf6-6eb8255c6099";
	  const ID_RES_LOST_LEAD = "49bb94ed-70b8-4d8f-80ae-8b4f8ab9b04e";
	  const ID_RES_P_AND_R = "cdc84079-b6a3-4665-9161-97d8d7bac5eb";
	  const ID_RES_RESOLVED = "550d1479-412d-45f9-b7da-64cd69473af1";

	  // 0. Top Priority: Product + Refund (P+R) MUST precede standalone Refund / Gift
	  if (detectIsProductAndRefund(normText)) {
	    return ID_RES_P_AND_R;
	  }

	  // 1. Explicit Direct Text Triggers in comment/notes
	  if (normText.includes("disputa") || normText.includes("dispute") || normText.includes("chargeback") || normText.includes("contracargo")) {
	    return ID_RES_DISPUTE;
	  }
	  if (normText.includes("reembolso aprobado") || normText.includes("refund approved") || normText.includes("reembolso procesado") || normText.includes("refund processed") || normText.includes("se aprobo el reembolso")) {
	    return ID_RES_REFUND;
	  }
	  if (
	    normText.includes("acepto regalo") || 
	    normText.includes("acepto el regalo") || 
	    normText.includes("accepted gift") || 
	    normText.includes("accepted the gift") || 
	    normText.includes("regalo acordado") || 
	    normText.includes("enviar regalo compensatorio") ||
	    normText.includes("compensacion aceptada")
	  ) {
	    return ID_RES_GIFT;
	  }
	  if (normText.includes("lost lead") || normText.includes("cliente perdido") || normText.includes("cerrar por lost lead") || normText.includes("close as lost lead")) {
	    return ID_RES_LOST_LEAD;
	  }
	  if (normText.includes("p+r") || normText.includes("p & r")) {
	    return ID_RES_P_AND_R;
	  }
	  if (normText.includes("instrucciones enviadas") || normText.includes("caso resuelto") || normText.includes("duda aclarada") || normText.includes("resolved") || normText.includes("solucionado satisfactoriamente")) {
	    return ID_RES_RESOLVED;
	  }

	  // If no explicit resolution is established, return null (remain blank)
	  return null;
	}

	async function analyzeStatusTrigger(text: string): Promise<string> {
	  if (detectIsDeadline(text)) {
		return "deadline";
	  }
	  const textLower = text.toLowerCase();
	  if (textLower.includes("disputa") || textLower.includes("dispute") || textLower.includes("chargeback")) {
		return "dispute";
	  }
	  if ([
		"waiting for a tn", "waiting for a tracking", "waiting for tracking", "esperando guía", "esperando tracking", "tn pending",
		"pending review", "is currently pending review", "currently pending review", "under review",
		"pendiente de revision", "pendiente de revisión", "en revision", "en revisión", "esperando revision", "esperando revisión",
		"awaiting the seller", "awaiting seller", "waiting for the seller", "waiting for seller", "seller contact", "seller's contact",
		"sellers contact", "recommend the seller", "buyer's remorse", "esperando al vendedor", "esperando vendedor", "esperando que el vendedor"
	  ].some(frase => textLower.includes(frase))) {
		return "internal waiting";
	  }

	  if ([
		"tracking number", "tracking numbers", "tracking link", "in transit", "currently in transit", "active tracking", "fedex shipment", "shipment is scheduled",
		"provided her with tracking", "provided her with active tracking", "provided with tracking", "provided tracking",
		"numero de guia", "numeros de guia", "guia de rastreo", "guia:", "tracking:", "fedex tracking", "usps tracking", "ups tracking",
		"tracking number provided", "tracking numbers provided", "en transito", "en tránsito", "link de rastreo", "link de tracking"
	  ].some(frase => textLower.includes(frase)) && !textLower.includes("waiting for tracking") && !textLower.includes("waiting for a tn") && !textLower.includes("esperando guía")) {
		return "shipment follow up";
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
	6. Si hay espera interna, revisión, autorización ("pending review", "is currently pending review", "pendiente de revisión", "waiting for a TN"), o si estamos esperando que el vendedor/tienda contacte al cliente ("awaiting the seller", "awaiting seller's contact", "waiting for the seller", "recommend the seller contact"), o se está gestionando/ofreciendo enviar un reemplazo o producto pero aún no hay tracking -> internal waiting. 🚨 EXCEPCIÓN CRÍTICA: Si el comentario describe un intento de contacto directo por parte del agente (ej. "attempted to contact", "intentamos contactar"), haber dejado un mensaje (ej. "leave a message", "left a message", "dejó mensaje"), o estar esperando que la cliente elija o decida algo (ej. "product selection", "waiting for her to choose", "esperando que responda/seleccione"), esto NO es una espera interna de la empresa, sino que estamos esperando al cliente. Por lo tanto, debe clasificarse strictly como "cs reply" y NUNCA como "internal waiting" (A menos que sea específicamente esperar al vendedor/tienda "awaiting the seller").
	7. Si recibió paquete -> cs reply
	8. Si el agente indica que se procede a cerrar el caso, o que la tarea/ticket se cerrará o está cerrada -> closed
	9. Si el comentario describe un monólogo del agente, un intento de llamada/contacto fallido, o estar esperando que el cliente responda, actúe o elija un producto de compensación (ej. "regarding the product selection for compensation"), el estatus debe ser "cs reply". JAMÁS debe ser "internal waiting".

	Texto del comentario a evaluar: '${text}'

	Responde ÚNICAMENTE el nombre exacto del estatus en minúsculas (ej. cs reply, deadline, lost lead, internal waiting, shipment follow up, dispute, closed, none). No agregues puntos, ni explicaciones.`;

		let status = (await callGroq(prompt, "You are a precise ClickUp status router classifier.")).trim().toLowerCase();
		
		// Post-process correction to enforce the user's rule programmatically
		const isWillSendOrAddressing = (textLower.includes("will send") || textLower.includes("enviara") || textLower.includes("se le enviara") || textLower.includes("addressing the issue") || textLower.includes("mandar un reemplazo") || textLower.includes("send a replacement") || textLower.includes("enviar un reemplazo"));
		const hasTrackingNumberOrGuia = (
		  textLower.includes("tracking number") ||
		  textLower.includes("tracking numbers") ||
		  textLower.includes("tracking link") ||
		  textLower.includes("in transit") ||
		  textLower.includes("active tracking") ||
		  textLower.includes("fedex shipment") ||
		  textLower.includes("shipment is scheduled") ||
		  textLower.includes("numero de guia") ||
		  textLower.includes("numeros de guia") ||
		  textLower.includes("guia de rastreo") ||
		  textLower.includes("guia:") ||
		  textLower.includes("tracking:") ||
		  textLower.includes("fedex") ||
		  textLower.includes("usps") ||
		  textLower.includes("ups")
		);
		
		if (status === "shipment follow up" && isWillSendOrAddressing && !hasTrackingNumberOrGuia) {
		  console.log(`⚠️ Corrección manual de estatus: Comentario con intención de envío sin guía real. Forzando 'internal waiting' en vez de 'shipment follow up'.`);
		  status = "internal waiting";
		}

		// Correct internal waiting to cs reply if it represents a contact attempt or waiting for the customer's selection/response
		const textLowerNormalized = textLower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
		const isAwaitingSeller = (
		  textLowerNormalized.includes("awaiting the seller") ||
		  textLowerNormalized.includes("awaiting seller") ||
		  textLowerNormalized.includes("waiting for the seller") ||
		  textLowerNormalized.includes("waiting for seller") ||
		  textLowerNormalized.includes("seller contact") ||
		  textLowerNormalized.includes("seller's contact") ||
		  textLowerNormalized.includes("sellers contact") ||
		  textLowerNormalized.includes("recommend the seller") ||
		  textLowerNormalized.includes("esperando al vendedor") ||
		  textLowerNormalized.includes("esperando vendedor") ||
		  textLowerNormalized.includes("esperando que el vendedor")
		);

		if (isAwaitingSeller) {
		  console.log(`⚠️ Corrección manual de estatus: Comentario de espera de contacto o gestión del vendedor. Forzando 'internal waiting'.`);
		  status = "internal waiting";
		} else {
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
				headers: { "Authorization": getClickUpApiKey(), "Content-Type": "application/json" },
				body: JSON.stringify({ comment_text: comment })
			  });
			  // Update status to deadline
			  await fetch(`https://api.clickup.com/api/v2/task/${task.id}`, {
				method: "PUT",
				headers: { "Authorization": getClickUpApiKey(), "Content-Type": "application/json" },
				body: JSON.stringify({ status: "deadline" })
			  });
			  console.log(`Task moved to DEADLINE: ${task.id}`);
			} else if (currentStatus === "deadline") {
			  // Use exact Spanish text requested by Donna: "esta tarea se ha cerrado por qeu h aoasado mas de cuatro dias en deadline"
			  const comment = `esta tarea se ha cerrado por qeu h aoasado mas de cuatro dias en deadline`;
			  // Comment to ClickUp
			  await fetch(`https://api.clickup.com/api/v2/task/${task.id}/comment`, {
				method: "POST",
				headers: { "Authorization": getClickUpApiKey(), "Content-Type": "application/json" },
				body: JSON.stringify({ comment_text: comment })
			  });
			  // Update status to Closed
			  await fetch(`https://api.clickup.com/api/v2/task/${task.id}`, {
				method: "PUT",
				headers: { "Authorization": getClickUpApiKey(), "Content-Type": "application/json" },
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

	// API Keys & Vertex Status Endpoint
	app.get("/api/keys/status", (req, res) => {
	  res.json({
	    success: true,
	    vertex: {
	      hasProject: !!process.env.GOOGLE_CLOUD_PROJECT,
	      project: process.env.GOOGLE_CLOUD_PROJECT || "No configurado",
	      location: process.env.GOOGLE_CLOUD_LOCATION || "global",
	      hasServiceAccountJson: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
	      hasApiKey: !!process.env.GEMINI_API_KEY
	    },
	    groq: {
	      count: groqKeyRotator.getKeys().length,
	      hasKeys: groqKeyRotator.getKeys().length > 0,
	      activeKeyMasked: groqKeyRotator.getActiveKey() ? `${groqKeyRotator.getActiveKey().substring(0, 7)}...` : "None"
	    },
	    clickup: {
	      hasKey: !!getClickUpApiKey(),
	      keyMasked: getClickUpApiKey() ? `${getClickUpApiKey().substring(0, 6)}...` : "None"
	    }
	  });
	});

	// Endpoint para probar Vertex AI en vivo desde Donna AI
	app.post("/api/test-vertex", async (req, res) => {
	  const startTime = Date.now();
	  const customPrompt = req.body?.prompt || "Hola Donna AI, confirma por favor que te estás ejecutando activamente sobre Google Cloud Vertex AI con Gemini 2.5 Flash.";

	  const project = process.env.GOOGLE_CLOUD_PROJECT || "No configurado";
	  const location = process.env.GOOGLE_CLOUD_LOCATION || "global";
	  const hasServiceAccountJson = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
	  const hasApiKey = !!process.env.GEMINI_API_KEY;

	  try {
	    const client = getVertexClient();
	    const result = await client.models.generateContent({
	      model: "gemini-2.5-flash",
	      contents: customPrompt,
	      config: {
	        systemInstruction: "Eres Donna AI ejecutándote en Vertex AI de Google Cloud. Responde de manera profesional, concisa y elegante en español confirmando que Vertex AI está funcionando correctamente."
	      }
	    });

	    const latencyMs = Date.now() - startTime;
	    return res.json({
	      success: true,
	      provider: "Google Cloud Vertex AI",
	      modelUsed: "gemini-2.5-flash",
	      project,
	      location,
	      hasServiceAccountJson,
	      hasApiKey,
	      latencyMs,
	      response: result.text || "Respuesta vacía obtenida del modelo."
	    });
	  } catch (err: any) {
	    const latencyMs = Date.now() - startTime;
	    console.error("Error en /api/test-vertex:", err);
	    return res.status(500).json({
	      success: false,
	      provider: "Google Cloud Vertex AI",
	      project,
	      location,
	      hasServiceAccountJson,
	      hasApiKey,
	      latencyMs,
	      error: err.message || String(err),
	      helpTip: "Verifica que en Settings > Secrets tengas GOOGLE_CLOUD_PROJECT con tu ID de proyecto de GCP (ejemplo: mis-app-258d2) y que la API de Vertex AI esté habilitada en Google Cloud Console."
	    });
	  }
	});

	// Función reutilizable para ejecutar la exportación ClickUp -> Google Sheets con Vertex AI
	async function runExportClickupToSheetsJob(options: {
	  spreadsheetId?: string;
	  sheetName?: string;
	  includeClosed?: boolean;
	  googleAccessToken?: string | null;
	  assigneeId?: string;
	  onlyMyTasks?: boolean;
	}) {
	  const startTime = Date.now();
	  const spreadsheetId = options?.spreadsheetId || "1RvYVVhdfU37FeCkgBdhfQ7xdBLDtET5XupBY_ivilDI";
	  let sheetName = options?.sheetName || "13 de agosto";
	  if (!sheetName || sheetName.toLowerCase() === "auto") {
	    const dateObj = new Date();
	    const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
	    sheetName = `${dateObj.getDate()} de ${months[dateObj.getMonth()]}`;
	  }

	  const includeClosed = options?.includeClosed !== false;
	  const googleAccessToken = options?.googleAccessToken || null;
	  const targetAssigneeId = options?.assigneeId || ID_DONNA;
	  const onlyMyTasks = options?.onlyMyTasks !== false;

	  console.log(`🚀 [ExportToSheets] Iniciando exportación ClickUp -> Google Sheet (${spreadsheetId}, hoja: "${sheetName}")`);

	  // 1. Recorrer páginas de ClickUp
	  let allTasks: any[] = [];
	  let page = 0;
	  let pagesCount = 0;

	  let assigneeParam = "";
	  if (onlyMyTasks) {
	    const ids = Array.from(new Set([String(targetAssigneeId), "101113624"]));
	    assigneeParam = ids.map(id => `&assignees[]=${encodeURIComponent(id)}`).join("");
	  }

	  while (true) {
	    const clickupUrl = `https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task?include_closed=${includeClosed}&subtasks=true&page=${page}${assigneeParam}`;
	    const clickupRes = await fetchClickUp(clickupUrl);
	    
	    if (!clickupRes.ok) {
	      const errBody = await clickupRes.text();
	      console.warn(`⚠️ [ExportToSheets] Error al consultar página ${page} de ClickUp: ${errBody}`);
	      break;
	    }

	    const data = await clickupRes.json() as any;
	    const pageTasks = data.tasks || [];
	    if (pageTasks.length === 0) {
	      if (page === 0 && onlyMyTasks && assigneeParam !== "") {
	        console.warn(`⚠️ [ExportToSheets] 0 tareas obtenidas con filtro de URL assignees. Reintentando consulta completa sin filtro URL...`);
	        assigneeParam = "";
	        continue;
	      }
	      break;
	    }

	    allTasks.push(...pageTasks);
	    page++;
	    pagesCount++;

	    if (page > 150) break;
	  }

	  console.log(`📦 [ExportToSheets] Se obtuvieron ${allTasks.length} tareas en ${pagesCount} páginas.`);

	  // Filtrar tareas asignadas a Donna AI o ID/email configurado, y filtrar tareas activas si no se piden cerradas
	  const myTasks = allTasks.filter((t: any) => {
	    // Excluir tareas cerradas si includeClosed es false
	    const statusStr = String(t.status?.status || "").trim().toLowerCase();
	    const isClosed = ["closed", "complete", "completed", "resuelto", "cerrado", "resolved"].includes(statusStr) || t.status?.type === "closed";
	    if (!includeClosed && isClosed) return false;

	    if (onlyMyTasks) {
	      if (!t.assignees || !Array.isArray(t.assignees) || t.assignees.length === 0) return false;
	      const targetStr = String(targetAssigneeId).trim().toLowerCase();
	      return t.assignees.some((a: any) => {
	        const aId = String(a.id || "").trim();
	        const aEmail = String(a.email || "").trim().toLowerCase();
	        const aUsername = String(a.username || a.name || "").trim().toLowerCase();

	        if (aId === targetStr || aId === "101113624") return true;
	        if (targetStr.includes("donna") || targetStr === "101113624") {
	          if (aEmail.includes("donna") || aUsername.includes("donna")) return true;
	        }
	        if (targetStr && targetStr !== "101113624") {
	          if (aEmail.includes(targetStr) || aUsername.includes(targetStr)) return true;
	        }
	        return false;
	      });
	    }
	    return true;
	  });

	  console.log(`🎯 [ExportToSheets] Tareas filtradas (solo activas=${!includeClosed}, solo mis tareas=${onlyMyTasks}): ${myTasks.length} de ${allTasks.length} tareas.`);

	  // Helper para extraer e formatear Custom Fields
	  function extractCustomFieldsForSheet(customFields: any[]) {
	    const map: Record<string, string> = {};
	    const summaryLines: string[] = [];

	    for (const cf of customFields || []) {
	      if (cf.value === undefined || cf.value === null || cf.value === "") continue;
	      let val = "";
	      if (cf.type_config?.options && Array.isArray(cf.type_config.options)) {
	        const opts = cf.type_config.options;
	        if (typeof cf.value === "string") {
	          const m = opts.find((o: any) => o.id === cf.value || o.name === cf.value);
	          val = m ? m.name : cf.value;
	        } else if (typeof cf.value === "number") {
	          const m = opts.find((o: any) => o.orderindex === cf.value || o.id === cf.value);
	          val = m ? m.name : String(cf.value);
	        } else if (Array.isArray(cf.value)) {
	          val = cf.value.map((v: any) => {
	            const m = opts.find((o: any) => o.id === v || o.orderindex === v);
	            return m ? m.name : String(v);
	          }).join(", ");
	        }
	      } else if (cf.type === "date" && (typeof cf.value === "string" || typeof cf.value === "number")) {
	        val = new Date(parseInt(String(cf.value))).toLocaleDateString("es-MX");
	      } else if (typeof cf.value === "object" && cf.value !== null) {
	        val = cf.value.name || cf.value.text || cf.value.url || JSON.stringify(cf.value);
	      } else {
	        val = String(cf.value);
	      }

	      if (val && val.trim()) {
	        const fName = (cf.name || cf.id).trim();
	        const cleanVal = val.trim();
	        map[fName] = cleanVal;
	        summaryLines.push(`${fName}: ${cleanVal}`);
	      }
	    }

	    return {
	      map,
	      summary: summaryLines.length > 0 ? summaryLines.join(" | ") : "Sin campos personalizados"
	    };
	  }

	  // Helper para formatear comentarios principales y respuestas en hilo
	  function formatTaskCommentsFull(commentsList: any[]): { fullFormattedText: string; totalCount: number; aiFormattedText: string } {
	    let totalCount = 0;
	    const blocks: string[] = [];
	    const aiLines: string[] = [];

	    for (const c of commentsList || []) {
	      totalCount++;
	      const author = c.user?.username || c.user?.email || "Usuario / Bot";
	      const dateStr = c.date ? new Date(parseInt(c.date)).toLocaleString("es-MX") : "";
	      const text = censurarIntentosFallidos((c.comment_text || "").trim());

	      let block = `[${dateStr ? dateStr + " - " : ""}${author}]:\n${text}`;
	      aiLines.push(`[${author}]: ${text}`);

	      if (Array.isArray(c.replies) && c.replies.length > 0) {
	        for (const r of c.replies) {
	          totalCount++;
	          const rAuthor = r.user?.username || r.user?.email || "Usuario / Bot";
	          const rDateStr = r.date ? new Date(parseInt(r.date)).toLocaleString("es-MX") : "";
	          const rText = censurarIntentosFallidos((r.comment_text || "").trim());

	          block += `\n\n  ↳ [RESPUESTA ${rDateStr ? "(" + rDateStr + ") " : ""}- ${rAuthor}]:\n  ${rText.replace(/\n/g, "\n  ")}`;
	          aiLines.push(`  ↳ [Respuesta de ${rAuthor}]: ${rText}`);
	        }
	      }
	      blocks.push(block);
	    }

	    return {
	      fullFormattedText: blocks.length > 0 ? blocks.join("\n\n----------------------------------------\n\n") : "Sin comentarios registrados",
	      totalCount,
	      aiFormattedText: aiLines.join("\n")
	    };
	  }

	  // Helper con timeout para evitar estancamientos en peticiones individuales
	  const fetchWithTimeout = async (url: string, options: any = {}, timeoutMs = 5000) => {
	    const controller = new AbortController();
	    const timer = setTimeout(() => controller.abort(), timeoutMs);
	    try {
	      const res = await fetch(url, { ...options, signal: controller.signal });
	      return res;
	    } finally {
	      clearTimeout(timer);
	    }
	  };

	  // 2. Obtener comentarios y respuestas en hilo para cada tarea filtrada en lotes concurrentes de 12
	  const batchSize = 12;
	  for (let i = 0; i < myTasks.length; i += batchSize) {
	    const chunk = myTasks.slice(i, i + batchSize);
	    await Promise.all(
	      chunk.map(async (task) => {
	        try {
	          const commentRes = await fetchWithTimeout(`https://api.clickup.com/api/v2/task/${task.id}/comment`, {
	            headers: { "Authorization": getClickUpApiKey() }
	          }, 5000);
	          if (commentRes.ok) {
	            const cData = await commentRes.json() as any;
	            const rawComments = cData.comments || [];

	            // Obtener respuestas para cada comentario con hilo
	            await Promise.all(
	              rawComments.map(async (c: any) => {
	                if (c.reply_count && c.reply_count > 0) {
	                  try {
	                    const rRes = await fetchWithTimeout(`https://api.clickup.com/api/v2/comment/${c.id}/reply`, {
	                      headers: { "Authorization": getClickUpApiKey() }
	                    }, 4000);
	                    if (rRes.ok) {
	                      const rData = await rRes.json() as any;
	                      c.replies = rData.comments || [];
	                    } else {
	                      c.replies = [];
	                    }
	                  } catch {
	                    c.replies = [];
	                  }
	                } else {
	                  c.replies = [];
	                }
	              })
	            );
	            task.commentsList = rawComments;
	          } else {
	            task.commentsList = [];
	          }
	        } catch {
	          task.commentsList = [];
	        }
	      })
	    );
	  }

	  // 3. Procesar resúmenes con Vertex AI (Gemini 2.5 Flash) para tareas con comentarios en lotes de 10
	  let summariesProcessed = 0;
	  const aiChunkSize = 10;
	  for (let i = 0; i < myTasks.length; i += aiChunkSize) {
	    const chunk = myTasks.slice(i, i + aiChunkSize);
	    await Promise.all(
	      chunk.map(async (task) => {
	        const formattedComments = formatTaskCommentsFull(task.commentsList);
	        task.formattedCommentsData = formattedComments;

	        if (task.commentsList && task.commentsList.length > 0) {
	          try {
	            const prompt = `Analiza la siguiente tarea de atención al cliente en ClickUp:\n` +
	              `Nombre: ${task.name || 'Sin título'}\n` +
	              `Descripción: ${(task.description || '').substring(0, 300)}\n` +
	              `Comentarios y respuestas en hilo registrados:\n${formattedComments.aiFormattedText.substring(0, 3500)}\n\n` +
	              `Instrucciones: Genera una síntesis ejecutiva de 1 o 2 oraciones en español explicando la resolución o estado actual de este caso considerando los comentarios principales y sus respuestas en hilo.`;

	            const client = getVertexClient();
	            const aiPromise = client.models.generateContent({
	              model: "gemini-2.5-flash",
	              contents: prompt,
	              config: { temperature: 0.1 }
	            });

	            // Timeout de 6s para llamada a Vertex AI
	            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout Vertex AI")), 6000));
	            const aiRes = await Promise.race([aiPromise, timeoutPromise]) as any;

	            task.vertexSummary = (aiRes.text || "").trim();
	            summariesProcessed++;
	          } catch (err: any) {
	            task.vertexSummary = `Sintetizado parcialmente: ${formattedComments.aiFormattedText.substring(0, 150)}`;
	          }
	        } else {
	          task.vertexSummary = "Sin comentarios registrados en ClickUp";
	        }
	      })
	    );
	  }

	  // 4. Autenticación con Google Sheets
	  let authClient: any;
	  if (googleAccessToken) {
	    const oauth2Client = new google.auth.OAuth2();
	    oauth2Client.setCredentials({ access_token: googleAccessToken });
	    authClient = oauth2Client;
	  } else if (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
	    try {
	      const jsonString = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
	      const creds = JSON.parse(jsonString.trim());
	      authClient = new google.auth.GoogleAuth({
	        credentials: creds,
	        scopes: [
	          "https://www.googleapis.com/auth/spreadsheets",
	          "https://www.googleapis.com/auth/drive.file"
	        ]
	      });
	    } catch (jsonErr: any) {
	      authClient = new google.auth.GoogleAuth({
	        scopes: [
	          "https://www.googleapis.com/auth/spreadsheets",
	          "https://www.googleapis.com/auth/drive.file"
	        ]
	      });
	    }
	  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
	    authClient = new google.auth.GoogleAuth({
	      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
	      scopes: [
	        "https://www.googleapis.com/auth/spreadsheets",
	        "https://www.googleapis.com/auth/drive.file"
	      ]
	    });
	  } else {
	    authClient = new google.auth.GoogleAuth({
	      scopes: [
	        "https://www.googleapis.com/auth/spreadsheets",
	        "https://www.googleapis.com/auth/drive.file"
	      ]
	    });
	  }

	  const sheets = google.sheets({ version: "v4", auth: authClient });

	  // 5. Verificar si existe la pestaña/hoja con el nombre `sheetName`
	  let sheetExists = false;
	  try {
	    const spreadsheetMeta = await sheets.spreadsheets.get({ spreadsheetId });
	    const existingSheets = spreadsheetMeta.data.sheets || [];
	    sheetExists = existingSheets.some(
	      (s) => s.properties?.title?.toLowerCase() === sheetName.toLowerCase()
	    );
	  } catch (metaErr: any) {
	    console.warn("⚠️ No se pudo consultar metadata del Spreadsheet, se intentará escribir directamente:", metaErr.message);
	  }

	  if (!sheetExists) {
	    try {
	      console.log(`📄 [ExportToSheets] Creando nueva hoja "${sheetName}" en el libro...`);
	      await sheets.spreadsheets.batchUpdate({
	        spreadsheetId,
	        requestBody: {
	          requests: [
	            {
	              addSheet: {
	                properties: {
	                  title: sheetName
	                }
	              }
	            }
	          ]
	        }
	      });
	    } catch (addSheetErr: any) {
	      console.warn("⚠️ Creación de hoja omitida o ya existente:", addSheetErr.message);
	    }
	  }

	  // 6. Formatear los datos para las filas
	  const headerRow = [
	    "ID Tarea",
	    "Nombre Tarea",
	    "Estado",
	    "Asignados",
	    "Fecha Creación",
	    "Última Actualización",
	    "Monto USD",
	    "Razón / Motivo",
	    "Tienda / Localización",
	    "Resolución",
	    "Fecha Venta / Contacto",
	    "Campos Personalizados (Detalle Completo)",
	    "Total Comentarios",
	    "Síntesis Vertex AI",
	    "Comentarios y Respuestas (Compañeros + Brain)",
	    "Enlace ClickUp"
	  ];

	  const valuesRows: any[][] = [headerRow];

	  for (const task of myTasks) {
	    const assignees = (task.assignees || []).map((a: any) => a.username || a.email).join(", ") || "Sin asignar";
	    const createdDate = task.date_created ? new Date(parseInt(task.date_created)).toLocaleString("es-MX") : "";
	    const updatedDate = task.date_updated ? new Date(parseInt(task.date_updated)).toLocaleString("es-MX") : "";
	    
	    const formatted = task.formattedCommentsData || formatTaskCommentsFull(task.commentsList);
	    const totalComments = formatted.totalCount;
	    const commentsCellContent = formatted.fullFormattedText;

	    const cfParsed = extractCustomFieldsForSheet(task.custom_fields);
	    const amountUsd = cfParsed.map["Amount usd"] || cfParsed.map["Monto USD"] || cfParsed.map["Monto"] || "-";
	    const reason = cfParsed.map["Reason"] || cfParsed.map["Razón"] || cfParsed.map["Motivo"] || "-";
	    const store = cfParsed.map["Store / Location / Class"] || cfParsed.map["Tienda"] || "-";
	    const resolution = cfParsed.map["RESOLUTION"] || cfParsed.map["Resolución"] || "-";
	    const saleDate = cfParsed.map["Sale Date"] || cfParsed.map["Fecha de Venta"] || cfParsed.map["Contact date"] || "-";
	    const fullCfSummary = cfParsed.summary;

	    valuesRows.push([
	      task.id,
	      task.name || "",
	      task.status?.status || "",
	      assignees,
	      createdDate,
	      updatedDate,
	      amountUsd,
	      reason,
	      store,
	      resolution,
	      saleDate,
	      fullCfSummary,
	      totalComments.toString(),
	      task.vertexSummary || "",
	      commentsCellContent,
	      task.url || `https://app.clickup.com/t/${task.id}`
	    ]);
	  }

	  // Clear previous content in sheet and write new data
	  try {
	    await sheets.spreadsheets.values.clear({
	      spreadsheetId,
	      range: `'${sheetName}'!A1:Z10000`
	    });
	  } catch {}

	  await sheets.spreadsheets.values.update({
	    spreadsheetId,
	    range: `'${sheetName}'!A1`,
	    valueInputOption: "USER_ENTERED",
	    requestBody: {
	      values: valuesRows
	    }
	  });

	  const elapsedMs = Date.now() - startTime;
	  console.log(`✅ [ExportToSheets] Exportación finalizada con éxito en ${elapsedMs}ms!`);

	  return {
	    success: true,
	    spreadsheetId,
	    sheetName,
	    tasksCount: myTasks.length,
	    totalListTasks: allTasks.length,
	    targetAssigneeId,
	    pagesCount,
	    summariesCount: summariesProcessed,
	    rowsCount: valuesRows.length,
	    latencyMs: elapsedMs,
	    timestamp: new Date().toISOString()
	  };
	}

	// Endpoint de Exportación Manual
	app.post("/api/export-clickup-sheets", async (req, res) => {
	  try {
	    const result = await runExportClickupToSheetsJob(req.body);
	    return res.json(result);
	  } catch (err: any) {
	    console.error("❌ Error en /api/export-clickup-sheets:", err);
	    return res.status(500).json({
	      success: false,
	      error: err.message || String(err),
	      helpTip: "Asegúrate de que la hoja de cálculo esté compartida con permisos de edición para la Service Account (vertex-ai@mis-app-258d2.iam.gserviceaccount.com) o que hayas iniciado sesión con tu cuenta de Google."
	    });
	  }
	});

	// --- EXPORTADOR PROGRAMADO (CRON JOB AUTOMÁTICO) ---
	const CRON_CONFIG_PATH = path.join(process.cwd(), "cron_sheets_config.json");

	let cronConfig = {
	  enabled: true,
	  intervalHours: 3,
	  cronExpression: "0 */3 * * *",
	  spreadsheetId: "1RvYVVhdfU37FeCkgBdhfQ7xdBLDtET5XupBY_ivilDI",
	  sheetName: "13 de agosto",
	  includeClosed: true,
	  onlyMyTasks: true,
	  assigneeId: "101113624",
	  lastRunTime: null as string | null,
	  lastRunStatus: null as string | null,
	  lastRunDetails: null as any
	};

	try {
	  if (fs.existsSync(CRON_CONFIG_PATH)) {
	    const raw = fs.readFileSync(CRON_CONFIG_PATH, "utf-8");
	    cronConfig = { ...cronConfig, ...JSON.parse(raw) };
	  }
	  // Si el servidor reinició o despertó y el estado se había quedado en "running", restaurarlo
	  if (cronConfig.lastRunStatus === "running") {
	    cronConfig.lastRunStatus = cronConfig.lastRunDetails?.success ? "success" : "idle";
	  }
	} catch (e) {
	  console.error("Error cargando cron_sheets_config.json:", e);
	}

	function saveCronConfig() {
	  try {
	    fs.writeFileSync(CRON_CONFIG_PATH, JSON.stringify(cronConfig, null, 2));
	  } catch (e) {
	    console.error("Error guardando cron_sheets_config.json:", e);
	  }
	}

	// Guardar estado inicial para asegurar persistencia
	saveCronConfig();

	let activeCronTask: any = null;

	function setupCronJob() {
	  if (activeCronTask) {
	    try { activeCronTask.stop(); } catch {}
	    activeCronTask = null;
	  }

	  if (!cronConfig.enabled) {
	    console.log("⏰ [CronExporter] Exportador programado actualmente DESACTIVADO.");
	    return;
	  }

	  const expr = cronConfig.cronExpression || `0 */${cronConfig.intervalHours || 3} * * *`;
	  if (!cron.validate(expr)) {
	    console.error(`❌ [CronExporter] Expresión Cron no válida: ${expr}`);
	    return;
	  }

	  console.log(`⏰ [CronExporter] Programando exportador automático con expresión "${expr}" (cada ${cronConfig.intervalHours} horas)...`);

	  activeCronTask = cron.schedule(expr, async () => {
	    console.log(`🔔 [CronExporter] Ejecutando tarea programada de exportación ClickUp -> Google Sheets...`);
	    cronConfig.lastRunTime = new Date().toISOString();
	    cronConfig.lastRunStatus = "running";
	    saveCronConfig();

	    try {
	      const res = await runExportClickupToSheetsJob({
	        spreadsheetId: cronConfig.spreadsheetId,
	        sheetName: cronConfig.sheetName,
	        includeClosed: cronConfig.includeClosed,
	        onlyMyTasks: cronConfig.onlyMyTasks,
	        assigneeId: cronConfig.assigneeId
	      });

	      cronConfig.lastRunStatus = "success";
	      cronConfig.lastRunDetails = res;
	      console.log(`✅ [CronExporter] Exportación programada finalizada con éxito. ${res.tasksCount} tareas exportadas.`);
	    } catch (err: any) {
	      cronConfig.lastRunStatus = "error";
	      cronConfig.lastRunDetails = { error: err.message || String(err) };
	      console.error(`❌ [CronExporter] Error en exportación programada:`, err);
	    } finally {
	      saveCronConfig();
	    }
	  });

	  // Catch-up al despertar: si el contenedor estuvo suspendido y ya pasaron más horas que el intervalo, ejecutar al iniciar
	  if (cronConfig.lastRunTime) {
	    const lastRunMs = new Date(cronConfig.lastRunTime).getTime();
	    const nowMs = Date.now();
	    const intervalMs = (cronConfig.intervalHours || 3) * 60 * 60 * 1000;
	    if (nowMs - lastRunMs > intervalMs) {
	      console.log(`⚡ [CronExporter] El servidor estuvo inactivo más de ${cronConfig.intervalHours}h desde la última ejecución. Iniciando sincronización de puesta al día...`);
	      setTimeout(async () => {
	        try {
	          cronConfig.lastRunTime = new Date().toISOString();
	          cronConfig.lastRunStatus = "running";
	          saveCronConfig();
	          const res = await runExportClickupToSheetsJob({
	            spreadsheetId: cronConfig.spreadsheetId,
	            sheetName: cronConfig.sheetName,
	            includeClosed: cronConfig.includeClosed,
	            onlyMyTasks: cronConfig.onlyMyTasks,
	            assigneeId: cronConfig.assigneeId
	          });
	          cronConfig.lastRunStatus = "success";
	          cronConfig.lastRunDetails = res;
	          saveCronConfig();
	          console.log(`✅ [CronExporter] Sincronización de puesta al día completada.`);
	        } catch (e: any) {
	          cronConfig.lastRunStatus = "error";
	          cronConfig.lastRunDetails = { error: e.message || String(e) };
	          saveCronConfig();
	        }
	      }, 3000);
	    }
	  }
	}

	// Inicializar Cron en el arranque
	setupCronJob();

	app.get("/api/cron/sheets-status", (req, res) => {
	  return res.json({
	    cronConfig,
	    isTaskActive: !!activeCronTask
	  });
	});

	app.post("/api/cron/sheets-config", (req, res) => {
	  try {
	    const { enabled, intervalHours, spreadsheetId, sheetName, includeClosed, onlyMyTasks, assigneeId } = req.body || {};
	    
	    if (typeof enabled === "boolean") cronConfig.enabled = enabled;
	    if (intervalHours && !isNaN(Number(intervalHours))) {
	      const hours = Number(intervalHours);
	      cronConfig.intervalHours = hours;
	      if (hours === 1) cronConfig.cronExpression = "0 * * * *";
	      else if (hours === 24) cronConfig.cronExpression = "0 8 * * *";
	      else cronConfig.cronExpression = `0 */${hours} * * *`;
	    }
	    if (spreadsheetId) cronConfig.spreadsheetId = spreadsheetId;
	    if (sheetName) cronConfig.sheetName = sheetName;
	    if (typeof includeClosed === "boolean") cronConfig.includeClosed = includeClosed;
	    if (typeof onlyMyTasks === "boolean") cronConfig.onlyMyTasks = onlyMyTasks;
	    if (assigneeId) cronConfig.assigneeId = assigneeId;

	    saveCronConfig();
	    setupCronJob();

	    return res.json({
	      success: true,
	      cronConfig,
	      message: cronConfig.enabled
	        ? `Exportación programada activada cada ${cronConfig.intervalHours} hora(s)`
	        : "Exportación programada desactivada"
	    });
	  } catch (err: any) {
	    return res.status(500).json({ success: false, error: err.message });
	  }
	});

	app.post("/api/cron/sheets-trigger", async (req, res) => {
	  console.log("⚡ [CronExporter] Disparando ejecución manual inmediata...");
	  cronConfig.lastRunTime = new Date().toISOString();
	  cronConfig.lastRunStatus = "running";
	  saveCronConfig();

	  try {
	    const result = await runExportClickupToSheetsJob({
	      spreadsheetId: cronConfig.spreadsheetId,
	      sheetName: cronConfig.sheetName,
	      includeClosed: cronConfig.includeClosed,
	      onlyMyTasks: cronConfig.onlyMyTasks,
	      assigneeId: cronConfig.assigneeId
	    });

	    cronConfig.lastRunStatus = "success";
	    cronConfig.lastRunDetails = result;
	    saveCronConfig();

	    return res.json({
	      success: true,
	      message: "Tarea ejecutada inmediatamente en segundo plano con éxito",
	      result
	    });
	  } catch (err: any) {
	    cronConfig.lastRunStatus = "error";
	    cronConfig.lastRunDetails = { error: err.message || String(err) };
	    saveCronConfig();
	    return res.status(500).json({ success: false, error: err.message });
	  }
	});

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

	// Zendesk Credentials Management & Connection Testing Endpoints
	app.get("/api/zendesk/config", async (req, res) => {
	  try {
	    const subdomain = (process.env.ZENDESK_SUBDOMAIN || "vipcosmetics").trim();
	    const email = (process.env.ZENDESK_EMAIL || "").trim();
	    const token = (process.env.ZENDESK_API_TOKEN || "").trim();
	    const hasToken = !!(token && token !== "tu_token_aqui");
	    
	    const maskedToken = hasToken
	      ? (token.length > 8 ? token.substring(0, 4) + "••••" + token.slice(-4) : "••••••••")
	      : "";

	    res.json({
	      success: true,
	      subdomain,
	      email,
	      hasToken,
	      maskedToken,
	      isConfigured: !!(subdomain && email && hasToken)
	    });
	  } catch (err: any) {
	    res.status(500).json({ success: false, error: err.message });
	  }
	});

	app.post("/api/zendesk/config", async (req, res) => {
	  try {
	    const { subdomain, email, token } = req.body || {};

	    if (subdomain !== undefined) process.env.ZENDESK_SUBDOMAIN = subdomain.trim();
	    if (email !== undefined) process.env.ZENDESK_EMAIL = email.trim();
	    if (token !== undefined && token.trim() !== "") process.env.ZENDESK_API_TOKEN = token.trim();

	    const envPath = path.join(process.cwd(), ".env");
	    const envExamplePath = path.join(process.cwd(), ".env.example");
	    
	    const updateFileEnv = async (filePath: string) => {
	      let lines: string[] = [];
	      if (fs.existsSync(filePath)) {
	        const content = await fsp.readFile(filePath, "utf-8");
	        lines = content.split("\n");
	      }
	      const setVar = (key: string, val: string) => {
	        const idx = lines.findIndex(l => l.trim().startsWith(`${key}=`));
	        if (idx !== -1) {
	          lines[idx] = `${key}="${val}"`;
	        } else {
	          lines.push(`${key}="${val}"`);
	        }
	      };
	      if (process.env.ZENDESK_SUBDOMAIN) setVar("ZENDESK_SUBDOMAIN", process.env.ZENDESK_SUBDOMAIN);
	      if (process.env.ZENDESK_EMAIL) setVar("ZENDESK_EMAIL", process.env.ZENDESK_EMAIL);
	      if (process.env.ZENDESK_API_TOKEN) setVar("ZENDESK_API_TOKEN", process.env.ZENDESK_API_TOKEN);
	      await fsp.writeFile(filePath, lines.join("\n"), "utf-8");
	    };

	    await updateFileEnv(envPath);
	    await updateFileEnv(envExamplePath);
	    await backupEnvToSupabase();

	    res.json({
	      success: true,
	      message: "Configuración de Zendesk guardada con éxito.",
	      subdomain: process.env.ZENDESK_SUBDOMAIN,
	      email: process.env.ZENDESK_EMAIL,
	      hasToken: !!process.env.ZENDESK_API_TOKEN
	    });
	  } catch (err: any) {
	    res.status(500).json({ success: false, error: err.message });
	  }
	});

	app.post("/api/zendesk/test-connection", async (req, res) => {
	  try {
	    const { subdomain, email, token } = req.body || {};

	    const targetSubdomain = (subdomain || process.env.ZENDESK_SUBDOMAIN || "vipcosmetics").toLowerCase().trim();
	    const targetEmail = (email || process.env.ZENDESK_EMAIL || "").trim();
	    const targetToken = (token || process.env.ZENDESK_API_TOKEN || "").trim();

	    if (!targetSubdomain) {
	      return res.status(400).json({
	        success: false,
	        error: "Falta el subdominio de Zendesk (ej. vipcosmetics). Por favor, ingrésalo."
	      });
	    }

	    if (!targetEmail) {
	      return res.status(400).json({
	        success: false,
	        error: "Falta el correo electrónico de Zendesk (ej. agente@empresa.com). Por favor, ingrésalo."
	      });
	    }

	    if (!targetToken || targetToken === "tu_token_aqui") {
	      return res.status(400).json({
	        success: false,
	        error: "Falta el API Token de Zendesk. Por favor, ingresa tu token activo."
	      });
	    }

	    // Ejecutar verificación real contra la API de Zendesk v2
	    try {
	      const meData = await zendeskFetch("/users/me.json", {
	        subdomain: targetSubdomain,
	        email: targetEmail,
	        token: targetToken
	      });

	      const user = meData.user;
	      return res.json({
	        success: true,
	        message: `¡Conexión a Zendesk API Exitosa! Credenciales autenticadas correctamente para ${user?.name || user?.email || targetEmail} (${user?.role || 'Agente'}) en https://${targetSubdomain}.zendesk.com.`,
	        subdomain: targetSubdomain,
	        email: targetEmail,
	        user: {
	          id: user?.id,
	          name: user?.name,
	          email: user?.email,
	          role: user?.role
	        }
	      });
	    } catch (directErr: any) {
	      // Verificación secundaria vía /tickets.json por si me.json tiene permisos restringidos
	      try {
	        const ticketsData = await zendeskFetch("/tickets.json?per_page=1", {
	          subdomain: targetSubdomain,
	          email: targetEmail,
	          token: targetToken
	        });
	        return res.json({
	          success: true,
	          message: `¡Conexión a Zendesk API Exitosa! Subdominio "${targetSubdomain}" verificado con éxito.`,
	          subdomain: targetSubdomain,
	          email: targetEmail,
	          ticketCount: ticketsData.count || ticketsData.tickets?.length || 0
	        });
	      } catch (fallbackErr: any) {
	        const rawError = directErr.message || fallbackErr.message || "Error al autenticar con Zendesk";
	        
	        let userTip = "Verifica que el Correo sea un usuario activo de Zendesk con rol de Agente/Admin y que el API Token haya sido generado en Zendesk Admin Center > Admin API > API Tokens.";
	        if (rawError.includes("401")) {
	          userTip = "Error 401 (No Autorizado): Zendesk rechazó las credenciales. Confirma que el token sea correcto y que el correo coincida con el usuario creador del token.";
	        } else if (rawError.includes("404")) {
	          userTip = `Error 404: No se encontró el subdominio https://${targetSubdomain}.zendesk.com. Confirma el nombre del subdominio.`;
	        }

	        return res.status(401).json({
	          success: false,
	          error: rawError,
	          details: userTip,
	          subdomain: targetSubdomain,
	          email: targetEmail
	        });
	      }
	    }
	  } catch (err: any) {
	    return res.status(500).json({
	      success: false,
	      error: `Error interno al realizar la prueba de conexión: ${err.message}`
	    });
	  }
	});

	// Endpoint para verificar si un usuario existe en Zendesk (por email, teléfono, nombre o query)
	app.all(["/api/zendesk/check-user", "/zendesk/check-user"], async (req, res) => {
	  try {
	    const params = req.method === "GET" ? req.query : req.body;
	    const { email, phone, name, query, external_id } = params || {};
	    const subdomain = (process.env.ZENDESK_SUBDOMAIN || "vipcosmetics").toLowerCase().trim();

	    const cleanEmail = (email || "").toString().trim();
	    const cleanPhone = (phone || "").toString().trim();
	    const cleanName = (name || "").toString().trim();
	    const cleanQuery = (query || "").toString().trim();
	    const cleanExtId = (external_id || "").toString().trim();

	    if (!cleanEmail && !cleanPhone && !cleanName && !cleanQuery && !cleanExtId) {
	      return res.status(400).json({
	        success: false,
	        exists: false,
	        error: "Debes proporcionar al menos un criterio de búsqueda (email, teléfono, nombre o término de búsqueda)."
	      });
	    }

	    let primaryQuery = "";
	    if (cleanEmail) {
	      primaryQuery = `type:user email:"${cleanEmail}"`;
	    } else if (cleanPhone) {
	      const digitsOnly = cleanPhone.replace(/[^\d+]/g, "");
	      primaryQuery = `type:user phone:"${digitsOnly}"`;
	    } else if (cleanExtId) {
	      primaryQuery = `type:user external_id:"${cleanExtId}"`;
	    } else if (cleanName) {
	      primaryQuery = `type:user name:"${cleanName}"`;
	    } else {
	      primaryQuery = `type:user ${cleanQuery}`;
	    }

	    console.log(`🔍 [Zendesk Check User] Buscando en Zendesk: "${primaryQuery}"`);

	    let rawUsers: any[] = [];
	    let isConfigured = true;

	    try {
	      // Búsqueda en API de usuarios de Zendesk
	      const searchRes = await zendeskFetch(`/users/search.json?query=${encodeURIComponent(primaryQuery)}`);
	      if (Array.isArray(searchRes?.users)) {
	        rawUsers = searchRes.users;
	      } else if (Array.isArray(searchRes?.results)) {
	        rawUsers = searchRes.results;
	      }

	      // Si la búsqueda inicial por campo no devolvió nada, probar una búsqueda general amplia
	      if (rawUsers.length === 0) {
	        const fallbackTerm = cleanEmail || cleanPhone.replace(/[^\d]/g, "") || cleanName || cleanQuery;
	        if (fallbackTerm && fallbackTerm.length >= 3) {
	          console.log(`🔍 [Zendesk Check User] Intentando búsqueda amplia en Zendesk con: "${fallbackTerm}"`);
	          const fallbackRes = await zendeskFetch(`/users/search.json?query=${encodeURIComponent(fallbackTerm)}`);
	          if (Array.isArray(fallbackRes?.users)) {
	            rawUsers = fallbackRes.users;
	          } else if (Array.isArray(fallbackRes?.results)) {
	            rawUsers = fallbackRes.results;
	          }
	        }
	      }
	    } catch (zdErr: any) {
	      console.warn(`[Zendesk Check User Error]: ${zdErr.message}`);
	      if (zdErr.message && (zdErr.message.includes("no configuradas") || zdErr.message.includes("401"))) {
	        isConfigured = false;
	      } else {
	        throw zdErr;
	      }
	    }

	    if (!isConfigured) {
	      return res.status(200).json({
	        success: false,
	        exists: false,
	        isConfigured: false,
	        message: "Credenciales de Zendesk no configuradas o no válidas. Configura tu Email y API Token de Zendesk en los ajustes.",
	        details: "ZENDESK_API_TOKEN / ZENDESK_EMAIL sin definir."
	      });
	    }

	    const exists = rawUsers.length > 0;

	    // Enriquecer usuarios con URLs directas y tickets recientes
	    const users = await Promise.all(
	      rawUsers.slice(0, 5).map(async (u: any) => {
	        let recentTickets: any[] = [];
	        try {
	          const ticketsRes = await zendeskFetch(`/users/${u.id}/tickets/requested.json?sort_by=created_at&sort_order=desc`);
	          if (Array.isArray(ticketsRes?.tickets)) {
	            recentTickets = ticketsRes.tickets.slice(0, 5).map((t: any) => ({
	              id: t.id,
	              subject: t.subject || "Sin Asunto",
	              status: t.status,
	              priority: t.priority,
	              created_at: t.created_at,
	              updated_at: t.updated_at,
	              zendesk_url: `https://${subdomain}.zendesk.com/agent/tickets/${t.id}`
	            }));
	          }
	        } catch (tErr) {
	          // No bloqueante si falla la consulta de tickets
	        }

	        return {
	          id: u.id,
	          name: u.name,
	          email: u.email,
	          phone: u.phone,
	          role: u.role,
	          verified: u.verified,
	          active: u.active,
	          suspended: u.suspended,
	          time_zone: u.time_zone,
	          created_at: u.created_at,
	          updated_at: u.updated_at,
	          organization_id: u.organization_id,
	          details: u.details,
	          notes: u.notes,
	          external_id: u.external_id,
	          tickets_count: recentTickets.length,
	          recent_tickets: recentTickets,
	          zendesk_profile_url: `https://${subdomain}.zendesk.com/agent/users/${u.id}`
	        };
	      })
	    );

	    return res.json({
	      success: true,
	      exists,
	      isConfigured: true,
	      count: users.length,
	      user: users[0] || null,
	      users,
	      search_criteria: {
	        email: cleanEmail,
	        phone: cleanPhone,
	        name: cleanName,
	        query: cleanQuery
	      },
	      message: exists
	        ? `✅ ¡Usuario encontrado en Zendesk! (${users.length} coincidencia${users.length > 1 ? "s" : ""})`
	        : `ℹ️ No se encontró ningún usuario registrado en Zendesk con los criterios ingresados.`
	    });
	  } catch (err: any) {
	    console.error("[Zendesk Check User Error]:", err.message);
	    return res.status(500).json({
	      success: false,
	      exists: false,
	      error: `Error al consultar la API de Zendesk: ${err.message}`
	    });
	  }
	});

	// Endpoint to directly update a user and/or ticket in Zendesk
	app.all(["/api/zendesk/update-user", "/zendesk/update-user"], async (req, res) => {
	  try {
	    const params = req.method === "GET" ? req.query : req.body;
	    const { user_id, task_id, phone, external_id, email, name, ticket_id, notes } = params || {};
	    
	    if (!user_id && !task_id && !ticket_id && !email && !phone && !external_id) {
	      return res.status(400).json({ 
	        success: false, 
	        error: "Debes proporcionar al menos un identificador (user_id, task_id, ticket_id, email, phone o external_id) para actualizar en Zendesk." 
	      });
	    }

	    const result = await syncZendeskUserAndTicket({
	      userId: user_id,
	      taskId: task_id,
	      zendeskTicketId: ticket_id,
	      phone,
	      externalId: external_id,
	      email,
	      name,
	      notes
	    });

	    const resolvedEmail = email || (result as any).email || "";
	    const resolvedPhone = phone || (result as any).phone || "";
	    const resolvedTicketId = ticket_id || (result as any).ticket_id || "";
	    const resolvedExtId = external_id || (result as any).external_id || "";
	    const resolvedName = name || (result as any).name || "";

	    // Also update local caches if task_id provided
	    if (task_id) {
	      if (resolvedPhone) await guardarPhone(task_id, resolvedPhone);
	      if (resolvedEmail) await guardarEmail(task_id, resolvedEmail);
	      if (resolvedTicketId) await guardarZendeskTicketId(task_id, resolvedTicketId);
	    }

	    res.json({
	      success: result.success,
	      user_updated: result.user_updated,
	      ticket_updated: result.ticket_updated,
	      user_id: result.user_id,
	      email: resolvedEmail,
	      phone: resolvedPhone,
	      external_id: resolvedExtId,
	      name: resolvedName,
	      ticket_id: resolvedTicketId,
	      message: result.details || "Usuario de Zendesk actualizado correctamente.",
	      details: result.details
	    });
	  } catch (err: any) {
	    console.error("Error in /api/zendesk/update-user:", err);
	    res.status(500).json({ success: false, error: err.message });
	  }
	});

	// Dedicated endpoint to synchronize client info directly from Zendesk
	app.all(["/api/zendesk/sync-client", "/zendesk/sync-client"], async (req, res) => {
	  try {
	    const params = req.method === "GET" ? req.query : req.body;
	    const { task_id, zendesk_ticket_id, external_id, phone, email, name } = params || {};

	    if (!task_id && !zendesk_ticket_id && !external_id && !phone && !email) {
	      return res.status(400).json({
	        success: false,
	        error: "Debes proporcionar al menos un identificador (task_id, zendesk_ticket_id, external_id, phone o email) para sincronizar con Zendesk."
	      });
	    }

	    const result = await syncZendeskUserAndTicket({
	      taskId: task_id,
	      zendeskTicketId: zendesk_ticket_id,
	      externalId: external_id,
	      phone,
	      email,
	      name
	    });

	    const resolvedEmail = email || (result as any).email || "";
	    const resolvedPhone = phone || (result as any).phone || "";
	    const resolvedTicketId = zendesk_ticket_id || (result as any).ticket_id || "";
	    const resolvedExtId = external_id || (result as any).external_id || "";
	    const resolvedName = name || (result as any).name || "";

	    if (task_id) {
	      if (resolvedEmail) await guardarEmail(task_id, resolvedEmail);
	      if (resolvedPhone) await guardarPhone(task_id, resolvedPhone);
	      if (resolvedTicketId) await guardarZendeskTicketId(task_id, resolvedTicketId);
	    }

	    return res.json({
	      success: result.success,
	      user_updated: result.user_updated,
	      ticket_updated: result.ticket_updated,
	      user_id: result.user_id,
	      email: resolvedEmail,
	      phone: resolvedPhone,
	      external_id: resolvedExtId,
	      name: resolvedName,
	      ticket_id: resolvedTicketId,
	      message: result.details || "Datos de Zendesk sincronizados correctamente."
	    });
	  } catch (err: any) {
	    console.error("Error in /api/zendesk/sync-client:", err);
	    return res.status(500).json({ success: false, error: err.message });
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
		const hasGroqKeys = groqKeyRotator.getKeys().length > 0;

		// Force simulated OCR fallback for all demo item IDs
		const isDemoItem = String(itemId).startsWith("fida6f93-");

		if (isDemoItem || !token || !apiBaseUrl || !hasGroqKeys) {
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

		  const tzTag = timezonesMap[t.id] || getTimezoneByPhone(phoneVal) || "EST";
		  const timezoneZone = tzOficiales[tzTag] || "America/New_York";
		  const answeredAt = answeredTimesMap[t.id] || null;

		  const clientLocalTime = new Intl.DateTimeFormat("en-US", {
			timeZone: timezoneZone,
			hour: "2-digit",
			minute: "2-digit",
			hour12: true
		  }).format(now);

		  const priorityIndex = tzOrder.indexOf(tzTag) !== -1 ? tzOrder.indexOf(tzTag) : 99;
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
		const allTasks = await fetchAllActiveTasks();
		const tasks = allTasks.filter((t: any) => {
		  if (!t.assignees || !Array.isArray(t.assignees) || t.assignees.length === 0) return false;
		  return t.assignees.some((a: any) => 
		    String(a.id) === String(ID_DONNA) || 
		    String(a.id) === "101113624" ||
		    String(a.email || "").toLowerCase().includes("donna") || 
		    String(a.username || a.name || "").toLowerCase().includes("donna")
		  );
		});
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
	
	const cachedZapierToolNames: Map<string, string> = new Map();

	async function discoverZapierMcpTool(zapierUrl: string, requestedToolName: string): Promise<string | null> {
	  try {
	    const response = await fetch(zapierUrl, {
	      method: "POST",
	      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
	      body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list" })
	    });
	    if (!response.ok) return null;
	    const text = await response.text();
	    let data: any = {};
	    if (text.includes("data:") || text.trim().startsWith("event:")) {
	      data = parseSseBody(text);
	    } else {
	      try {
	        data = JSON.parse(text);
	      } catch {
	        data = parseSseBody(text);
	      }
	    }
	    const tools: any[] = data?.result?.tools || [];
	    if (!tools || tools.length === 0) return null;
	    if (tools.some(t => t.name === requestedToolName)) return requestedToolName;
	    const candidate = tools.find(t => 
	      t.name.includes("execute") || 
	      t.name.includes("write") || 
	      t.name.includes("zapier") || 
	      t.name.includes("action")
	    );
	    if (candidate) {
	      console.log(`🔧 [Zapier Tool Discovery] "${requestedToolName}" no encontrado. Usando tool disponible en Zapier MCP: "${candidate.name}"`);
	      return candidate.name;
	    }
	    if (tools[0]?.name) {
	      console.log(`🔧 [Zapier Tool Discovery] Usando primera tool disponible en Zapier MCP: "${tools[0].name}"`);
	      return tools[0].name;
	    }
	    return null;
	  } catch (err: any) {
	    console.warn(`[discoverZapierMcpTool Error] ${err.message}`);
	    return null;
	  }
	}

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

  const activeToolName = cachedZapierToolNames.get(finalZapierUrl) || toolName;

  const payload = {
    jsonrpc: "2.0" as const,
    id: 1,
    method: "tools/call" as const,
    params: {
      name: activeToolName,
      arguments: params,
    },
  };

  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream"
  };

  console.log(`📡 Zapier MCP (callZapierMcp) → ${activeToolName}`);
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
    const isToolNotFound = body.error.code === -32602 || (msgLower.includes("tool") && msgLower.includes("not found"));
    if (isToolNotFound) {
      const prevDiscovered = cachedZapierToolNames.get(finalZapierUrl);
      cachedZapierToolNames.delete(finalZapierUrl);
      console.log(`⚠️ [Zapier MCP] Tool "${activeToolName}" no encontrada (-32602). Descubriendo herramientas en Zapier MCP...`);
      let discovered = await discoverZapierMcpTool(finalZapierUrl, activeToolName);
      if (!discovered || discovered === activeToolName || discovered === prevDiscovered) {
        const candidates = [
          "execute_zapier_write_action",
          "execute_zapier_action",
          "execute_action",
          "zapier_action",
          "execute_write_action"
        ];
        discovered = candidates.find(c => c !== activeToolName && c !== prevDiscovered) || null;
      }
      if (discovered && discovered !== prevDiscovered) {
        cachedZapierToolNames.set(finalZapierUrl, discovered);
        console.log(`🔄 Reintentando llamada Zapier MCP con tool: "${discovered}"...`);
        return callZapierMcp(finalZapierUrl, params, discovered);
      }
    }

    if (msgLower && (msgLower.includes("secret") || body.error.code === -31999)) {
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

	// Mark Responded Endpoint
	app.post("/api/mark-responded", async (req, res) => {
	  const { task_id, responded, timestamp } = req.body;

	  if (!task_id) {
	    return res.status(400).json({ error: "task_id requerido" });
	  }

	  try {
	    const filePath = path.join(process.cwd(), "src", "data", "answered_times.json");
	    let data: any = {};
	    try {
	      const content = await fsp.readFile(filePath, "utf-8");
	      data = JSON.parse(content);
	    } catch (e) {
	      data = {};
	    }

	    if (responded === false || responded === "false") {
	      // Borrar el registro (marcar como "no respondió")
	      delete data[task_id];
	    } else {
	      // Registrar timestamp de respuesta
	      data[task_id] = timestamp || new Date().toISOString();
	    }

	    await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
	    await supabaseUpsert("answered_times", data);

	    console.log(`📌 [Mark Responded] Task ${task_id} → ${responded === false ? "NO respondió" : "SÍ respondió"}`);

	    res.json({
	      status: "ok",
	      task_id,
	      responded: responded !== false && responded !== "false",
	      recorded_at: data[task_id] || null
	    });
	  } catch (err: any) {
	    console.error("[Mark Responded Error]", err);
	    res.status(500).json({ error: err.message });
	  }
	});

	// GET para consultar si respondió
	app.get("/api/check-responded/:task_id", async (req, res) => {
	  const { task_id } = req.params;
	  try {
	    const answeredTimes = await obtenerAnsweredTimes();
	    const respondedAt = answeredTimes[task_id] || null;

	    let businessDaysSinceResponse: number | null = null;
	    if (respondedAt) {
	      const responseDate = new Date(respondedAt);
	      businessDaysSinceResponse = getBusinessDaysDiff(responseDate, new Date());
	    }

	    res.json({
	      task_id,
	      responded: !!respondedAt,
	      responded_at: respondedAt,
	      business_days_since: businessDaysSinceResponse
	    });
	  } catch (err: any) {
	    res.status(500).json({ error: err.message });
	  }
	});

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
		const response = await fetch(url, { headers: { "Authorization": getClickUpApiKey() } });
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
		  const manualFiltrado = filtrarManualRelevante(query, manual);

		  const promptGlobal = `Eres Donna, la asistente ejecutiva y experta operativa de Morena Mía Beauty Group. El usuario no buscó un ticket en específico, sino que te está haciendo una consulta o platicando contigo.
				
				CONSULTA DEL USUARIO: ${query}
				
				MANUAL OPERATIVO Y BASE DE CONOCIMIENTO DE LA EMPRESA:
				${manualFiltrado || JSON.stringify(manual, null, 2)}
				
				INVENTARIO ACTUAL DE TODAS TUS TAREAS ACTIVAS:
				${resumenTareas ? resumenTareas : "No hay tareas asignadas actualmente."}
				
				INSTRUCCIONES:
				1. Actúa como una IA conversacional súper inteligente, resolutiva, amigable y profesional.
				2. Si el usuario te pregunta sobre procedimientos operativos, políticas de reembolso, Give Back (GBK), datos de contacto oficiales de servicios/partners (como Give Back: Teléfono +1 (202) 838-4850, Email care@givebackmytaxrefund.com), Shalem, envíos FedEx, o reglas de atención, responde con la información exacta de tu manual operativo.
				3. Si el usuario te pide un resumen de los estatus de tareas, cuéntale cuántas tareas tienes y en qué estatus están basándote en tu Inventario.
				4. Si hace una pregunta general o te saluda, platica con él de forma natural y cálida.
				5. Si te pregunta por *comentarios específicos* de todas las tareas a la vez, explícale amablemente que necesitas el nombre o ID de la tarea en específico para ver su historial completo.`;

		  const answer = await callGroq(promptGlobal, "Eres Donna, asistente ejecutiva y experta operativa de Morena Mía Beauty Group. Conoces a la perfección las políticas, contactos y procedimientos.", 0.4);
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
		  const resC = await fetch(`https://api.clickup.com/api/v2/task/${target.id}/comment`, { headers: { "Authorization": getClickUpApiKey() } });
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
		const detailedCf = extractDetailedCustomFields(target.custom_fields || []);
		const camposPersonalizados = detailedCf.summaryText;

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
	- 🚨 REGLA ABSOLUTA DE REDACCIÓN EN TERCERA PERSONA (REPORTE INTERNO): Tu respuesta es un INFORME / REPORTE INTERNO para el equipo administrativo. Refiérete SIEMPRE a la cliente/cliente en TERCERA PERSONA (ej. "Se intentó contactar a la cliente por correo electrónico...", "La cliente Francesca no ha respondido...", "Se le ofreció un regalo compensatorio...", "Se asignará un deadline a esta tarea..."). JAMÁS redactes el mensaje dirigiéndote a la cliente ("Dear...", "Estimada cliente...", "Te enviamos...", "we reached out to you"). Tienes ESTRICTAMENTE PROHIBIDO usar saludos o despedidas de correo dirigidos al cliente.`;

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

		// Resolution must remain blank when creating a new ticket (not resolved yet)

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

		// Save task email if any
		if (email) {
		  await guardarEmail(taskId, email.trim());
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
		  const cleanTicketId = manualZendeskId.replace(/[^\d]/g, "") || manualZendeskId;
		  console.log(`[Process Zendesk Case] Manual Zendesk Ticket ID provided: ${cleanTicketId}`);
		  zendeskResult = { id: cleanTicketId };

		  // Automatically update Zendesk user (phone, external_id / invoice, notes) for this linked ticket
		  try {
			const cleanEmail = email ? email.trim() : "";
			const cleanPhone = phone ? phone.trim() : "";
			const cleanInvoice = invoice ? String(invoice).trim() : "";
			const cleanStore = store_location || "N/A";
			const cleanRegion = region_id || "N/A";
			const cleanComment = initial_comment || "";

			let targetUserId: any = null;

			// 1. Fetch ticket from Zendesk to obtain requester_id
			try {
			  const zdTicketRes = await zendeskFetch(`/tickets/${cleanTicketId}.json`);
			  if (zdTicketRes?.ticket) {
				zendeskResult = zdTicketRes.ticket;
				if (zdTicketRes.ticket.requester_id) {
				  targetUserId = zdTicketRes.ticket.requester_id;
				  console.log(`[Process Zendesk Case] Found requester_id ${targetUserId} for linked ticket ${cleanTicketId}`);
				}
			  }
			} catch (tErr: any) {
			  console.warn(`[Process Zendesk Case] Could not fetch ticket ${cleanTicketId}:`, tErr.message);
			}

			// 2. If requester_id not found via ticket, lookup user by email
			if (!targetUserId && cleanEmail) {
			  try {
				const u = await findUserByEmail("", cleanEmail);
				if (u && u.id) {
				  targetUserId = u.id;
				  console.log(`[Process Zendesk Case] Found user ID ${targetUserId} via email ${cleanEmail}`);
				}
			  } catch (uErr: any) {
				console.warn(`[Process Zendesk Case] User search by email failed:`, uErr.message);
			  }
			}

			// 3. Update User profile in Zendesk (phone, external_id / invoice, name, notes)
			if (targetUserId) {
			  console.log(`🚀 [Process Zendesk Case] Updating Zendesk user ${targetUserId} (Phone: ${cleanPhone || "N/A"}, External ID / Invoice: ${cleanInvoice || "N/A"})...`);
			  const userUpdatePayload: any = {};
			  if (cleanPhone) userUpdatePayload.phone = cleanPhone;
			  if (cleanInvoice) userUpdatePayload.external_id = cleanInvoice;
			  if (name && name.trim()) userUpdatePayload.name = name.trim();

			  try {
				const existingUserRes = await zendeskFetch(`/users/${targetUserId}.json`).catch(() => null);
				const prevNotes = existingUserRes?.user?.notes || "";
				const newNote = `Store: ${cleanStore}\nRegion: ${cleanRegion}${cleanComment ? `\nComment: ${cleanComment}` : ""}`;
				userUpdatePayload.notes = prevNotes ? `${prevNotes}\n---\n${newNote}` : newNote;

				await zendeskFetch(`/users/${targetUserId}.json`, {
				  method: "PUT",
				  body: { user: userUpdatePayload }
				});
				console.log(`✅ [Process Zendesk Case] User ${targetUserId} updated successfully in Zendesk.`);
			  } catch (uUpdateErr: any) {
				console.warn(`⚠️ [Process Zendesk Case] Primary user update had warning, retrying with core fields:`, uUpdateErr.message);
				try {
				  const corePayload: any = {};
				  if (cleanPhone) corePayload.phone = cleanPhone;
				  if (cleanInvoice) corePayload.external_id = cleanInvoice;
				  await zendeskFetch(`/users/${targetUserId}.json`, {
					method: "PUT",
					body: { user: corePayload }
				  });
				  console.log(`✅ [Process Zendesk Case] User ${targetUserId} updated with core phone & external_id in Zendesk.`);
				} catch (coreErr: any) {
				  console.warn(`⚠️ [Process Zendesk Case] Core user update error:`, coreErr.message);
				}
			  }
			}

			// 4. Update the ticket external_id in Zendesk as well
			if (cleanInvoice) {
			  try {
				await zendeskFetch(`/tickets/${cleanTicketId}.json`, {
				  method: "PUT",
				  body: {
					ticket: {
					  external_id: cleanInvoice
					}
				  }
				});
				console.log(`✅ [Process Zendesk Case] Ticket ${cleanTicketId} updated with external_id ${cleanInvoice} in Zendesk.`);
			  } catch (ticketUpdErr: any) {
				console.warn(`[Process Zendesk Case] Could not update ticket external_id:`, ticketUpdErr.message);
			  }
			}
		  } catch (syncErr: any) {
			console.warn(`[Process Zendesk Case] Error syncing existing Zendesk ticket/user:`, syncErr.message);
		  }
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
				existingTicket = await findTicketByInvoice("", String(invoice));
			  } catch (findErr: any) {
				console.log("[Process Zendesk Case] Error searching for existing ticket:", findErr.message);
			  }
			}

			if (existingTicket) {
			  console.log(`[Process Zendesk Case] El ticket de Zendesk para el invoice ${invoice} ya existe: ID ${existingTicket.id}. No crearemos duplicado.`);
			  zendeskResult = existingTicket;

			  // Update existing ticket user with phone, external_id / invoice
			  try {
				let targetUid = existingTicket.requester_id;
				if (!targetUid && cleanEmail) {
				  const u = await findUserByEmail("", cleanEmail);
				  if (u && u.id) targetUid = u.id;
				}
				if (targetUid && (cleanPhone || invoice)) {
				  const uPayload: any = {};
				  if (cleanPhone) uPayload.phone = cleanPhone;
				  if (invoice) uPayload.external_id = String(invoice).trim();
				  if (name && name.trim()) uPayload.name = name.trim();
				  await zendeskFetch(`/users/${targetUid}.json`, {
					method: "PUT",
					body: { user: uPayload }
				  });
				  console.log(`✅ [Process Zendesk Case] Existing ticket user ${targetUid} updated with phone and external_id.`);
				}
			  } catch (exErr: any) {
				console.warn(`[Process Zendesk Case] Warning updating existing ticket user:`, exErr.message);
			  }
			} else {
			  let existingUser: any = null;
			  try {
				existingUser = await findUserByEmail("", cleanEmail);
				if (existingUser) {
				  console.log(`[Process Zendesk Case] Found existing user with ID: ${existingUser.id}`);
				}
			  } catch (err: any) {
				console.log("[Process Zendesk Case] Search for existing user failed:", err.message);
			  }

			  if (existingUser && existingUser.id) {
			    try {
			      await zendeskFetch(`/users/${existingUser.id}.json`, {
			        method: "PUT",
			        body: {
			          user: {
			            phone: cleanPhone,
			            external_id: String(invoice),
			            notes: `Store: ${cleanStore}\nRegion: ${cleanRegion}\nComment: ${cleanComment}`
			          }
			        }
			      });
			      console.log(`[Process Zendesk Case] User ${existingUser.id} updated successfully.`);
			    } catch (uErr: any) {
			      console.warn("Failed updating Zendesk user:", uErr.message);
			    }
			  }

			  const computedSubject = `Invoice #${invoice} - ${cleanStore} - ${cleanRegion} - PURCHASE FOLLOW-UP`;
			  const ASSIGNEE_ID = 50176296447379;

			  const ticketPayload: any = {
				ticket: {
				  subject: computedSubject,
				  comment: {
					body: `Caso para el cliente ${name} (${cleanEmail}).\nSucursal: ${cleanStore}\nRegión: ${cleanRegion}\nComentario inicial: ${cleanComment}`,
					public: false
				  },
				  external_id: String(invoice),
				  status: "new",
				  priority: "normal",
				  assignee_id: ASSIGNEE_ID
				}
			  };

			  if (existingUser && existingUser.id) {
				ticketPayload.ticket.requester_id = existingUser.id;
			  } else {
				ticketPayload.ticket.requester = {
				  name: name || cleanEmail.split("@")[0],
				  email: cleanEmail,
				  time_zone: timezone || "America/New_York"
				};
			  }

			  console.log(`🚀 [Zendesk Direct API] Creando ticket en Zendesk...`);
			  try {
			    const directTicket = await zendeskFetch(`/tickets.json`, {
			      method: "POST",
			      body: ticketPayload
			    });
			    if (directTicket?.ticket) {
			      zendeskResult = directTicket.ticket;
			      console.log("✅ Zendesk Ticket creado exitosamente vía API directa:", zendeskResult);
			    }
			  } catch (dErr: any) {
			    console.warn("⚠️ Falló creación directa de ticket en Zendesk:", dErr.message);
			  }
			}
		  } catch (zErr: any) {
			console.log("ℹ️ Zendesk auto-creation skipped or unconfigured:", zErr.message);
		  }
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
			if (zdId && zdId !== "0" && zdId.trim() !== "") {
			  await guardarZendeskTicketId(taskId, zdId);
			  console.log(`✅ Automatically stored Zendesk Ticket ID ${zdId} for ClickUp task ${taskId}`);
			  
			  try {
				console.log(`[Process Zendesk Case] Pushing translated initial comment to Zendesk ticket ${zdId}...`);
				await addNoteByTicketIdRaw("", zdId, translated);
				console.log(`[Process Zendesk Case] Translated initial comment pushed to Zendesk successfully.`);
			  } catch (noteErr: any) {
				console.error(`[Process Zendesk Case] Error pushing translated comment to Zendesk:`, noteErr.message);
			  }
			}
		  } catch (err: any) {
			console.warn("Warning storing zendesk ticket id or adding internal note:", err.message);
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
	// Endpoint: Crear Ticket en Zendesk Direct API
	// ---------------------------------------------------------------------------
	app.post("/api/zendesk/create-ticket", async (req, res) => {
	  const { nombre, email, telefono, invoice, comentario, store_location } = req.body;

	  if (!nombre || !email || !invoice) {
		return res.status(400).json({ 
		  success: false, 
		  error: "Faltan datos obligatorios: nombre, email o invoice." 
		});
	  }

	  try {
		console.log(`🚀 Enviando petición de Ticket a Zendesk Direct API para Invoice: ${invoice}`);

		let existingUser = null;
		try {
		  existingUser = await findUserByEmail("", email);
		} catch (err: any) {
		  console.log("Search for existing user failed:", err.message);
		}

		const cleanStore = store_location || "N/A";
		const cleanRegion = "N/A";
		const cleanComment = comentario || "";

		const computedSubject = `Invoice #${invoice} - ${cleanStore} - ${cleanRegion} - PURCHASE FOLLOW-UP`;
		const ASSIGNEE_ID = 50176296447379;

		const ticketPayload: any = {
		  ticket: {
			subject: computedSubject,
			comment: {
			  body: `Caso para el cliente ${nombre} (${email}).\nSucursal: ${cleanStore}\nRegión: ${cleanRegion}\nComentario inicial: ${cleanComment}`,
			  public: false
			},
			external_id: String(invoice),
			status: "new",
			priority: "normal",
			assignee_id: ASSIGNEE_ID
		  }
		};

		const finalRequesterId = existingUser && existingUser.id ? existingUser.id : null;

		if (finalRequesterId) {
		  ticketPayload.ticket.requester_id = finalRequesterId;
		} else {
		  ticketPayload.ticket.requester = {
			name: nombre,
			email: email,
			time_zone: "America/New_York"
		  };
		}

		const result = await zendeskFetch("/tickets.json", {
		  method: "POST",
		  body: ticketPayload
		});
		
		console.log("✅ Ticket creado en Zendesk exitosamente:", result);

		res.json({
		  success: true,
		  message: `Ticket creado exitosamente para el Invoice ${invoice}`,
		  zendesk_response: result?.ticket || result
		});

	  } catch (error: any) {
		console.error("ℹ️ Error al crear el ticket en Zendesk Direct API:", error.message);
		
		res.status(500).json({ 
		  success: false, 
		  error: "Error al procesar el ticket en Zendesk.",
		  details: error.message 
		});
	  }
	});



	// Log and Push Comment
	app.post("/api/log-and-push", async (req, res) => {
	  const startTime = Date.now();
	  const { task_id, spanish_comment, zapier_token, zendesk_ticket_id, is_no_answer_machine } = req.body;

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

		const isLogNuevo = !is_no_answer_machine;
		// Record answer time unless explicitly marked as no_answer_machine
		if (!is_no_answer_machine) {
		  await guardarAnsweredTime(task_id, new Date().toISOString());
		}

		const triggersCierre = [
		  "cerraremos esta tarea", "cerraremos este ticket", "ticket cerrado", 
		  "cerrar ticket", "cerrar tarea", "cerramos la tarea",
		  "se cerrara esta tarea", "se cierra esta tarea",
		  "cerrar esta tarea", "cerrar este caso", "cerrar el caso", "cerrar el ticket", "cerrar la tarea",
		  "procederemos a cerrar esta tarea", "procederemos a cerrar el caso", "procederemos a cerrar la tarea", "procederemos a cerrar este ticket", "procederemos a cerrar",
		  "proceder a cerrar esta tarea", "proceder a cerrar la tarea", "proceder a cerrar el ticket", "proceder a cerrar",
		  "procedo a cerrar esta tarea", "procedo a cerrar la tarea", "procedo a cerrar el ticket", "procedo a cerrar el caso", "procedo a cerrar",
		  "daremos por cerrada la tarea", "daremos por cerrado el caso", "daremos por cerrado el ticket", "daremos por cerrado", "daremos por resuelto",
		  "dar por cerrada la tarea", "dar por cerrado el caso", "dar por cerrado el ticket", "dar por cerrado", "dar por resuelto",
		  "damos por cerrada", "damos por cerrado", "damos por resuelto", "damos por finalizado",
		  "se da por cerrado", "se da por resuelto", "se da por finalizado", "se da por cerrada",
		  "caso cerrado", "caso resuelto", "tarea cerrada", "tarea resuelta", "caso solucionado", "ticket solucionado", "tarea solucionada",
		  "cerramos este caso", "cerramos esta tarea", "cerramos este ticket",
		  "finalizar tarea", "finalizar ticket", "finalizar caso", "finalizar el ticket", "finalizar la tarea",
		  "marcar como resuelto", "marcar como cerrado", "marcar como solucionado", "marcar ticket como resuelto",
		  "se resuelve el ticket", "se resuelve la tarea", "se resuelve el caso",
		  "solucionado y cerrado", "resuelto y cerrado",
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

		// Check if translated English output explicitly contains close triggers
		const commentTextLower = normalizeText(commentText);
		const esCierreEnTraduccion = triggersCierre.some(t => commentTextLower.includes(normalizeText(t)));
		const finalEsCierre = esCierre || esCierreEnTraduccion;

		if (finalEsCierre) {
		  detectedStatus = "Closed";
		} else if (detectIsDeadline(comentarioCorregido) || detectIsDeadline(commentText)) {
		  detectedStatus = "deadline";
		}

		if (finalEsCierre) {
		  let autoResolutionId = determineResolution("", comentarioCorregido) || determineResolution("", commentText);
		  if (!autoResolutionId) {
			// Default resolution for closed tasks without specific resolution
			if (commentTextLower.includes("dispute") || commentTextLower.includes("chargeback") || msgLower.includes("disputa")) {
			  autoResolutionId = "a148c4e2-b2f3-4b6d-9cf6-6eb8255c6099"; // DISPUTE
			} else if (commentTextLower.includes("deadline") || commentTextLower.includes("not replied") || commentTextLower.includes("did not respond") || msgLower.includes("no respondio")) {
			  autoResolutionId = "49bb94ed-70b8-4d8f-80ae-8b4f8ab9b04e"; // LOST LEAD
			} else {
			  autoResolutionId = "550d1479-412d-45f9-b7da-64cd69473af1"; // RESOLVED
			}
		  }

		  if (autoResolutionId) {
			console.log(`🎯 [Resolution Auto-Detect on Closure] Updating Resolution field 55638270-b614-4783-ad1c-0bd994d6484b to ${autoResolutionId} for task ${task_id}`);
			const cfUrl = `https://api.clickup.com/api/v2/task/${task_id}/field/55638270-b614-4783-ad1c-0bd994d6484b`;
			await fetch(cfUrl, {
			  method: "POST",
			  headers: await getClickupHeaders(),
			  body: JSON.stringify({ value: autoResolutionId })
			}).catch(e => console.error("Error setting resolution field on closure:", e));
		  }
		}

		if (finalEsCierre && !commentText.includes("🔒 CLOSURE NOTE")) {
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
			  const taskRes = await fetch(`https://api.clickup.com/api/v2/task/${task_id}`, { headers: { "Authorization": getClickUpApiKey() } });
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
			await guardarZendeskTicketId(task_id, targetTicketId);
			const isCierre = esCierre || detectedStatus === "Closed";
			console.log(`📍 Found associated Zendesk Ticket ID ${targetTicketId} for ClickUp task ${task_id}. Pushing internal comment (isCierre: ${isCierre})...`);
			
			const noteResult = await addNoteByTicketIdRaw("", targetTicketId, commentText, isCierre);
			zendeskStatus = "success";
			zendeskMessage = isCierre 
			  ? `Nota de cierre agregada y ticket cambiado a "Solved" en Zendesk (${noteResult.ticket_found}).`
			  : `Nota interna agregada correctamente al ticket "${noteResult.ticket_found}".`;
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
	  const { task_id, timestamp, zendesk_ticket_id } = req.body;
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

		// Format client local time
		const clientDateTimeStr = new Intl.DateTimeFormat("en-US", {
		  timeZone: timezoneZone,
		  year: "numeric",
		  month: "2-digit",
		  day: "2-digit",
		  hour: "2-digit",
		  minute: "2-digit",
		  hour12: true
		}).format(targetDate);

		// Update due_date in ClickUp (including exact time flag, without posting comments to ClickUp)
		const cfRes = await fetch(`https://api.clickup.com/api/v2/task/${task_id}`, {
		  method: "PUT",
		  headers: {
			"Authorization": getClickUpApiKey(),
			"Content-Type": "application/json"
		  },
		  body: JSON.stringify({
			due_date: dueMs,
			due_date_time: true
		  })
		});

		if (!cfRes.ok) {
		  console.error(`Error updating ClickUp due_date: ${cfRes.statusText}`);
		}

		// Comment for Zendesk
		const zendeskComment = `📞 SCHEDULED CALL: Follow-up scheduled for ${clientDateTimeStr} (${tzTag}).`;

		// Sincronizar con Zendesk si es posible
		let zendeskStatus = "none";
		let zendeskMessage = "";
		try {
		  const zendeskMap = await obtenerZendeskTicketIds();
		  let rawTicketId = (zendesk_ticket_id || zendeskMap[task_id] || "").toString().trim();
		  
		  if (!rawTicketId || ["none", "null", "undefined", "n/a", "sin ticket"].includes(rawTicketId.toLowerCase())) {
			const taskRes = await fetch(`https://api.clickup.com/api/v2/task/${task_id}`, { headers: { "Authorization": getClickUpApiKey() } });
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
			await guardarZendeskTicketId(task_id, rawTicketId);
			const noteResult = await addNoteByTicketIdRaw("", rawTicketId, zendeskComment);
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
	  const { task_id, spanish_comment, resolution_id, ticket_number } = req.body;

	  try {
		const rawComment = (spanish_comment || "").trim();
		let translated = rawComment || "Case resolved and completed.";

		if (rawComment) {
		  try {
			const promptIa = `Translate the following Spanish text exactly and professionally to English. Do not add any conversational filler or change the tone. Just translate: ${rawComment}`;
			const aiTranslation = await callGroq(promptIa, "You are a professional corporate translator. Provide only the direct English translation.");
			if (aiTranslation && aiTranslation.trim().length > 0) {
			  translated = aiTranslation.trim();
			}
		  } catch (transErr: any) {
			console.warn("⚠️ [Close Task] Error translating comment with AI, using original text:", transErr.message);
		  }
		}

		let rearrangedName = "";
		let customerName = "CUSTOMER";
		let storeName = "STORE NAME";

		try {
		  const taskRes = await fetch(`https://api.clickup.com/api/v2/task/${task_id}`, { headers: { "Authorization": getClickUpApiKey() } });
		  if (taskRes.ok) {
			const taskData = await taskRes.json() as any;
			const origName = taskData.name || "";
			const finalTicketNum = (ticket_number || "").trim();
			
			let clientNameRaw = "";
			if (origName.includes("-")) {
			  const parts = origName.split("-");
			  const firstPart = parts[0].trim();
			  const restOfParts = parts.slice(1).join("-").trim();
			  
			  if (finalTicketNum && firstPart.toLowerCase().includes(finalTicketNum.toLowerCase())) {
				clientNameRaw = restOfParts;
			  } else {
				clientNameRaw = restOfParts || firstPart;
			  }
			} else {
			  clientNameRaw = origName;
			  if (finalTicketNum) {
				const regex = new RegExp(`\\b${finalTicketNum}\\b`, "gi");
				clientNameRaw = clientNameRaw.replace(regex, "");
			  }
			}
			
			clientNameRaw = clientNameRaw
			  .replace(/\[.*?\]/g, "")
			  .replace(/#\d+/g, "")
			  .replace(/^[\s\-_#]+|[\s\-_#]+$/g, "")
			  .trim();

			if (clientNameRaw) {
			  customerName = clientNameRaw;
			} else if (origName) {
			  customerName = origName;
			}
			
			const displayTicket = finalTicketNum || "TICKET";
			rearrangedName = `${customerName} - #${displayTicket} [RESOLVED]`.toUpperCase();

			// Extract Store / Location from ClickUp Custom Fields if available
			if (Array.isArray(taskData.custom_fields)) {
			  for (const field of taskData.custom_fields) {
				const fName = (field.name || "").toLowerCase();
				if (fName.includes("store") || fName.includes("location") || fName.includes("tienda") || fName.includes("sucursal")) {
				  if (field.value !== undefined && field.value !== null) {
					if (typeof field.value === "string" && field.value.trim()) {
					  storeName = field.value.trim();
					} else if (typeof field.value === "number" && field.type_config?.options) {
					  const opt = field.type_config.options.find((o: any) => o.orderindex === field.value || o.id === field.value);
					  if (opt?.name) storeName = opt.name;
					} else if (typeof field.value === "object") {
					  if (field.value.name) storeName = field.value.name;
					  else if (Array.isArray(field.value) && field.value[0]?.name) storeName = field.value[0].name;
					}
				  }
				}
			  }
			}
		  }
		} catch (nameErr) {
		  console.error("Error fetching task for details:", nameErr);
		}

		if (storeName === "STORE NAME") {
		  storeName = "VIP Cosmetics";
		}

		// 1. ClickUp receives the team closure note
		try {
		  await fetch(`https://api.clickup.com/api/v2/task/${task_id}/comment`, {
			method: "POST",
			headers: await getClickupHeaders(),
			body: JSON.stringify({ comment_text: `CLOSURE NOTE: ${translated}` })
		  });
		} catch (cErr: any) {
		  console.warn("⚠️ [Close Task] Could not add closure comment to ClickUp:", cErr.message);
		}

		// Update Status and Title in ClickUp
		const updatePayload: any = { 
		  status: "Closed" 
		};
		if (rearrangedName) {
		  updatePayload.name = rearrangedName;
		}

		await fetch(`https://api.clickup.com/api/v2/task/${task_id}`, {
		  method: "PUT",
		  headers: await getClickupHeaders(),
		  body: JSON.stringify(updatePayload)
		}).catch(e => console.error("Error closing task in ClickUp:", e));

		// Update Resolution Custom Field in ClickUp
		let targetResolutionId = resolution_id;
		if (!targetResolutionId) {
		  targetResolutionId = determineResolution("", rawComment) || determineResolution("", translated);
		}

		const resolutionUuidMap: Record<string, string> = {
		  "REFUND": "e9367f41-cb3b-42f0-b612-6528d02098dc",
		  "GIFT": "94dad466-99f5-4f62-b6a1-f7d0a567ffae",
		  "DISPUTE": "a148c4e2-b2f3-4b6d-9cf6-6eb8255c6099",
		  "LOST LEAD": "49bb94ed-70b8-4d8f-80ae-8b4f8ab9b04e",
		  "LOST_LEAD": "49bb94ed-70b8-4d8f-80ae-8b4f8ab9b04e",
		  "P+R": "cdc84079-b6a3-4665-9161-97d8d7bac5eb",
		  "RESOLVED": "550d1479-412d-45f9-b7da-64cd69473af1"
		};

		let mappedUuid = targetResolutionId;
		if (targetResolutionId) {
		  for (const [key, uuid] of Object.entries(resolutionUuidMap)) {
			if (targetResolutionId.toUpperCase().includes(key)) {
			  mappedUuid = uuid;
			  break;
			}
		  }
		}

		if (mappedUuid) {
		  const cfId = "55638270-b614-4783-ad1c-0bd994d6484b";
		  await fetch(`https://api.clickup.com/api/v2/task/${task_id}/field/${cfId}`, {
			method: "POST",
			headers: await getClickupHeaders(),
			body: JSON.stringify({ value: mappedUuid })
		  }).catch(e => console.error("Error setting resolution field on close:", e));
		}

		// 2. Build customer message for Zendesk
		const publicCustomerMessage = `Dear ${customerName},

Per our previous email, this ticket will be closed since we did not receive a response to your last inquiry regarding your purchase at ${storeName}.

If you need further assistance, please reply to this email or call our toll-free number +1 888 249 4189.
We appreciate your understanding and preference.`;

		let zendeskStatus = "no_attempted";
		let zendeskMessage = "No se proporcionó número de ticket de Zendesk.";

		try {
		  const zendeskMap = await obtenerZendeskTicketIds();
		  let rawTicketId = (ticket_number || zendeskMap[task_id] || "").toString().trim();

		  if (!rawTicketId || ["none", "null", "undefined", "n/a", "sin ticket"].includes(rawTicketId.toLowerCase())) {
			try {
			  console.log(`🔍 Intentando auto-detectar ID de Ticket Zendesk desde el nombre de ClickUp para la tarea ${task_id}`);
			  const taskRes = await fetch(`https://api.clickup.com/api/v2/task/${task_id}`, { headers: { "Authorization": getClickUpApiKey() } });
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
				}
			  }
			} catch (parseErr: any) {
			  console.warn("ℹ️ No se pudo parsear el ID del ticket desde el nombre de ClickUp:", parseErr.message);
			}
		  }

		  const cleanTicketNum = rawTicketId.replace(/\D/g, "");

		  if (cleanTicketNum) {
			await guardarZendeskTicketId(task_id, cleanTicketNum);
			console.log(`🚀 [Zendesk Direct API] Procesando cierre del ticket #${cleanTicketNum} a "solved"...`);
			
			const isLostLead = targetResolutionId && targetResolutionId.toUpperCase().includes("LOST");
			if (isLostLead) {
			  // Send public message to customer in Zendesk and solve ticket
			  await addNoteByTicketIdRaw("", cleanTicketNum, publicCustomerMessage, true, true);
			} else {
			  // Internal note solving ticket
			  await addNoteByTicketIdRaw("", cleanTicketNum, `CLOSURE NOTE: ${translated}`, true, false);
			}

			zendeskStatus = "success";
			zendeskMessage = `Ticket #${cleanTicketNum} resuelto (Solved) en Zendesk.`;
		  }
		} catch (zErr: any) {
		  if (zErr.message && zErr.message.includes("closed prevents ticket update")) {
			console.log(`ℹ️ El ticket ya está resuelto/cerrado en Zendesk.`);
			zendeskStatus = "success";
			zendeskMessage = `El ticket ya se encontraba cerrado en Zendesk.`;
		  } else {
			zendeskStatus = "failed";
			zendeskMessage = `Error al actualizar Zendesk: ${zErr.message}`;
			console.log("ℹ️ Zendesk auto-closure note:", zErr.message);
		  }
		}

		res.json({ 
		  status: "Updated", 
		  rearranged_name: rearrangedName,
		  zendesk_status: zendeskStatus,
		  zendesk_message: zendeskMessage
		});
	  } catch (err: any) {
		console.error("Error in /api/close-task:", err);
		res.status(500).json({ error: err.message });
	  }
	});

	// Official Resolution Mapping for ClickUp Custom Field 55638270-b614-4783-ad1c-0bd994d6484b
	const KARLA_RESOLUTION_MAP: Record<string, { id: string; name: string }> = {
	  "REFUND": { id: "e9367f41-cb3b-42f0-b612-6528d02098dc", name: "REFUND" },
	  "REEMBOLSO": { id: "e9367f41-cb3b-42f0-b612-6528d02098dc", name: "REFUND" },
	  "GIFT": { id: "94dad466-99f5-4f62-b6a1-f7d0a567ffae", name: "GIFT" },
	  "REGALO": { id: "94dad466-99f5-4f62-b6a1-f7d0a567ffae", name: "GIFT" },
	  "DISPUTE": { id: "a148c4e2-b2f3-4b6d-9cf6-6eb8255c6099", name: "DISPUTE" },
	  "DISPUTA": { id: "a148c4e2-b2f3-4b6d-9cf6-6eb8255c6099", name: "DISPUTE" },
	  "CHARGEBACK": { id: "a148c4e2-b2f3-4b6d-9cf6-6eb8255c6099", name: "DISPUTE" },
	  "CONTRACARGO": { id: "a148c4e2-b2f3-4b6d-9cf6-6eb8255c6099", name: "DISPUTE" },
	  "LOST LEAD": { id: "49bb94ed-70b8-4d8f-80ae-8b4f8ab9b04e", name: "LOST LEAD" },
	  "LOST_LEAD": { id: "49bb94ed-70b8-4d8f-80ae-8b4f8ab9b04e", name: "LOST LEAD" },
	  "LOSTLEAD": { id: "49bb94ed-70b8-4d8f-80ae-8b4f8ab9b04e", name: "LOST LEAD" },
	  "CLIENTE PERDIDO": { id: "49bb94ed-70b8-4d8f-80ae-8b4f8ab9b04e", name: "LOST LEAD" },
	  "P+R": { id: "cdc84079-b6a3-4665-9161-97d8d7bac5eb", name: "P+R" },
	  "P + R": { id: "cdc84079-b6a3-4665-9161-97d8d7bac5eb", name: "P+R" },
	  "P&R": { id: "cdc84079-b6a3-4665-9161-97d8d7bac5eb", name: "P+R" },
	  "PRODUCT + REFUND": { id: "cdc84079-b6a3-4665-9161-97d8d7bac5eb", name: "P+R" },
	  "PRODUCT AND REFUND": { id: "cdc84079-b6a3-4665-9161-97d8d7bac5eb", name: "P+R" },
	  "PRODUCT & REFUND": { id: "cdc84079-b6a3-4665-9161-97d8d7bac5eb", name: "P+R" },
	  "RESOLVED": { id: "550d1479-412d-45f9-b7da-64cd69473af1", name: "RESOLVED" },
	  "SOLUCIONADO": { id: "550d1479-412d-45f9-b7da-64cd69473af1", name: "RESOLVED" },
	  "RESUELTO": { id: "550d1479-412d-45f9-b7da-64cd69473af1", name: "RESOLVED" }
	};

	function matchTargetResolution(text: string): { id: string; name: string } | null {
	  if (!text) return null;
	  const norm = text.toLowerCase().trim();
	  
	  if (detectIsProductAndRefund(norm)) {
	    return KARLA_RESOLUTION_MAP["P+R"];
	  }
	  if (norm.includes("refund") || norm.includes("reembolso")) {
	    return KARLA_RESOLUTION_MAP["REFUND"];
	  }
	  if (norm.includes("gift") || norm.includes("regalo")) {
	    return KARLA_RESOLUTION_MAP["GIFT"];
	  }
	  if (norm.includes("dispute") || norm.includes("disputa") || norm.includes("chargeback") || norm.includes("contracargo")) {
	    return KARLA_RESOLUTION_MAP["DISPUTE"];
	  }
	  if (norm.includes("lost lead") || norm.includes("lost_lead") || norm.includes("lostlead") || norm.includes("cliente perdido")) {
	    return KARLA_RESOLUTION_MAP["LOST LEAD"];
	  }
	  if (norm.includes("resolved") || norm.includes("solucionado") || norm.includes("resuelto")) {
	    return KARLA_RESOLUTION_MAP["RESOLVED"];
	  }
	  return null;
	}

	function detectKarlaResolutionRequest(commentText: string, authorName: string = "", userEmail: string = ""): {
	  isFromKarla: boolean;
	  resolutionName: string;
	  resolutionUuid: string;
	  originalText: string;
	} | null {
	  if (!commentText || typeof commentText !== "string") return null;
	  const norm = commentText.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
	  const authorNorm = (authorName || "").toLowerCase();
	  const emailNorm = (userEmail || "").toLowerCase();
	  const isFromKarla = authorNorm.includes("karla") || emailNorm.includes("karla") || norm.includes("karla:");

	  // Explicit patterns specifically demanding to change or set the RESOLUTION field
	  const triggerPatterns = [
	    /(?:please\s+)?(?:change|fix|update|set|switch)\s+(?:the\s+)?resolution\s+(?:to|for|as)?\s*([^\n\.,]+)/i,
	    /(?:the\s+)?resolution\s+(?:is|should\s+be|to)\s*([^\n\.,]+)/i,
	    /(?:favor\s+de\s+|por\s+favor\s+)?(?:cambiar|corregir|poner|actualizar)\s+(?:la\s+)?resoluci[oó]n\s+(?:a|por|como)?\s*([^\n\.,]+)/i,
	    /resoluci[oó]n\s+(?:debe\s+ser|es|a)\s*([^\n\.,]+)/i,
	    /resolution:\s*([^\n\.,]+)/i,
	    /resoluci[oó]n:\s*([^\n\.,]+)/i
	  ];

	  let detectedResolution: { id: string; name: string } | null = null;

	  for (const pat of triggerPatterns) {
	    const m = commentText.match(pat);
	    if (m && m[1]) {
	      const matched = matchTargetResolution(m[1]);
	      if (matched) {
	        detectedResolution = matched;
	        break;
	      }
	    }
	  }

	  if (detectedResolution) {
	    return {
	      isFromKarla,
	      resolutionName: detectedResolution.name,
	      resolutionUuid: detectedResolution.id,
	      originalText: commentText.trim()
	    };
	  }

	  return null;
	}

	async function applyKarlaResolutionIfDetected(
	  taskId: string, 
	  comments: any[], 
	  currentResolutionId?: string,
	  autoApply: boolean = false
	): Promise<{
	  detected: boolean;
	  applied: boolean;
	  resolutionName: string;
	  resolutionUuid: string;
	  commentText: string;
	  author: string;
	} | null> {
	  if (!taskId || !Array.isArray(comments) || comments.length === 0) return null;

	  // Scan comments starting with the latest
	  const sortedComments = [...comments].reverse();

	  for (const c of sortedComments) {
	    const cText = typeof c === "string" ? c : (c.comment_text || c.text || c.text_content || "");
	    const authorName = typeof c === "object" ? (c.user?.username || c.user?.name || "") : "";
	    const authorEmail = typeof c === "object" ? (c.user?.email || "") : "";

	    const match = detectKarlaResolutionRequest(cText, authorName, authorEmail);
	    if (match) {
	      const targetUuid = match.resolutionUuid;
	      const cfId = "55638270-b614-4783-ad1c-0bd994d6484b";
	      const isAlreadySet = (currentResolutionId || "").trim().toLowerCase() === targetUuid.toLowerCase();

	      // Only mutate ClickUp if autoApply is EXPLICITLY true (never during GET task details!)
	      if (autoApply && !isAlreadySet) {
	        try {
	          console.log(`⚡ [Karla Trigger Auto-Apply] Detected instruction in comments for task ${taskId}: "${match.originalText}". Updating Resolution to ${match.resolutionName} (${targetUuid})...`);
	          const cfUrl = `https://api.clickup.com/api/v2/task/${taskId}/field/${cfId}`;
	          const resp = await fetch(cfUrl, {
	            method: "POST",
	            headers: await getClickupHeaders(),
	            body: JSON.stringify({ value: targetUuid })
	          });
	          if (resp.ok) {
	            console.log(`✅ [Karla Trigger] Successfully auto-updated task ${taskId} resolution to ${match.resolutionName}`);
	            return {
	              detected: true,
	              applied: true,
	              resolutionName: match.resolutionName,
	              resolutionUuid: targetUuid,
	              commentText: match.originalText,
	              author: authorName || (match.isFromKarla ? "Karla" : "Supervisor")
	            };
	          } else {
	            const errTxt = await resp.text();
	            console.warn(`⚠️ [Karla Trigger] ClickUp API error updating resolution: ${errTxt}`);
	          }
	        } catch (err: any) {
	          console.error(`⚠️ [Karla Trigger] Exception updating resolution: ${err.message}`);
	        }
	      }

	      return {
	        detected: true,
	        applied: false,
	        resolutionName: match.resolutionName,
	        resolutionUuid: targetUuid,
	        commentText: match.originalText,
	        author: authorName || (match.isFromKarla ? "Karla" : "Supervisor")
	      };
	    }
	  }

	  return null;
	}

	// Update Resolution Custom Field in ClickUp directly
	app.post("/api/update-resolution", async (req, res) => {
	  const { task_id, resolution_id, custom_field_id } = req.body;
	  if (!task_id || !resolution_id) {
	    return res.status(400).json({ error: "Faltan parámetros: task_id y resolution_id" });
	  }

	  const cfId = custom_field_id || "55638270-b614-4783-ad1c-0bd994d6484b";

	  const resolutionUuidMap: Record<string, string> = {
	    "REFUND": "e9367f41-cb3b-42f0-b612-6528d02098dc",
	    "GIFT": "94dad466-99f5-4f62-b6a1-f7d0a567ffae",
	    "DISPUTE": "a148c4e2-b2f3-4b6d-9cf6-6eb8255c6099",
	    "LOST LEAD": "49bb94ed-70b8-4d8f-80ae-8b4f8ab9b04e",
	    "LOST_LEAD": "49bb94ed-70b8-4d8f-80ae-8b4f8ab9b04e",
	    "P+R": "cdc84079-b6a3-4665-9161-97d8d7bac5eb",
	    "RESOLVED": "550d1479-412d-45f9-b7da-64cd69473af1"
	  };

	  let targetUuid = resolution_id;
	  for (const [key, uuid] of Object.entries(resolutionUuidMap)) {
	    if (resolution_id.toUpperCase().includes(key)) {
	      targetUuid = uuid;
	      break;
	    }
	  }

	  try {
	    console.log(`🎯 [Update Resolution Endpoint] Updating task ${task_id} custom field ${cfId} to value ${targetUuid}`);
	    const cfUrl = `https://api.clickup.com/api/v2/task/${task_id}/field/${cfId}`;
	    const response = await fetch(cfUrl, {
	      method: "POST",
	      headers: await getClickupHeaders(),
	      body: JSON.stringify({ value: targetUuid })
	    });

	    if (!response.ok) {
	      const errTxt = await response.text();
	      console.error(`[Update Resolution Error] ClickUp API ${response.status}: ${errTxt}`);
	      return res.status(response.status).json({ error: `ClickUp API error: ${errTxt}` });
	    }

	    res.json({
	      success: true,
	      message: `Campo de resolución actualizado exitosamente en ClickUp.`,
	      task_id,
	      resolution_id: targetUuid,
	      custom_field_id: cfId
	    });
	  } catch (err: any) {
	    console.error("[Update Resolution Server Error]", err);
	    res.status(500).json({ error: err.message });
	  }
	});

	// Trigger & Check Karla's resolution comments for a specific task
	app.post("/api/check-karla-resolution", async (req, res) => {
	  const { task_id, comment_text, author } = req.body;
	  if (!task_id) {
	    return res.status(400).json({ error: "task_id es requerido" });
	  }

	  try {
	    let commentsList: any[] = [];
	    if (comment_text) {
	      commentsList = [{ comment_text, user: { username: author || "Karla" } }];
	    } else {
	      const commentsRes = await fetch(`https://api.clickup.com/api/v2/task/${task_id}/comment`, { headers: { "Authorization": getClickUpApiKey() } });
	      if (commentsRes.ok) {
	        const cData = await commentsRes.json() as any;
	        commentsList = cData.comments || [];
	      }
	    }

	    const result = await applyKarlaResolutionIfDetected(task_id, commentsList);
	    res.json({
	      success: true,
	      task_id,
	      karla_trigger: result
	    });
	  } catch (err: any) {
	    console.error("Error in /api/check-karla-resolution:", err);
	    res.status(500).json({ error: err.message });
	  }
	});

	// ClickUp Webhook endpoint for task comments (Trigger automático en tiempo real)
	app.post(["/api/webhook/clickup", "/api/webhook/clickup-comment", "/api/clickup/webhook"], async (req, res) => {
	  try {
	    const payload = req.body || {};
	    console.log("📥 [ClickUp Webhook Received]:", JSON.stringify(payload).substring(0, 300));

	    const taskId = payload.task_id || payload.taskId || (payload.history_items?.[0]?.parent_id);
	    let commentObj = payload.comment || payload.history_items?.[0]?.comment;
	    let commentText = "";
	    let authorName = "";

	    if (commentObj) {
	      commentText = commentObj.comment_text || commentObj.text_content || commentObj.text || "";
	      authorName = commentObj.user?.username || commentObj.user?.name || "";
	    } else if (payload.history_items && payload.history_items.length > 0) {
	      const item = payload.history_items[0];
	      commentText = item.after || item.comment?.comment_text || "";
	      authorName = item.user?.username || "";
	    }

	    if (taskId) {
	      let commentsToCheck: any[] = [];
	      if (commentText) {
	        commentsToCheck = [{ comment_text: commentText, user: { username: authorName } }];
	      } else {
	        const commentsRes = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/comment`, { headers: { "Authorization": getClickUpApiKey() } });
	        if (commentsRes.ok) {
	          const cData = await commentsRes.json() as any;
	          commentsToCheck = cData.comments || [];
	        }
	      }

	      const triggerResult = await applyKarlaResolutionIfDetected(taskId, commentsToCheck);
	      return res.json({
	        status: "ok",
	        message: "Webhook procesado",
	        task_id: taskId,
	        trigger_applied: triggerResult
	      });
	    }

	    res.json({ status: "ok", message: "Webhook recibido sin task_id" });
	  } catch (wErr: any) {
	    console.error("Error processing ClickUp webhook:", wErr);
	    res.status(500).json({ error: wErr.message });
	  }
	});

	// Batch scan to auto-fix resolutions requested in comments by Karla
	app.post("/api/scan-all-karla-resolutions", async (req, res) => {
	  try {
	    console.log("🔍 [Karla Scanner] Iniciando escaneo de tareas para detectar cambios de resolución por Karla...");
	    const tasksRes = await fetch(`https://api.clickup.com/api/v2/list/223500803/task?include_closed=false`, {
	      headers: { "Authorization": getClickUpApiKey() }
	    });

	    if (!tasksRes.ok) {
	      return res.status(500).json({ error: "Error obteniendo tareas de ClickUp" });
	    }

	    const tasksData = await tasksRes.json() as any;
	    const tasks = tasksData.tasks || [];
	    const updatedList: any[] = [];

	    for (const t of tasks) {
	      try {
	        const cRes = await fetch(`https://api.clickup.com/api/v2/task/${t.id}/comment`, { headers: { "Authorization": getClickUpApiKey() } });
	        if (cRes.ok) {
	          const cData = await cRes.json() as any;
	          const comments = cData.comments || [];
	          const currentResField = (t.custom_fields || []).find((f: any) => f.id === "55638270-b614-4783-ad1c-0bd994d6484b");
	          const currentResVal = typeof currentResField?.value === "string" ? currentResField.value : "";
	          const trigger = await applyKarlaResolutionIfDetected(t.id, comments, currentResVal);
	          if (trigger && trigger.applied) {
	            updatedList.push({
	              task_id: t.id,
	              task_name: t.name,
	              resolution: trigger.resolutionName,
	              comment: trigger.commentText
	            });
	          }
	        }
	      } catch (err: any) {
	        console.warn(`Error scanning comments for task ${t.id}:`, err.message);
	      }
	    }

	    res.json({
	      success: true,
	      scanned_count: tasks.length,
	      updated_count: updatedList.length,
	      updated_tasks: updatedList
	    });
	  } catch (err: any) {
	    console.error("Error in /api/scan-all-karla-resolutions:", err);
	    res.status(500).json({ error: err.message });
	  }
	});

	// Get task details, phone and timezone
	app.get("/api/task-details/:id", async (req, res) => {
	  const { id } = req.params;
	  try {
		const url = `https://api.clickup.com/api/v2/task/${id}`;
		const response = await fetch(url, { headers: { "Authorization": getClickUpApiKey() } });
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
		const tz = timezonesMap[id] || getTimezoneByPhone(phone) || "EST";

		// Resolve Zendesk Ticket ID
		const zendeskMap = await obtenerZendeskTicketIds();
		let zendeskTicketId = zendeskMap[id] || "";
		if (!zendeskTicketId && data.custom_fields) {
		  const zdField = (data.custom_fields || []).find((f: any) => 
			f.id === ID_CF_ZENDESK_TICKET || 
			(f.name && typeof f.name === "string" && f.name.toLowerCase().includes("zendesk ticket"))
		  );
		  if (zdField && zdField.value !== undefined && zdField.value !== null) {
			const rawVal = typeof zdField.value === "string" ? zdField.value : (zdField.value.url || zdField.value.text || String(zdField.value));
			if (rawVal) {
			  zendeskTicketId = rawVal;
			}
		  }
		}

		const origName = data.name || "";
		let invoiceVal = "";
		let clientNameVal = "";

		if (origName.includes("-")) {
		  const parts = origName.split("-");
		  invoiceVal = parts[0].trim();
		  clientNameVal = parts.slice(1).join("-").trim();
		} else {
		  const match = origName.match(/\b([A-Z0-9]{3,12})\b/i);
		  if (match) invoiceVal = match[1];
		  clientNameVal = origName;
		}

		if (!zendeskTicketId) {
		  let parsedTicket = "";
		  if (origName.includes("-")) {
			parsedTicket = origName.split("-")[0].trim();
		  } else {
			const match = origName.match(/\b([A-Z0-9]{3,10})\b/i);
			if (match) parsedTicket = match[1];
		  }
		  if (parsedTicket && !["none", "null", "undefined", "n/a"].includes(parsedTicket.toLowerCase())) {
			zendeskTicketId = parsedTicket;
		  }
		}

		if (zendeskTicketId && zendeskTicketId.trim()) {
		  guardarZendeskTicketId(id, zendeskTicketId.trim()).catch(() => {});
		}

		// Resolve Email
		const emailsMap = await obtenerEmails();
		let emailVal = emailsMap[id] || "";
		if (!emailVal && data.description) {
		  const emailMatch = data.description.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
		  if (emailMatch) emailVal = emailMatch[0];
		}
		if (!emailVal && data.custom_fields) {
		  const emailField = (data.custom_fields || []).find((f: any) => 
		    f.name && typeof f.name === "string" && (
		      f.name.toLowerCase().includes("email") || 
		      f.name.toLowerCase().includes("correo")
		    )
		  );
		  if (emailField && emailField.value) {
		    emailVal = String(emailField.value);
		  }
		}

		// Fallback: If still no email, check Zendesk ticket requester if available
		if (!emailVal && zendeskTicketId) {
		  try {
		    const zdClean = zendeskTicketId.replace(/[^\d]/g, "") || zendeskTicketId;
		    if (zdClean) {
		      const zdTicketData = await zendeskFetch(`/tickets/${zdClean}.json?include=users,requesters`);
		      const rawZdUsers = Array.isArray(zdTicketData?.users) ? zdTicketData.users : [];
		      const reqUser = rawZdUsers.find((u: any) => u.id === zdTicketData?.ticket?.requester_id) || zdTicketData?.requester;
		      if (reqUser?.email) {
		        emailVal = reqUser.email;
		        guardarEmail(id, emailVal).catch(() => {});
		      }
		    }
		  } catch (e: any) {}
		}

		// Fetch task comments from ClickUp
		let commentsText: string[] = [];
		let rawComments: any[] = [];
		try {
		  const commentsRes = await fetch(`https://api.clickup.com/api/v2/task/${id}/comment`, { headers: { "Authorization": getClickUpApiKey() } });
		  if (commentsRes.ok) {
			const commentsData = await commentsRes.json() as any;
			if (Array.isArray(commentsData.comments)) {
			  rawComments = commentsData.comments;
			  commentsText = commentsData.comments.map((c: any) => c.comment_text || c.text || "").filter(Boolean);
			}
		  }
		} catch (e) {
		  console.error("Error fetching comments for task details:", e);
		}

		// Resolve Resolution custom field directly and authoritatively from ClickUp
		let resolutionVal = "";
		if (data.custom_fields && Array.isArray(data.custom_fields)) {
		  const resField = data.custom_fields.find((f: any) => 
			f.id === "55638270-b614-4783-ad1c-0bd994d6484b" || 
			(f.name && typeof f.name === "string" && (
			  f.name.toLowerCase().includes("resolution") ||
			  f.name.toLowerCase().includes("resoluci")
			))
		  );
		  if (resField && resField.value !== undefined && resField.value !== null) {
			const options = resField.type_config?.options || [];
			if (typeof resField.value === "string") {
			  // Check if string matches an option id or an option name
			  const matchedOption = options.find((o: any) => 
				o.id === resField.value || 
				o.name.trim().toLowerCase() === resField.value.trim().toLowerCase()
			  );
			  resolutionVal = matchedOption ? matchedOption.id : resField.value;
			} else if (typeof resField.value === "number") {
			  // In ClickUp dropdown fields, value is the orderindex of the selected option
			  const option = options.find((o: any) => o.orderindex === resField.value) || options[resField.value];
			  if (option && option.id) resolutionVal = option.id;
			} else if (resField.value && typeof resField.value === "object" && resField.value.id) {
			  resolutionVal = resField.value.id;
			}
		  }
		}

		// Check for Karla's resolution suggestion in comments (READ ONLY: autoApply = false, NEVER mutate ClickUp and NEVER overwrite resolutionVal!)
		let karlaTriggerInfo: any = null;
		if (rawComments.length > 0) {
		  try {
		    karlaTriggerInfo = await applyKarlaResolutionIfDetected(id, rawComments, resolutionVal, false);
		  } catch (kErr: any) {
		    console.warn("Could not check Karla resolution in task-details:", kErr.message);
		  }
		}

		// Resolve Reason / Category custom field
		let reasonVal = "";
		if (data.custom_fields && Array.isArray(data.custom_fields)) {
		  const reasonField = data.custom_fields.find((f: any) => 
			f.name && typeof f.name === "string" && (
			  f.name.toLowerCase().includes("motivo") ||
			  f.name.toLowerCase().includes("reason") ||
			  f.name.toLowerCase().includes("category")
			)
		  );
		  if (reasonField && reasonField.value !== undefined) {
			reasonVal = typeof reasonField.value === "string" ? reasonField.value : String(reasonField.value);
		  }
		}

		// Resolve Answered Time
		const answeredTimesMap = await obtenerAnsweredTimes();
		const answeredAt = answeredTimesMap[id] || null;

		const detailedCf = extractDetailedCustomFields(data.custom_fields || []);

		res.json({
		  id: data.id,
		  name: data.name,
		  client_name: clientNameVal,
		  description: data.description,
		  status: data.status?.status,
		  phone,
		  email: emailVal,
		  timezone: tz,
		  invoice: invoiceVal,
		  external_id: invoiceVal,
		  zendesk_ticket_id: zendeskTicketId,
		  resolution_id: resolutionVal,
		  karla_resolution_trigger: karlaTriggerInfo,
		  reason: reasonVal,
		  contact_date: detailedCf.contactDate,
		  sale_date: detailedCf.saleDate,
		  seller: detailedCf.seller,
		  amount_usd: detailedCf.amountUsd,
		  comments: commentsText,
		  custom_fields: data.custom_fields || [],
		  formatted_custom_fields: detailedCf.summaryText,
		  answered_at: answeredAt
		});
	  } catch (err: any) {
		res.status(500).json({ error: err.message });
	  }
	});

	// Update client details: phone, timezone, external_id (invoice), email and push to Zendesk + ClickUp
	app.post("/api/update-client-info", async (req, res) => {
	  const { task_id, phone, email, timezone, new_task_id, zendesk_ticket_id, external_id, invoice, name } = req.body;
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
		if (email) {
		  await guardarEmail(activeTaskId, email);
		}
		if (zendesk_ticket_id !== undefined && zendesk_ticket_id !== null) {
		  await guardarZendeskTicketId(activeTaskId, String(zendesk_ticket_id).trim());
		}

		// Try to update phone & email in ClickUp custom fields
		if (phone || email) {
		  try {
			const getUrl = `https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/field`;
			const fResponse = await fetch(getUrl, { headers: { "Authorization": getClickUpApiKey() } });
			if (fResponse.ok) {
			  const fData = await fResponse.json() as any;
			  const fields = fData.fields || [];

			  if (phone) {
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

			  if (email) {
				const emailField = fields.find((f: any) => 
				  f.name && typeof f.name === "string" && (
					f.name.toLowerCase().includes("email") || 
					f.name.toLowerCase().includes("correo")
				  )
				);
				if (emailField) {
				  const updateUrl = `https://api.clickup.com/api/v2/task/${activeTaskId}/field/${emailField.id}`;
				  await fetch(updateUrl, {
					method: "POST",
					headers: await getClickupHeaders(),
					body: JSON.stringify({ value: email })
				  });
				}
			  }
			}
		  } catch (clickupErr) {
			console.error("Could not update custom fields in ClickUp:", clickupErr);
		  }
		}

		// Sync User Profile (External ID / Invoice, Phone, Email, Name) & Ticket in Zendesk Direct API
		let zdSyncResult: any = null;
		try {
		  zdSyncResult = await syncZendeskUserAndTicket({
			taskId: activeTaskId,
			zendeskTicketId: zendesk_ticket_id,
			phone,
			email,
			externalId: external_id || invoice,
			name
		  });
		} catch (zdErr: any) {
		  console.warn("Zendesk sync warning in update-client-info:", zdErr.message);
		}

		// Ensure newly resolved email or phone from Zendesk is saved in local persistence
		const resolvedEmail = email || zdSyncResult?.email || (await obtenerEmails())[activeTaskId] || "";
		const resolvedPhone = phone || zdSyncResult?.phone || (await obtenerPhones())[activeTaskId] || "";
		const resolvedTicketId = zendesk_ticket_id || zdSyncResult?.ticket_id || (await obtenerZendeskTicketIds())[activeTaskId] || "";
		const resolvedExtId = external_id || invoice || zdSyncResult?.external_id || "";
		const resolvedName = name || zdSyncResult?.name || "";

		if (resolvedEmail && !email) {
		  await guardarEmail(activeTaskId, resolvedEmail);
		}
		if (resolvedPhone && !phone) {
		  await guardarPhone(activeTaskId, resolvedPhone);
		}
		if (resolvedTicketId && !zendesk_ticket_id) {
		  await guardarZendeskTicketId(activeTaskId, resolvedTicketId);
		}

		logMetric("client_info_updated", 0.05, { task_id: activeTaskId, phone: resolvedPhone, email: resolvedEmail, timezone, external_id: resolvedExtId });
		res.json({ 
		  status: "ok", 
		  task_id: activeTaskId,
		  email: resolvedEmail,
		  phone: resolvedPhone,
		  external_id: resolvedExtId,
		  client_name: resolvedName,
		  zendesk_ticket_id: resolvedTicketId,
		  zendesk_synced: zdSyncResult?.user_updated || zdSyncResult?.ticket_updated || false,
		  zendesk_message: zdSyncResult?.details || "",
		  zendesk_user_id: zdSyncResult?.user_id || null
		});
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
		const response = await fetch(clickupUrl, { headers: { "Authorization": getClickUpApiKey() } });

		if (!response.ok) {
		  return res.json({ answer: "Error: No pude descargar los datos de esta tarea desde ClickUp." });
		}

		const target = await response.json() as any;
		const hilo = await fetchTaskComments(task_id, 30);
		const descripcionTarea = target.description || "Sin descripción";
		const statusActual = (target.status?.status || "Desconocido").toUpperCase();

		const detailedCf = extractDetailedCustomFields(target.custom_fields || []);

		const answeredTimesMap = await obtenerAnsweredTimes();
		const respondedAt = answeredTimesMap[task_id] || null;

		let metricasTiempoRespuesta = "";
		let directrizDiasSinResponder = "";

		if (respondedAt) {
		  const responseDate = new Date(respondedAt);
		  const diasHabiles = getBusinessDaysDiff(responseDate, new Date());
		  const diasNaturales = Math.max(0, Math.floor((Date.now() - responseDate.getTime()) / (1000 * 60 * 60 * 24)));
		  const fechaFormateada = responseDate.toISOString().replace("T", " ").substring(0, 19) + " UTC";
		  
		  metricasTiempoRespuesta = `• ÚLTIMA RESPUESTA CONFIRMADA DEL CLIENTE: ${fechaFormateada}
• DÍAS HÁBILES SIN RESPONDER (EXCLUYENDO SÁBADOS Y DOMINGOS): ${diasHabiles} días hábiles.
• DÍAS NATURALES TRANSCURRIDOS: ${diasNaturales} días naturales.`;

		  directrizDiasSinResponder = `El cliente respondió formalmente por última vez el ${fechaFormateada}. Han transcurrido EXACTAMENTE ${diasHabiles} días hábiles (${diasNaturales} días naturales) desde su última respuesta confirmada.`;
		} else {
		  const createdDate = target.date_created ? new Date(parseInt(target.date_created)) : null;
		  const diasHabilesCreacion = createdDate ? getBusinessDaysDiff(createdDate, new Date()) : null;
		  const diasNaturalesCreacion = createdDate ? Math.max(0, Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24))) : null;
		  const fechaCreacionFmt = createdDate ? createdDate.toISOString().replace("T", " ").substring(0, 10) : detailedCf.contactDate;

		  metricasTiempoRespuesta = `• REGISTRO DE RESPUESTA DEL CLIENTE: No hay registro de respuesta confirmada del cliente (solo intentos de llamada/buzón del agente o caso en espera).
• FECHA DE CREACIÓN / CONTACTO INICIAL: ${fechaCreacionFmt}
• TIEMPO TRANSCURRIDO SIN RESPUESTA DESDE EL INICIO: ${diasHabilesCreacion !== null ? `${diasHabilesCreacion} días hábiles (${diasNaturalesCreacion} días naturales)` : "Varios días"}.`;

		  directrizDiasSinResponder = `No existe registro de que el cliente haya respondido alguna vez. Lleva ${diasHabilesCreacion !== null ? `${diasHabilesCreacion} días hábiles (${diasNaturalesCreacion} días naturales)` : "varios días"} sin responder desde que se creó el caso / primer contacto.`;
		}

		const manualFiltrado = filtrarManualRelevante(query, manual);

		const promptFinal = `TAREA EN CLICKUP: ${target.name} (ID: ${task_id})
	ESTATUS ACTUAL: ${statusActual}
	DESCRIPCIÓN ORIGINAL: ${descripcionTarea}

	${detailedCf.summaryText}

	⏱️ REGISTRO EXACTO DE TIEMPO Y DÍAS SIN RESPONDER:
	${metricasTiempoRespuesta}

	HILO DE COMENTARIOS DISPONIBLES: 
	${hilo}

	MANUAL OPERATIVO Y POLÍTICAS (SI APLICA): 
	${manualFiltrado}

	PREGUNTA DEL USUARIO SOBRE ESTE CASO ESPECÍFICO: ${query}

	INSTRUCCIONES:
	Eres Donna, la IA de asistencia ejecutiva de Morena Mia Beauty Group. El usuario tiene este ticket abierto frente a él. 
	Tienes acceso completo a los campos personalizados clave de esta tarea:
	- 📅 Fecha de Contacto (ID 63946f1c-7c02-455a-af2d-af7f5f41e3ea): ${detailedCf.contactDate}
	- 🛒 Fecha de Venta (ID f910021f-74df-426d-bdf2-586867dbf5c6): ${detailedCf.saleDate}
	- 👤 Vendedor / Representante (ID af1663e3-9d94-4edd-ad6a-cd775d0a1a70): ${detailedCf.seller}
	- 💵 Monto USD (ID a51386cd-755e-4c9c-af58-5686b5c2a82d): ${detailedCf.amountUsd}
	- ⏳ TIEMPO SIN RESPUESTA: ${directrizDiasSinResponder}

	Si el usuario te consulta sobre montos, vendedores, fecha de venta o fecha de contacto de esta tarea, proporciónale estos datos exactos.
	
	🎯 INSTRUCCIÓN CLAVE PARA PREGUNTAS DE "DÍAS SIN RESPONDER / CUÁNTO TIEMPO LLEVA SIN CONTESTAR":
	Si te preguntan cuántos días tiene sin responder el cliente:
	- Responde DIRECTAMENTE con el número exacto de días hábiles (${directrizDiasSinResponder}).
	- Especifica si se cuenta desde su última respuesta confirmada o si nunca ha respondido desde la creación del ticket.
	- Si tiene 4 o más días hábiles sin responder, recuérdale al agente que de acuerdo a las políticas operativas corresponde aplicar estatus DEADLINE (o proceder al cierre si ya se envió el aviso de deadline y expiró).

	Lee todo el hilo de comentarios y responde su pregunta basándote ÚNICAMENTE en la información de este caso, sus campos personalizados y tu manual.
	Sé clara, directa, amigable y muy profesional. Si te pide un resumen, cuéntale la historia del ticket de forma breve y fluida. 

	💼 OFFICIAL CORPORATE TONE (INTERNAL REPORTING ONLY):
	Usa el vocabulario oficial de la empresa. Reconoce términos como "First Sale Refund", "GBK (Give Back tax refund)", "Shalem (Payment plan)", y "Docusign".
	- 🚨 REGLA ABSOLUTA DE REDACCIÓN EN TERCERA PERSONA (REPORTE INTERNO): Tu respuesta es un INFORME / REPORTE INTERNO para el equipo administrativo. Refiérete SIEMPRE a la cliente/cliente en TERCERA PERSONA (ej. "Se intentó contactar a la cliente por correo electrónico...", "La cliente Francesca no ha respondido...", "Se le ofreció un regalo compensatorio...", "Se asignará un deadline a esta tarea..."). JAMÁS redactes el mensaje dirigiéndote a la cliente ("Dear...", "Estimada cliente...", "Te enviamos...", "we reached out to you"). Tienes ESTRICTAMENTE PROHIBIDO usar saludos o despedidas de correo dirigidos al cliente.

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
		const response = await fetch(url, { headers: { "Authorization": getClickUpApiKey() } });

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
		const response = await fetch(url, { headers: { "Authorization": getClickUpApiKey() } });
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
	  const { task_id, method, type, client, email, phone, address, amount, bank, swift, bank_account } = req.body;
	  const targetMethod = method || "CHECK / WIRE TRANSFER";
	  const targetType = type || "FULL/PARTIAL REFUND";

	  try {
		const url = `https://api.clickup.com/api/v2/task/${task_id}`;
		const response = await fetch(url, { headers: { "Authorization": getClickUpApiKey() } });

		if (!response.ok) {
		  return res.status(400).json({ error: "No se pudo descargar la tarea original de ClickUp." });
		}

		const original = (await response.json()) as any;
		const originalName = original.name || "INVOICE";
		const invoice = originalName.includes("-") ? originalName.split("-")[0].trim() : originalName;

		const nuevoNombre = `${invoice} + ${targetMethod.toUpperCase()} + ${targetType.toUpperCase()}`;

		// Extract / resolve fields for mandatory refund template
		const phonesMap = await obtenerPhones();
		let resolvedPhone = (phone || "").trim();
		if (!resolvedPhone) {
		  resolvedPhone = phonesMap[task_id] || "";
		}
		if (!resolvedPhone) {
		  const phoneField = (original.custom_fields || []).find((f: any) =>
			f.name && typeof f.name === "string" && (
			  f.name.toLowerCase().includes("phone") ||
			  f.name.toLowerCase().includes("teléfono") ||
			  f.name.toLowerCase().includes("telefono")
			)
		  );
		  if (phoneField && phoneField.value !== undefined) {
			resolvedPhone = String(phoneField.value);
		  }
		}

		let resolvedClient = (client || "").trim();
		if (!resolvedClient) {
		  if (originalName.includes("-")) {
			resolvedClient = originalName.split("-").slice(1).join("-").trim();
		  } else {
			resolvedClient = originalName;
		  }
		}

		let resolvedEmail = (email || "").trim();
		if (!resolvedEmail) {
		  const emailField = (original.custom_fields || []).find((f: any) =>
			f.name && typeof f.name === "string" && (
			  f.name.toLowerCase().includes("email") ||
			  f.name.toLowerCase().includes("correo")
			)
		  );
		  if (emailField && emailField.value !== undefined) {
			resolvedEmail = String(emailField.value);
		  } else {
			const emailMatch = (original.description || "").match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
			if (emailMatch) resolvedEmail = emailMatch[0];
		  }
		}

		let resolvedAmount = (amount || "").trim();
		if (!resolvedAmount) {
		  const amountField = (original.custom_fields || []).find((f: any) =>
			f.id === ID_CF_AMOUNT_USD ||
			(f.name && typeof f.name === "string" && (
			  f.name.toLowerCase().includes("monto") ||
			  f.name.toLowerCase().includes("amount")
			))
		  );
		  if (amountField && amountField.value !== undefined && amountField.value !== null) {
			const num = parseFloat(amountField.value);
			resolvedAmount = !isNaN(num) ? `$${num.toFixed(2)} USD` : String(amountField.value);
		  }
		}

		const resolvedAddress = (address || "").trim();
		const origDesc = original.description || "";

		let resolvedBank = (bank || "").trim();
		if (!resolvedBank) {
		  const bMatch = origDesc.match(/(?:Bank|Banco):\s*([^\n\r]+)/i);
		  if (bMatch) resolvedBank = bMatch[1].trim();
		}

		let resolvedSwift = (swift || "").trim();
		if (!resolvedSwift) {
		  const sMatch = origDesc.match(/(?:Swift|SWIFT\s*code|ABA):\s*([^\n\r]+)/i);
		  if (sMatch) resolvedSwift = sMatch[1].trim();
		}

		let resolvedBankAccount = (bank_account || "").trim();
		if (!resolvedBankAccount) {
		  const aMatch = origDesc.match(/(?:Bank\s*account|Account\s*number|Cuenta|Bank\s*account\s*number):\s*([^\n\r]+)/i);
		  if (aMatch) resolvedBankAccount = aMatch[1].trim();
		}

		const isWire = targetMethod.toUpperCase().includes("WIRE") || targetMethod.toUpperCase().includes("TRANSFER");

		let descripcionFinal = "";
		if (isWire) {
		  // Exact 8-line template for Wire Transfers with no other lines of text
		  descripcionFinal = `Name: ${resolvedClient}\nEmail: ${resolvedEmail}\nPhone: ${resolvedPhone}\nCustomer Address: ${resolvedAddress}\nAmount: ${resolvedAmount}\nBank: ${resolvedBank}\nSwift : ${resolvedSwift}\nBank Account: ${resolvedBankAccount}`;
		} else {
		  descripcionFinal = `Name: ${resolvedClient}\nEmail: ${resolvedEmail}\nPhone: ${resolvedPhone}\nCustomer Address: ${resolvedAddress}\nAmount: ${resolvedAmount}\nMethod: ${targetMethod}\nStatus: Pending`;
		}

		const customFields: any[] = [];
		for (const cf of (original.custom_fields || [])) {
		  if (cf.value !== undefined && cf.value !== null) {
			customFields.push({ id: cf.id, value: cf.value });
		  }
		}

		// Post to list 223500803
		let createRes = await fetch("https://api.clickup.com/api/v2/list/223500803/task", {
		  method: "POST",
		  headers: { "Authorization": getClickUpApiKey(), "Content-Type": "application/json" },
		  body: JSON.stringify({
			name: nuevoNombre,
			description: descripcionFinal,
			assignees: [ID_LORENZO],
			custom_fields: customFields
		  })
		});

		if (!createRes.ok) {
		  console.warn("⚠️ Falló creación con custom_fields en lista 223500803, reintentando creación limpia...");
		  createRes = await fetch("https://api.clickup.com/api/v2/list/223500803/task", {
			method: "POST",
			headers: { "Authorization": getClickUpApiKey(), "Content-Type": "application/json" },
			body: JSON.stringify({
			  name: nuevoNombre,
			  description: descripcionFinal,
			  assignees: [ID_LORENZO]
			})
		  });
		}

		if (!createRes.ok) {
		  const errorText = await createRes.text();
		  console.error("❌ Error al duplicar en ClickUp:", errorText);
		  return res.status(400).json({ error: `ClickUp error: ${errorText}` });
		}

		const nuevaTarea = (await createRes.json()) as any;
		logMetric("task_cloned_to_refunds", 0.2, { original_id: task_id, new_id: nuevaTarea.id });

		return res.json({ 
		  status: "ok", 
		  new_task_id: nuevaTarea.id,
		  new_task_url: nuevaTarea.url || `https://app.clickup.com/t/${nuevaTarea.id}`, 
		  new_name: nuevoNombre 
		});

	  } catch (error: any) {
		console.error("❌ Error en /api/duplicate-refund:", error);
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

		const enrichedChildren = normalizedChildren.map((child: any) => ({
		  ...child,
		  downloadUrl: `/api/sharefile/download-file/${child.Id}?name=${encodeURIComponent(child.Name || 'archivo')}`
		}));

		// Siempre devolver éxito, con archivos y enlace de descarga ZIP
		return res.json({
		  success: true,
		  url: folderUrl,
		  folder: targetFolder,
		  files: enrichedChildren,
		  zipDownloadUrl: `/api/sharefile/download-folder-zip/${folderId}?invoice=${encodeURIComponent(invoice || '')}`,
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

	// Endpoint para descargar un archivo individual de ShareFile
	app.get("/api/sharefile/download-file/:itemId", async (req, res) => {
	  const { itemId } = req.params;
	  const fileNameQuery = (req.query.name as string) || `ShareFile_Item_${itemId}`;

	  try {
		let token = process.env.SHAREFILE_ACCESS_TOKEN;
		const apiBaseUrl = process.env.SHAREFILE_API_BASE_URL;

		if (!token || !apiBaseUrl) {
		  console.log(`[ShareFile Download File] No credentials. Returning demo file content for ${itemId}`);
		  const finalName = fileNameQuery.match(/\.[a-z0-9]+$/i) ? fileNameQuery : `${fileNameQuery}.pdf`;
		  res.setHeader("Content-Type", "application/octet-stream");
		  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(finalName)}"`);
		  return res.send(`[DEMO SHAREFILE ARCHIVO]\nID de Elemento: ${itemId}\nNombre: ${fileNameQuery}\nFecha de Descarga: ${new Date().toISOString()}\nEste es un archivo de demostración simulado porque no hay credenciales de Citrix ShareFile configuradas.`);
		}

		const baseUrl = apiBaseUrl.replace(/\/$/, "");
		const downloadUrl = `${baseUrl}/Items(${itemId})/Download`;

		let sfRes = await fetch(downloadUrl, {
		  headers: { "Authorization": `Bearer ${token}` },
		  redirect: "manual"
		});

		if (!sfRes.ok && sfRes.status === 401) {
		  const newToken = await refreshShareFileAccessToken();
		  if (newToken) {
			token = newToken;
			sfRes = await fetch(downloadUrl, {
			  headers: { "Authorization": `Bearer ${newToken}` },
			  redirect: "manual"
			});
		  }
		}

		let finalDownloadUrl = downloadUrl;
		if (sfRes.status === 301 || sfRes.status === 302 || sfRes.status === 307 || sfRes.status === 308) {
		  const location = sfRes.headers.get("location");
		  if (location) finalDownloadUrl = location;
		} else if (sfRes.ok) {
		  const contentType = sfRes.headers.get("content-type") || "";
		  if (contentType.includes("application/json")) {
			const json = await sfRes.json();
			finalDownloadUrl = json.DownloadUrl || downloadUrl;
		  } else {
			finalDownloadUrl = sfRes.url;
		  }
		}

		const fileRes = await fetch(finalDownloadUrl);
		if (!fileRes.ok) {
		  throw new Error(`Error al obtener archivo binario desde CDN ShareFile: HTTP ${fileRes.status}`);
		}

		const contentType = fileRes.headers.get("content-type") || "application/octet-stream";
		res.setHeader("Content-Type", contentType);
		res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileNameQuery)}"`);

		const arrayBuffer = await fileRes.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
		res.send(buffer);
	  } catch (err: any) {
		console.error(`[ShareFile Download Error] Item ${itemId}:`, err.message);
		res.setHeader("Content-Type", "text/plain");
		res.setHeader("Content-Disposition", `attachment; filename="Error_${itemId}.txt"`);
		res.status(500).send(`Error al descargar archivo desde ShareFile: ${err.message}`);
	  }
	});

	// Endpoint para descargar TODOS los archivos de una carpeta en un archivo .ZIP
	app.get("/api/sharefile/download-folder-zip/:folderId", async (req, res) => {
	  const { folderId } = req.params;
	  const invoice = (req.query.invoice as string) || "";
	  const zipFileName = invoice ? `ShareFile_Invoice_${invoice}_Archivos.zip` : `ShareFile_Carpeta_${folderId}_Archivos.zip`;

	  res.setHeader("Content-Type", "application/zip");
	  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(zipFileName)}"`);

	  const archive = archiver("zip", { zlib: { level: 9 } });
	  archive.pipe(res);

	  try {
		let token = process.env.SHAREFILE_ACCESS_TOKEN;
		const apiBaseUrl = process.env.SHAREFILE_API_BASE_URL;

		if (!token || !apiBaseUrl) {
		  console.log(`[ShareFile Zip Download] No credentials. Packing demo zip for folder ${folderId}`);
		  archive.append(`[DEMO RECIBO DE FACTURA]\nInvoice: ${invoice || "MM-DEMO"}\nCarpeta ID: ${folderId}\nFecha: ${new Date().toISOString()}`, { name: `FACTURA_${invoice || 'DEMO'}.txt` });
		  archive.append(`[DEMO VOUCHER DE TERMINAL]\nVoucher de Pago Aprobado\nTerminal A`, { name: `VOUCHER_${invoice || 'DEMO'}.txt` });
		  await archive.finalize();
		  return;
		}

		const baseUrl = apiBaseUrl.replace(/\/$/, "");
		let cleanFolderId = folderId;
		if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cleanFolderId)) {
		  cleanFolderId = `fo${cleanFolderId}`;
		}

		const childrenUrl = `${baseUrl}/Items(${cleanFolderId})/Children?$top=100`;
		let childrenRes = await fetch(childrenUrl, {
		  headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
		});

		if (!childrenRes.ok && childrenRes.status === 401) {
		  const newToken = await refreshShareFileAccessToken();
		  if (newToken) {
			token = newToken;
			childrenRes = await fetch(childrenUrl, {
			  headers: { "Authorization": `Bearer ${newToken}`, "Accept": "application/json" }
			});
		  }
		}

		if (!childrenRes.ok) {
		  archive.append(`Error al listar contenido de la carpeta ${folderId}: HTTP ${childrenRes.status}`, { name: "ERROR_INFO.txt" });
		  await archive.finalize();
		  return;
		}

		const childrenData = await childrenRes.json();
		const rawChildren = childrenData.value || [];
		const filesOnly = rawChildren.filter((item: any) => {
		  const isFolder = !!(item["odata.type"]?.includes("Folder") || item.typename === "Folder" || item.type === "Folder" || item.FileCount !== undefined);
		  return !isFolder;
		});

		if (filesOnly.length === 0) {
		  archive.append(`La carpeta de ShareFile (${folderId}) no contiene archivos de imagen/pdf directamente.`, { name: "CARPETA_VACIA.txt" });
		  await archive.finalize();
		  return;
		}

		for (const fileItem of filesOnly) {
		  const itemId = fileItem.Id || fileItem.id;
		  const fileName = fileItem.Name || fileItem.name || `archivo_${itemId}`;
		  try {
			const downloadUrl = `${baseUrl}/Items(${itemId})/Download`;
			let sfRes = await fetch(downloadUrl, {
			  headers: { "Authorization": `Bearer ${token}` },
			  redirect: "manual"
			});

			let finalUrl = downloadUrl;
			if (sfRes.status === 301 || sfRes.status === 302 || sfRes.status === 307 || sfRes.status === 308) {
			  const location = sfRes.headers.get("location");
			  if (location) finalUrl = location;
			} else if (sfRes.ok) {
			  if (sfRes.headers.get("content-type")?.includes("application/json")) {
				const json = await sfRes.json();
				finalUrl = json.DownloadUrl || downloadUrl;
			  } else {
				finalUrl = sfRes.url;
			  }
			}

			const binaryRes = await fetch(finalUrl);
			if (binaryRes.ok) {
			  const arrayBuf = await binaryRes.arrayBuffer();
			  archive.append(Buffer.from(arrayBuf), { name: fileName });
			} else {
			  archive.append(`Error al descargar ${fileName}: HTTP ${binaryRes.status}`, { name: `ERROR_${fileName}.txt` });
			}
		  } catch (fileErr: any) {
			archive.append(`Error procesando ${fileName}: ${fileErr.message}`, { name: `ERROR_${fileName}.txt` });
		  }
		}

		await archive.finalize();
	  } catch (err: any) {
		console.error(`[ShareFile Zip Error] Folder ${folderId}:`, err.message);
		archive.append(`Error general al generar archivo ZIP: ${err.message}`, { name: "ERROR_GENERAL.txt" });
		await archive.finalize();
	  }
	});

	// Endpoint para consultar archivos contenidos en una carpeta específica con enlaces de descarga
	app.get("/api/sharefile/folder-files/:folderId", async (req, res) => {
	  const { folderId } = req.params;
	  try {
		let token = process.env.SHAREFILE_ACCESS_TOKEN;
		const apiBaseUrl = process.env.SHAREFILE_API_BASE_URL;

		if (!token || !apiBaseUrl) {
		  return res.json({
			success: true,
			isDemo: true,
			files: [
			  {
				Id: `fida_demo_1_${folderId}`,
				Name: `FACTURA_${folderId}.jpg`,
				FileSizeBytes: 204800,
				downloadUrl: `/api/sharefile/download-file/fida_demo_1_${folderId}?name=FACTURA_${folderId}.jpg`
			  },
			  {
				Id: `fida_demo_2_${folderId}`,
				Name: `VOUCHER_${folderId}.png`,
				FileSizeBytes: 145000,
				downloadUrl: `/api/sharefile/download-file/fida_demo_2_${folderId}?name=VOUCHER_${folderId}.png`
			  }
			],
			zipDownloadUrl: `/api/sharefile/download-folder-zip/${folderId}`
		  });
		}

		const baseUrl = apiBaseUrl.replace(/\/$/, "");
		let cleanFolderId = folderId;
		if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cleanFolderId)) {
		  cleanFolderId = `fo${cleanFolderId}`;
		}

		const childrenUrl = `${baseUrl}/Items(${cleanFolderId})/Children?$top=100`;
		let childrenRes = await fetch(childrenUrl, {
		  headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }
		});

		if (!childrenRes.ok && childrenRes.status === 401) {
		  const newToken = await refreshShareFileAccessToken();
		  if (newToken) {
			token = newToken;
			childrenRes = await fetch(childrenUrl, {
			  headers: { "Authorization": `Bearer ${newToken}`, "Accept": "application/json" }
			});
		  }
		}

		if (!childrenRes.ok) {
		  throw new Error(`ShareFile Children API devolvió estatus ${childrenRes.status}`);
		}

		const childrenData = await childrenRes.json();
		const rawChildren = childrenData.value || [];
		const normalized = rawChildren.map(normalizeShareFileItem).filter(Boolean);
		const files = normalized.map((item: any) => ({
		  ...item,
		  downloadUrl: `/api/sharefile/download-file/${item.Id}?name=${encodeURIComponent(item.Name || 'archivo')}`
		}));

		res.json({
		  success: true,
		  files,
		  zipDownloadUrl: `/api/sharefile/download-folder-zip/${cleanFolderId}`
		});
	  } catch (err: any) {
		res.status(500).json({ success: false, error: err.message });
	  }
	});

	// Direct digital storage in server temporary folder for data extraction & OCR
	const TEMP_DOWNLOADS_DIR = path.join(process.cwd(), "temp_downloads");
	if (!fs.existsSync(TEMP_DOWNLOADS_DIR)) {
	  try { fs.mkdirSync(TEMP_DOWNLOADS_DIR, { recursive: true }); } catch (e) {}
	}

	app.post("/api/sharefile/save-to-temp", async (req, res) => {
	  const { itemId, fileName, folderId, invoice } = req.body;
	  try {
		const targetName = fileName || (invoice ? `Factura_${invoice}.pdf` : `ShareFile_Item_${itemId || Date.now()}.txt`);
		const cleanName = targetName.replace(/[^a-zA-Z0-9_.-]/g, "_");
		const targetPath = path.join(TEMP_DOWNLOADS_DIR, cleanName);

		let fileBuffer: Buffer | null = null;
		let mimeType = "application/octet-stream";

		if (itemId) {
		  let token = process.env.SHAREFILE_ACCESS_TOKEN;
		  const apiBaseUrl = process.env.SHAREFILE_API_BASE_URL;

		  if (!token || !apiBaseUrl || String(itemId).includes("demo")) {
			fileBuffer = Buffer.from(`[DEMO ARCHIVO SHAREFILE]\nID: ${itemId}\nFactura: ${invoice || "N/A"}\nFecha: ${new Date().toISOString()}\nEste archivo fue guardado en la carpeta temporal del servidor para extracción de datos.`);
			mimeType = "text/plain";
		  } else {
			const baseUrl = apiBaseUrl.replace(/\/$/, "");
			const downloadUrl = `${baseUrl}/Items(${itemId})/Download`;

			let sfRes = await fetch(downloadUrl, {
			  headers: { "Authorization": `Bearer ${token}` },
			  redirect: "manual"
			});

			let finalDownloadUrl = downloadUrl;
			if (sfRes.status === 301 || sfRes.status === 302 || sfRes.status === 307 || sfRes.status === 308) {
			  const location = sfRes.headers.get("location");
			  if (location) finalDownloadUrl = location;
			} else if (sfRes.ok) {
			  const contentType = sfRes.headers.get("content-type") || "";
			  if (contentType.includes("application/json")) {
				const json = await sfRes.json();
				finalDownloadUrl = json.DownloadUrl || downloadUrl;
			  } else {
				finalDownloadUrl = sfRes.url;
			  }
			}

			const fileRes = await fetch(finalDownloadUrl);
			if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status} al descargar de ShareFile`);
			mimeType = fileRes.headers.get("content-type") || mimeType;
			const arrayBuffer = await fileRes.arrayBuffer();
			fileBuffer = Buffer.from(arrayBuffer);
		  }
		} else {
		  fileBuffer = Buffer.from(`[REGISTRO TEMPORAL]\nFactura: ${invoice || 'N/A'}\nCarpeta: ${folderId || 'N/A'}\nFecha: ${new Date().toISOString()}`);
		  mimeType = "text/plain";
		}

		await fsp.writeFile(targetPath, fileBuffer);

		let extractedData: any = null;
		if (mimeType.startsWith("image/") || cleanName.match(/\.(jpg|jpeg|png|webp)$/i)) {
		  try {
			const b64 = fileBuffer.toString("base64");
			extractedData = await ocrWithGroq(b64, mimeType.startsWith("image/") ? mimeType : "image/jpeg");
		  } catch (ocrErr: any) {
			console.warn("[Save-to-Temp OCR Warning]", ocrErr.message);
		  }
		}

		res.json({
		  success: true,
		  message: `Archivo "${cleanName}" guardado en la carpeta temporal del servidor.`,
		  fileName: cleanName,
		  filePath: targetPath,
		  fileSize: fileBuffer.length,
		  fileSizeFormatted: (fileBuffer.length / 1024).toFixed(1) + " KB",
		  extractedData,
		  savedAt: new Date().toISOString()
		});
	  } catch (err: any) {
		console.error("[Save to Temp Error]", err);
		res.status(500).json({ success: false, error: err.message });
	  }
	});

	app.get("/api/temp-files", async (req, res) => {
	  try {
		if (!fs.existsSync(TEMP_DOWNLOADS_DIR)) {
		  return res.json({ success: true, files: [] });
		}
		const filenames = await fsp.readdir(TEMP_DOWNLOADS_DIR);
		const files = await Promise.all(filenames.map(async (name) => {
		  const fullPath = path.join(TEMP_DOWNLOADS_DIR, name);
		  const stat = await fsp.stat(fullPath);
		  return {
			fileName: name,
			fileSize: stat.size,
			fileSizeFormatted: (stat.size / 1024).toFixed(1) + " KB",
			createdAt: stat.birthtime,
			modifiedAt: stat.mtime,
			downloadUrl: `/api/temp-files/download/${encodeURIComponent(name)}`
		  };
		}));
		res.json({ success: true, count: files.length, tempDir: TEMP_DOWNLOADS_DIR, files });
	  } catch (err: any) {
		res.status(500).json({ success: false, error: err.message });
	  }
	});

	app.get("/api/temp-files/download/:fileName", async (req, res) => {
	  try {
		const { fileName } = req.params;
		const safeName = path.basename(fileName);
		const filePath = path.join(TEMP_DOWNLOADS_DIR, safeName);

		if (!fs.existsSync(filePath)) {
		  return res.status(404).json({ error: "Archivo temporal no encontrado." });
		}

		res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(safeName)}"`);
		res.sendFile(filePath);
	  } catch (err: any) {
		res.status(500).json({ error: err.message });
	  }
	});

	app.delete("/api/temp-files", async (req, res) => {
	  try {
		if (fs.existsSync(TEMP_DOWNLOADS_DIR)) {
		  const filenames = await fsp.readdir(TEMP_DOWNLOADS_DIR);
		  for (const name of filenames) {
			await fsp.unlink(path.join(TEMP_DOWNLOADS_DIR, name));
		  }
		}
		res.json({ success: true, message: "Carpeta temporal del servidor vaciada exitosamente." });
	  } catch (err: any) {
		res.status(500).json({ success: false, error: err.message });
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
		  const response = await fetchClickUp(url);
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

	// Check invoices presence in ClickUp
	let clickupTasksCache: {
	  timestamp: number;
	  disputesTasks: any[];
	  csTasks: any[];
	  refundsTasks: any[];
	} | null = null;

	async function getClickUpTasksForCheck(scope: string = "all"): Promise<Array<{ task: any; listName: string }>> {
	  const now = Date.now();
	  // Cache for 60 seconds
	  const isCacheValid = clickupTasksCache && (now - clickupTasksCache.timestamp < 60000);

	  const LIST_DISPUTES = "48493938";
	  const LIST_CS = "48494459";
	  const LIST_REFUNDS = "223500803";

	  let disputesTasks = (isCacheValid && clickupTasksCache) ? clickupTasksCache.disputesTasks : [];
	  let csTasks = (isCacheValid && clickupTasksCache) ? clickupTasksCache.csTasks : [];
	  let refundsTasks = (isCacheValid && clickupTasksCache) ? clickupTasksCache.refundsTasks : [];

	  const shouldFetchDisputes = (scope === "all" || scope === "disputes") && (!isCacheValid || disputesTasks.length === 0);
	  const shouldFetchCS = (scope === "all" || scope === "cs") && (!isCacheValid || csTasks.length === 0);
	  const shouldFetchRefunds = (scope === "all") && (!isCacheValid || refundsTasks.length === 0);

	  const fetchListTasks = async (listId: string, maxPages: number = 8) => {
	    const tasks: any[] = [];
	    for (let page = 0; page < maxPages; page++) {
	      try {
	        const url = `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=true&subtasks=true&page=${page}`;
	        const res = await fetchClickUp(url);
	        if (!res.ok) {
	          console.warn(`[check-invoices] Warning fetching page ${page} of list ${listId}: ${res.status}`);
	          break;
	        }
	        const data = await res.json() as any;
	        const pageTasks = data.tasks || [];
	        if (pageTasks.length === 0) break;
	        tasks.push(...pageTasks);
	      } catch (e) {
	        console.error(`[check-invoices] Error on page ${page} list ${listId}:`, e);
	        break;
	      }
	    }
	    return tasks;
	  };

	  const promises: Promise<void>[] = [];
	  if (shouldFetchDisputes) {
	    promises.push((async () => {
	      disputesTasks = await fetchListTasks(LIST_DISPUTES, 8);
	    })());
	  }
	  if (shouldFetchCS) {
	    promises.push((async () => {
	      csTasks = await fetchListTasks(LIST_CS, 8);
	    })());
	  }
	  if (shouldFetchRefunds) {
	    promises.push((async () => {
	      refundsTasks = await fetchListTasks(LIST_REFUNDS, 4);
	    })());
	  }

	  if (promises.length > 0) {
	    await Promise.all(promises);
	  }

	  // Update cache
	  clickupTasksCache = {
	    timestamp: now,
	    disputesTasks: disputesTasks.length > 0 ? disputesTasks : (clickupTasksCache?.disputesTasks || []),
	    csTasks: csTasks.length > 0 ? csTasks : (clickupTasksCache?.csTasks || []),
	    refundsTasks: refundsTasks.length > 0 ? refundsTasks : (clickupTasksCache?.refundsTasks || []),
	  };

	  const combined: Array<{ task: any; listName: string }> = [];
	  if (scope === "disputes" || scope === "all") {
	    for (const t of (clickupTasksCache?.disputesTasks || [])) {
	      combined.push({ task: t, listName: "Disputas" });
	    }
	  }
	  if (scope === "cs" || scope === "all") {
	    for (const t of (clickupTasksCache?.csTasks || [])) {
	      combined.push({ task: t, listName: "Casos CS" });
	    }
	  }
	  if (scope === "all") {
	    for (const t of (clickupTasksCache?.refundsTasks || [])) {
	      combined.push({ task: t, listName: "Reembolsos" });
	    }
	  }

	  return combined;
	}

	app.post("/api/check-invoices-clickup", async (req, res) => {
	  try {
	    const { invoices, scope = "all", forceRefresh = false } = req.body || {};
	    if (!Array.isArray(invoices) || invoices.length === 0) {
	      return res.status(400).json({ error: "Debes enviar un listado de facturas (invoices)." });
	    }

	    if (forceRefresh) {
	      clickupTasksCache = null;
	    }

	    const rawInvoices = invoices.map(inv => String(inv || "").trim()).filter(Boolean);
	    const uniqueInvoices = Array.from(new Set(rawInvoices));

	    const allTasksWithList = await getClickUpTasksForCheck(scope);

	    const ID_CF_REASON = "ee1a1e07-a9b6-4209-a7bc-87162005e2f2";

	    const details: any[] = [];
	    const foundInvoices: string[] = [];
	    const notFoundInvoices: string[] = [];

	    for (const invoice of uniqueInvoices) {
	      const cleanInvoice = invoice.replace(/^#/, "").trim();
	      const upperInvoice = invoice.toUpperCase();
	      const upperClean = cleanInvoice.toUpperCase();

	      // Search among tasks
	      const match = allTasksWithList.find(({ task }) => {
	        const taskNameUpper = String(task.name || "").toUpperCase();
	        if (taskNameUpper.includes(upperInvoice) || taskNameUpper.includes(upperClean)) {
	          return true;
	        }
	        // Check custom fields
	        for (const cf of (task.custom_fields || [])) {
	          if (cf.value !== undefined && cf.value !== null) {
	            const valStr = String(cf.value).toUpperCase();
	            if (valStr.includes(upperClean) || valStr.includes(upperInvoice)) return true;
	          }
	        }
	        return false;
	      });

	      if (match) {
	        const { task, listName } = match;
	        foundInvoices.push(invoice);

	        // Extract reason if available
	        let reasonText: string | null = null;
	        for (const cf of (task.custom_fields || [])) {
	          if (cf.id === ID_CF_REASON && cf.value !== undefined && cf.value !== null) {
	            const opciones = cf.type_config?.options || [];
	            const val = cf.value;
	            if (typeof val === "number" && val < opciones.length) {
	              reasonText = opciones[val].name;
	            } else if (typeof val === "string") {
	              const optMatch = opciones.find((opt: any) => opt.id === val);
	              if (optMatch) reasonText = optMatch.name;
	            }
	          }
	        }

	        const assignees = (task.assignees || []).map((a: any) => a.username || a.name || a.email || "Usuario");
	        const dueDate = task.due_date ? new Date(parseInt(task.due_date)).toLocaleDateString("es-MX") : null;
	        const dateUpdated = task.date_updated ? new Date(parseInt(task.date_updated)).toLocaleDateString("es-MX") : null;

	        details.push({
	          invoice,
	          exists: true,
	          task: {
	            id: task.id,
	            name: task.name,
	            url: task.url || `https://app.clickup.com/t/${task.id}`,
	            status: task.status?.status || "unknown",
	            statusColor: task.status?.color || "#64748b",
	            listName,
	            listId: task.list?.id,
	            assignees,
	            dueDate,
	            dateUpdated,
	            reason: reasonText
	          }
	        });
	      } else {
	        notFoundInvoices.push(invoice);
	        details.push({
	          invoice,
	          exists: false,
	          task: null
	        });
	      }
	    }

	    return res.json({
	      totalInput: uniqueInvoices.length,
	      foundCount: foundInvoices.length,
	      notFoundCount: notFoundInvoices.length,
	      foundInvoices,
	      notFoundInvoices,
	      details,
	      scopeUsed: scope,
	      totalTasksChecked: allTasksWithList.length
	    });

	  } catch (error: any) {
	    console.error("Error in /api/check-invoices-clickup:", error);
	    return res.status(500).json({ error: error.message || "Error al verificar facturas en ClickUp." });
	  }
	});

	// Catch-all 404 for unmatched API routes to prevent HTML SPA fallback
	app.all("/api/*", (req, res) => {
	  res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
	});

	// Vite Middleware for development / Static Server for production
	async function startServer() {
	  try {
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

		const server = app.listen(PORT, "0.0.0.0", () => {
		  console.log(`🚀 Morena OS Server running on http://localhost:${PORT}`);
		  // Non-blocking background sync from Supabase to local filesystem
		  syncSupabaseToLocal().catch((err) => {
			console.error("[Supabase Background Sync Error]:", err?.message || err);
		  });
		});

		server.on("error", (err: any) => {
		  console.error("Server listen error:", err);
		});
	  } catch (err: any) {
		console.error("Critical error during startServer:", err);
	  }
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
