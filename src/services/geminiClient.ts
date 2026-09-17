import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import os from "os";

// Helper para asegurar que si el JSON se pegó en Secrets o variables, se cree la credencial de Service Account
function ensureServiceAccountAuth() {
  const tmpPath = path.join(os.tmpdir(), "gcp-service-account.json");

  // 1. Si GOOGLE_APPLICATION_CREDENTIALS apunta a una ruta no existente, limpiarla
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    if (!fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      console.warn(`[Vertex AI] Ruta GOOGLE_APPLICATION_CREDENTIALS "${process.env.GOOGLE_APPLICATION_CREDENTIALS}" no existe en el contenedor. Descartándola...`);
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
  }

  // 2. Si GOOGLE_SERVICE_ACCOUNT_JSON está disponible, validar y escribir el archivo temporal si es necesario
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON.trim().replace(/^["']+|["']+$/g, "").trim();
      const parsed = JSON.parse(raw);
      if (parsed && parsed.type === "service_account" && parsed.project_id) {
        fs.writeFileSync(tmpPath, JSON.stringify(parsed, null, 2), "utf-8");
        process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
        return;
      }
    } catch (err: any) {
      console.warn("[Vertex AI] GOOGLE_SERVICE_ACCOUNT_JSON no pudo parsearse como JSON válido:", err.message);
    }
  }

  // 3. Si el archivo temporal ya existe y es válido, usarlo
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(tmpPath)) {
    try {
      const content = fs.readFileSync(tmpPath, "utf-8");
      const parsed = JSON.parse(content);
      if (parsed && parsed.type === "service_account") {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
      }
    } catch {}
  }
}

export function getVertexClient(): GoogleGenAI {
  ensureServiceAccountAuth();
  const project = process.env.GOOGLE_CLOUD_PROJECT || "mis-app-258d2";
  const location = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
  return new GoogleGenAI({
    vertexai: true,
    project,
    location,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

let genAIClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!genAIClient) {
    ensureServiceAccountAuth();

    const project = process.env.GOOGLE_CLOUD_PROJECT;
    const location = process.env.GOOGLE_CLOUD_LOCATION || "global";
    const apiKey = process.env.GEMINI_API_KEY;

    if (project) {
      genAIClient = getVertexClient();
    } else if (apiKey) {
      genAIClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    } else {
      genAIClient = new GoogleGenAI({
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }
  }
  return genAIClient;
}

