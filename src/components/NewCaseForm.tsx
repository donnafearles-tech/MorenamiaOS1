import React, { useState, useEffect } from "react";
import sellerOptions from "../data/seller_options.json";
import regionOptions from "../data/Region_options.json";
import storeOptions from "../data/Store_options.json";
import { 
  FileText, 
  User, 
  Phone, 
  Tag, 
  Calendar, 
  DollarSign, 
  Link, 
  MessageSquare, 
  Globe, 
  Sparkles,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Search,
  Settings,
  Key,
  Check
} from "lucide-react";

interface NewCaseFormProps {
  onCaseCreated: () => void;
}

export default function NewCaseForm({ onCaseCreated }: NewCaseFormProps) {
  const [invoice, setInvoice] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("deffective");
  const [saleDate, setSaleDate] = useState("");
  const [contactDate, setContactDate] = useState(new Date().toISOString().split("T")[0]);
  const [amountUsd, setAmountUsd] = useState("");
  const [sharefileLink, setSharefileLink] = useState("");
  const [initialComment, setInitialComment] = useState("");
  const [timezone, setTimezone] = useState("EST");
  const [seller, setSeller] = useState("");
  const [region, setRegion] = useState("");
  const [storeId, setStoreId] = useState("");

  const [clickupTaskId, setClickupTaskId] = useState("");
  const [zendeskTicketId, setZendeskTicketId] = useState("");
  const [email, setEmail] = useState("");
  const [storeLocation, setStoreLocation] = useState("");

  const [loading, setLoading] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  // Citrix ShareFile Auto Fetching States & Logic
  const [isSearchingSharefile, setIsSearchingSharefile] = useState(false);
  const [sharefileError, setSharefileError] = useState<string | null>(null);
  const [sharefileSuccess, setSharefileSuccess] = useState<string | null>(null);
  const [sharefileValidation, setSharefileValidation] = useState<{
    invoice?: boolean;
    saleDate?: boolean;
    storeLocation?: boolean;
  }>({});

  // Dynamic Citrix ShareFile credentials configuration states
  const [showSharefileConfig, setShowSharefileConfig] = useState(false);
  const [configToken, setConfigToken] = useState("");
  const [configBaseUrl, setConfigBaseUrl] = useState("https://morenamiabeautygroup.sf-api.com/sf/v3/");
  
  // New OAuth states
  const [configSubdomain, setConfigSubdomain] = useState("morenamiabeautygroup");
  const [configClientId, setConfigClientId] = useState("");
  const [configClientSecret, setConfigClientSecret] = useState("");
  const [configUsername, setConfigUsername] = useState("");
  const [configPassword, setConfigPassword] = useState("");
  const [configMethod, setConfigMethod] = useState<"oauth" | "token">("oauth");

  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configSaveSuccess, setConfigSaveSuccess] = useState<string | null>(null);
  const [configSaveError, setConfigSaveError] = useState<string | null>(null);
  const [currentConfig, setCurrentConfig] = useState<{ 
    hasToken: boolean; 
    maskedToken: string; 
    baseUrl: string;
    subdomain?: string;
    clientId?: string;
    maskedClientSecret?: string;
    username?: string;
    maskedPassword?: string;
    hasPassword?: boolean;
    isOauthConfigured?: boolean;
  } | null>(null);

  useEffect(() => {
    fetchCurrentConfig();
  }, []);

  const fetchCurrentConfig = async () => {
    try {
      const res = await fetch("/api/sharefile/config");
      const data = await res.json();
      if (data.success) {
        setCurrentConfig(data);
        if (data.baseUrl) {
          setConfigBaseUrl(data.baseUrl);
        }
        if (data.subdomain) {
          setConfigSubdomain(data.subdomain);
        }
        if (data.clientId) {
          setConfigClientId(data.clientId);
        }
        if (data.username) {
          setConfigUsername(data.username);
        }
        if (data.isOauthConfigured) {
          setConfigMethod("oauth");
        } else if (data.hasToken) {
          setConfigMethod("token");
        }
      }
    } catch (e) {
      console.error("Error fetching ShareFile config:", e);
    }
  };

  const handleSaveSharefileConfig = async () => {
    if (configMethod === "token" && !configToken.trim()) {
      setConfigSaveError("El token no puede estar vacío.");
      return;
    }
    if (configMethod === "oauth") {
      if (!configSubdomain.trim()) {
        setConfigSaveError("El subdominio es obligatorio.");
        return;
      }
      if (!configClientId.trim()) {
        setConfigSaveError("El Client ID de Citrix Developer es obligatorio.");
        return;
      }
      if (!configClientSecret.trim()) {
        setConfigSaveError("El Client Secret de Citrix Developer es obligatorio.");
        return;
      }
      if (!configUsername.trim()) {
        setConfigSaveError("El nombre de usuario/correo de Citrix es obligatorio.");
        return;
      }
      if (!configPassword.trim() && !currentConfig?.hasPassword) {
        setConfigSaveError("La contraseña de Citrix es obligatoria.");
        return;
      }
    }

    setIsSavingConfig(true);
    setConfigSaveSuccess(null);
    setConfigSaveError(null);

    try {
      const payload: any = {
        baseUrl: configBaseUrl,
        subdomain: configSubdomain,
        clientId: configClientId,
        clientSecret: configClientSecret,
        username: configUsername,
      };

      if (configMethod === "token") {
        payload.token = configToken;
      } else {
        if (configPassword.trim()) {
          payload.password = configPassword;
        }
      }

      const res = await fetch("/api/sharefile/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        setConfigSaveSuccess("✅ ¡Credenciales reales de Citrix guardadas y verificadas con éxito!");
        setConfigToken(""); // clear token input for security
        setConfigPassword(""); // clear password input for security
        fetchCurrentConfig();
        // Hide config panel after a short delay
        setTimeout(() => {
          setShowSharefileConfig(false);
          setConfigSaveSuccess(null);
        }, 3000);
      } else {
        setConfigSaveError(data.error || "Ocurrió un error al guardar la configuración.");
      }
    } catch (e: any) {
      setConfigSaveError("Error de comunicación con el servidor.");
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleAutoFetchSharefile = async () => {
    const isInvoiceValid = !!invoice && invoice.trim() !== "";
    const isSaleDateValid = !!saleDate && saleDate.trim() !== "";

    setSharefileValidation({
      invoice: isInvoiceValid,
      saleDate: isSaleDateValid,
      storeLocation: true, // Ya no es obligatorio para iniciar la búsqueda
    });

    if (!isInvoiceValid) {
      setSharefileError("⚠️ El Número de Factura (Invoice) es requerido para realizar la búsqueda automática en ShareFile.");
      setSharefileSuccess(null);
      return;
    }

    setIsSearchingSharefile(true);
    setSharefileError(null);
    setSharefileSuccess(null);

    try {
      const response = await fetch(
        `/api/sharefile/items?search=${encodeURIComponent(invoice.trim())}&saleDate=${encodeURIComponent(saleDate.trim())}&storeLocation=${encodeURIComponent(storeLocation.trim())}&clientName=${encodeURIComponent(name.trim())}`
      );
      const data = await response.json();

      if (data.success) {
        if (data.isDemo) {
          setSharefileSuccess(
            `⚠️ Modo de Simulación: Mostrando datos simulados para la factura "${invoice}". El token real de Citrix no está configurado o está inactivo (401).`
          );
          if (data.authError) {
            setSharefileError(
              `⚠️ Citrix API devolvió un código 401 (Error de Autenticación / Token Expirado). Haz clic en 'Configurar API' abajo para ingresar credenciales actualizadas.`
            );
          } else {
            setSharefileError(
              `⚠️ No se pudo conectar de verdad con Citrix API (Error o Falta de credenciales). Haz clic en 'Configurar API' abajo para guardarlas.`
            );
          }
        }

        // First priority: Use server-side computed folder match URL
        if (data.matchedFolderUrl) {
          setSharefileLink(data.matchedFolderUrl);
          
          if (!data.isDemo) {
            if (data.methodUsed === "general_shared_folders_fallback") {
              setSharefileSuccess(
                `📁 No se encontraron carpetas específicas para el invoice "${invoice}". Se vinculó la carpeta principal de ShareFile.`
              );
            } else if (data.methodUsed === "search_relevance_fallback") {
              setSharefileSuccess(
                `📎 Carpeta vinculada por relevancia/resultado de búsqueda en ShareFile: "${data.matchedFolderName || 'Carpeta Encontrada'}"`
              );
            } else if (data.methodUsed && data.methodUsed.includes("date_match")) {
              setSharefileSuccess(
                `✅ ¡Carpeta localizada con éxito! Se validó que contiene el Invoice "${invoice}" y coincide con la Fecha de Venta "${saleDate}".`
              );
            } else {
              setSharefileSuccess(
                `📎 Carpeta vinculada para el Invoice "${invoice}".`
              );
            }
          }
        } else if (data.items && data.items.length > 0) {
          // Fallback client-side matching if server didn't output a direct match
          // Helper to check if an item is a folder
          const checkIfFolder = (item: any) => {
            const typeStr = String(item["odata.type"] || item.typename || item.type || "").toLowerCase();
            return (
              typeStr.includes("folder") ||
              item.FileCount !== undefined ||
              item.fileCount !== undefined ||
              item.FolderCount !== undefined ||
              item.folderCount !== undefined
            );
          };

          // Blacklist specific folder requested by user (6b2509-a991-44b8-ad3c-9487044e1a1b, 9c5582-8d50-4b3e-b804-8c515257a597 and 1c26e6-259d-44aa-a7b6-ef411e0a51cf)
          const isBlacklistedId = (id: string) => {
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

          const filteredItems = (data.items || []).filter((item: any) => {
            const itemId = item.Id || item.id || "";
            const parentId = item.ParentId || item.parentId || "";
            return !isBlacklistedId(itemId) && !isBlacklistedId(parentId);
          });

          // 1. Separate search results into folders and files
          const folders = filteredItems.filter((item: any) => checkIfFolder(item));
          const files = filteredItems.filter((item: any) => !checkIfFolder(item));

          // Robust helper to check if item creation date matches the saleDate (allowing for +/- 1 day to handle timezone offsets)
          const matchesDateFilter = (item: any, targetDate: string) => {
            if (!targetDate) return true;
            
            // Extract date string from various possible fields
            const dateStr = item.CreationDate || item.ClientCreatedDate || item.CreatedDate || 
                            item.creationDate || item.createdDate || item.Created || item.created || "";
            if (dateStr) {
              const dateOnly = dateStr.substring(0, 10); // YYYY-MM-DD
              if (dateOnly === targetDate) return true;
              
              // Timezone correction check: allow up to 30 hours difference to account for any timezone mismatch
              try {
                const itemTime = new Date(dateStr).getTime();
                const targetTime = new Date(targetDate + "T12:00:00").getTime(); // midday on target date
                const diffHours = Math.abs(itemTime - targetTime) / (1000 * 60 * 60);
                if (diffHours <= 30) return true; 
              } catch (e) {}
            }
            
            // Check if the item name or path contains the target date in different formats
            const itemName = (item.Name || "").toLowerCase();
            const itemPath = (item.Path || "").toLowerCase();
            const cleanTargetDate = targetDate.replace(/-/g, "");
            const targetDateUnderscore = targetDate.replace(/-/g, "_");
            
            if (
              itemName.includes(targetDate) || 
              itemName.includes(cleanTargetDate) || 
              itemName.includes(targetDateUnderscore) ||
              itemPath.includes(targetDate) ||
              itemPath.includes(cleanTargetDate) ||
              itemPath.includes(targetDateUnderscore)
            ) {
              return true;
            }
            
            return false;
          };

          let chosenFolderId = null;
          let matchingItem = null;
          let methodUsed = "";

          const cleanInvoice = invoice.trim().toLowerCase();
          const cleanSaleDate = saleDate.trim();

          // Scoring system to rank all search result candidates (not restrictive)
          const getItemScore = (item: any) => {
            let score = 0;
            const itemName = (item.Name || item.name || "").toLowerCase();
            const parentName = (item.ParentName || item.parentName || "").toLowerCase();
            const itemPath = (item.Path || item.path || "").toLowerCase();
            const isFolder = checkIfFolder(item);

            // 1. Invoice Match
            const hasInvoice = itemName.includes(cleanInvoice) || 
                              itemName.replace(/[^a-z0-9]/g, "").includes(cleanInvoice.replace(/[^a-z0-9]/g, ""));
            if (hasInvoice) {
              score += 150;
              // Extra points if it's a file (often the actual receipt image)
              if (!isFolder) {
                score += 30;
                // Extra points if it is specifically an image to prioritize receipt JPGs
                if (itemName.endsWith(".jpg") || itemName.endsWith(".jpeg") || itemName.endsWith(".png")) {
                  score += 50;
                }
              } else {
                score += 20; // Direct invoice folder is also great
              }
            }

            // 2. Date Match (saleDate)
            if (cleanSaleDate) {
              if (matchesDateFilter(item, cleanSaleDate)) {
                score += 100;
              }
            }

            // 3. Store Location Match (storeLocation)
            if (storeLocation) {
              const loc = String(storeLocation).trim().toLowerCase();
              if (loc && (parentName.includes(loc) || itemPath.includes(loc) || itemName.includes(loc))) {
                score += 120;
              }
            }

            // 4. Client Name Match
            if (name) {
              const firstPart = name.trim().split(" ")[0].toLowerCase();
              if (firstPart.length > 2) {
                if (itemName.includes(firstPart) || parentName.includes(firstPart)) {
                  score += 30;
                }
              }
            }

            return score;
          };

          const sortedCandidates = [...filteredItems]
            .map(item => ({ item, score: getItemScore(item) }))
            .filter(cand => cand.score > 0)
            .sort((a, b) => b.score - a.score);

          const best = sortedCandidates[0];
          if (best) {
            const isFolder = checkIfFolder(best.item);
            chosenFolderId = isFolder ? (best.item.Id || best.item.id) : (best.item.ParentId || best.item.parentId || best.item.Id || best.item.id);
            matchingItem = best.item;
            methodUsed = isFolder ? "scored_direct_folder_match" : "scored_parent_folder_via_file_match";
          }

          if (!chosenFolderId) {
            setSharefileLink("");
            setSharefileError(
              `⚠️ No se encontró ninguna carpeta específica que coincida con el invoice "${invoice}" o el cliente "${name}". Por favor, introduce el link manualmente.`
            );
            return;
          }

          // Usar la carpeta de coincidencia directa seleccionada
          let finalFolderId = chosenFolderId;
          let deepMatchMessage = "";

          const subdomain = data.subdomain || "morenamiabeautygroup";
          const folderId = finalFolderId.startsWith("fo") ? finalFolderId : `fo${finalFolderId}`;
          const sharefileWebUrl = `https://${subdomain.toLowerCase()}.sharefile.com/home/shared/${folderId}`;
          setSharefileLink(sharefileWebUrl);
          
          if (!data.isDemo) {
            if (methodUsed.includes("date_match")) {
              setSharefileSuccess(
                `✅ ¡Carpeta localizada con éxito! Se validó que contiene el Invoice "${invoice}" y coincide con la Fecha de Venta "${saleDate}".${deepMatchMessage}`
              );
            } else if (methodUsed.includes("name_match")) {
              setSharefileSuccess(
                `📎 Carpeta vinculada por coincidencia con el cliente: "${matchingItem?.Name || 'Carpeta Encontrada'}"${deepMatchMessage}`
              );
            } else {
              setSharefileSuccess(
                `📎 Carpeta vinculada para el Invoice "${invoice}".${deepMatchMessage}`
              );
            }
          }
        } else {
          // data.items is empty
          setSharefileLink("");
          setSharefileError(
            `⚠️ No se encontraron resultados de búsqueda para el invoice "${invoice}".`
          );
        }
      } else {
        const errorMsg = data.error || "Token inválido o expirado.";
        setSharefileError(`❌ Error de Citrix ShareFile (Código ${response.status}): ${errorMsg}`);
      }
    } catch (error: any) {
      console.error("Error fetching ShareFile item:", error);
      setSharefileError("❌ Error de conexión al intentar comunicarse con el servidor de ShareFile.");
    } finally {
      setIsSearchingSharefile(false);
    }
  };

  // Timezones and their descriptions
  const timezones = [
    { code: "NST", label: "NST (Canada / Newfoundland)" },
    { code: "AST", label: "AST (Puerto Rico / Atlantic)" },
    { code: "EST", label: "EST (Costa Este / NY / Miami)" },
    { code: "CST", label: "CST (Centro / Texas / Chicago)" },
    { code: "MST", label: "MST (Montaña / Denver)" },
    { code: "PHX", label: "PHX (Arizona - No DST)" },
    { code: "PST", label: "PST (Pacífico / LA / Las Vegas)" },
    { code: "AKST", label: "AKST (Alaska)" },
    { code: "HST", label: "HST (Hawái)" }
  ];

  // Reasons list (Spanish friendly with internal keys)
  const reasonKeys = [
    { key: "deffective", label: "deffective / Dañado" },
    { key: "charge", label: "charge / Queja Cobro" },
    { key: "wrong product", label: "wrong product / Surtido Erróneo" },
    { key: "taxes", label: "taxes / falta devolucion de Taxes" },
    { key: "amount not agreed", label: "amount not agreed" },
    { key: "gbk", label: "GBK (Reembolso de Impuestos / Tax Refund)" },
    { key: "instructions", label: "instructions / Dudas" },
    { key: "shalem", label: "Shalem (Plan de Pagos / Cuotas)" },
    { key: "shippings", label: "shippings de Envío / Guía" },
    { key: "reaction", label: "reaction / Dermatitis" },
    { key: "first sale refund", label: "First Sale Refund (Garantía de Compra)" },
    { key: "missing product", label: "missing product" },
    { key: "sales person misinformed", label: "sales person misinformed / Promesa" },
    { key: "regret", label: "regret / Cancelación" },
    { key: "unkowns", label: "Caso Atípico / Desconocido" },
    { key: "no results", label: "Sin Resultados / No le gustó" }
  ];

  const sortedSellers = [...sellerOptions.options].sort((a, b) => a.name.localeCompare(b.name));
  const sortedRegions = [...regionOptions.options].sort((a, b) => a.name.localeCompare(b.name));
  const sortedStores = [...storeOptions.options].sort((a, b) => a.name.localeCompare(b.name));

  // Automatic Timezone Detector based on US Phone Area Code
  useEffect(() => {
    // Strip non-numeric characters
    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.length >= 3) {
      const areaCode = cleanPhone.substring(0, 3);
      
      const estCodes = ["305", "786", "212", "718", "315", "516", "631", "914", "201", "973", "551", "908", "609", "856", "215", "267", "484", "610", "302", "410", "443", "667", "202", "703", "571", "804", "757", "276", "540", "434", "304", "681", "240", "301", "407", "321", "904", "352", "813", "727", "941", "239", "561", "954", "754", "772", "850", "404", "770", "678", "470", "706", "762", "912", "229", "478", "334", "205", "256", "938", "251", "207", "603", "802", "413", "508", "774", "978", "351", "401", "203", "860", "585", "716", "607", "814", "412", "724", "878", "570", "272"];
      const cstCodes = ["312", "773", "847", "224", "630", "331", "708", "815", "779", "309", "618", "217", "219", "574", "260", "317", "765", "812", "930", "414", "262", "608", "920", "715", "534", "612", "651", "952", "763", "218", "320", "507", "319", "515", "641", "712", "563", "314", "636", "816", "913", "785", "316", "620", "228", "601", "769", "662", "504", "985", "225", "318", "337"];
      const mstCodes = ["303", "720", "970", "719", "801", "385", "435", "505", "575", "208", "986", "307", "406", "605", "701"];
      const phxCodes = ["480", "602", "623", "520", "928"];
      const pstCodes = ["213", "310", "424", "323", "562", "626", "818", "747", "661", "909", "951", "714", "657", "949", "858", "619", "760", "442", "805", "415", "628", "510", "925", "408", "669", "650", "707", "916", "530", "209", "559", "831", "206", "509", "253", "425", "360", "360", "503", "971", "541", "458", "702", "775"];
      const akstCodes = ["907"];
      const hstCodes = ["808"];
      const astCodes = ["787", "939"];
      const nstCodes = ["709"];

      if (estCodes.includes(areaCode)) setTimezone("EST");
      else if (cstCodes.includes(areaCode)) setTimezone("CST");
      else if (mstCodes.includes(areaCode)) setTimezone("MST");
      else if (phxCodes.includes(areaCode)) setTimezone("PHX");
      else if (pstCodes.includes(areaCode)) setTimezone("PST");
      else if (akstCodes.includes(areaCode)) setTimezone("AKST");
      else if (hstCodes.includes(areaCode)) setTimezone("HST");
      else if (astCodes.includes(areaCode)) setTimezone("AST");
      else if (nstCodes.includes(areaCode)) setTimezone("NST");
    }
  }, [phone]);

  const handleSubmit = async (e?: React.FormEvent, createZendesk: boolean = false) => {
    if (e) e.preventDefault();
    if (!invoice || !name || !initialComment) {
      alert("Por favor completa los campos requeridos: Factura, Nombre de cliente y Comentario Inicial.");
      return;
    }

    setLoading(true);
    setCreatedUrl(null);

    try {
      const zapierToken = localStorage.getItem("ZAPIER_MCP_TOKEN") || "";
      const res = await fetch("/api/create-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice,
          name,
          phone,
          reason,
          sale_date: saleDate,
          contact_date: contactDate,
          amount_usd: amountUsd,
          sharefile_link: sharefileLink,
          initial_comment: initialComment,
          timezone,
          clickup_task_id: clickupTaskId,
          zendesk_ticket_id: zendeskTicketId,
          email,
          store_location: storeLocation,
          zapier_token: zapierToken,
          seller_id: seller,
          region_id: region,
          store_id: storeId,
          create_zendesk: createZendesk
        })
      });

      const data = await res.json();
      if (res.ok) {
        setCreatedUrl(data.task_url);
        // Reset form
        setInvoice("");
        setName("");
        setPhone("");
        setAmountUsd("");
        setSharefileLink("");
        setInitialComment("");
        setClickupTaskId("");
        setZendeskTicketId("");
        setEmail("");
        setStoreLocation("");
        setSeller("");
        setRegion("");
        setStoreId("");
        onCaseCreated();
      } else {
        alert(`Error al registrar el caso: ${data.error || "Ocurrió un error"}`);
      }
    } catch (err: any) {
      alert(`Error de red: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Render conditional warnings based on selected reason
  const renderReasonWarning = () => {
    switch (reason) {
      case "gbk":
        return (
          <div className="flex gap-2.5 items-start bg-amber-500/10 border border-amber-500/20 text-amber-300 p-4 rounded-xl text-xs">
            <AlertTriangle className="w-4.5 h-4.5 text-amber-500 shrink-0" />
            <p className="leading-relaxed">
              <strong>Procedimiento GBK:</strong> Asegúrate de verificar que el cliente no tenga más de 60 días desde la compra para solicitar reembolso de impuestos. Se requiere adjuntar ID y comprobante de impuestos.
            </p>
          </div>
        );
      case "deffective":
      case "deffective device":
        return (
          <div className="flex gap-2.5 items-start bg-rose-500/10 border border-rose-500/20 text-rose-300 p-4 rounded-xl text-xs">
            <AlertTriangle className="w-4.5 h-4.5 text-rose-500 shrink-0" />
            <p className="leading-relaxed">
              <strong>Garantía de Defecto:</strong> Es requisito mandatorio solicitar fotos y/o video al cliente antes de autorizar el reenvío o reembolso del producto defectuoso.
            </p>
          </div>
        );
      case "shalem":
        return (
          <div className="flex gap-2.5 items-start bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 p-4 rounded-xl text-xs">
            <AlertTriangle className="w-4.5 h-4.5 text-cyan-500 shrink-0" />
            <p className="leading-relaxed">
              <strong>Plan Shalem:</strong> Verifica el saldo adeudado y estado de pagos en la pasarela de pagos antes de proceder con modificaciones del caso.
            </p>
          </div>
        );
      case "first sale refund":
        return (
          <div className="flex gap-2.5 items-start bg-purple-500/10 border border-purple-500/20 text-purple-300 p-4 rounded-xl text-xs">
            <AlertTriangle className="w-4.5 h-4.5 text-purple-400 shrink-0" />
            <p className="leading-relaxed">
              <strong>First Sale Refund:</strong> Valida que esta compra califique exactamente para la campaña promocional y que el cliente haya seguido los pasos descritos para la garantía.
            </p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-fade-in">
      
      {/* Form Header */}
      <div className="glass-card p-6 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold font-serif tracking-tight text-white mb-1">Registrar Nuevo Caso</h2>
          <p className="text-sm text-white/70 font-sans">
            Completa la ficha en español. Donna se encargará de traducirla, formatearla e ingresarla a ClickUp.
          </p>
        </div>
        <div className="w-12 h-12 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white shadow-[0_4px_12px_rgba(255,255,255,0.05)]">
          <FileText className="w-6 h-6" />
        </div>
      </div>

      {/* Warning notices */}
      {renderReasonWarning()}

      {/* Success Banner */}
      {createdUrl && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 p-5 rounded-2xl flex items-center justify-between text-emerald-200 backdrop-blur-md animate-pulse">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5.5 h-5.5 text-emerald-400" />
            <div>
              <p className="text-sm font-bold">¡Caso registrado con éxito en ClickUp!</p>
              <p className="text-xs text-white/60 mt-0.5">Se ha asignado a Donna para el seguimiento automático diario.</p>
            </div>
          </div>
          <a
            href={createdUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-white/10 text-white border border-white/20 rounded-xl text-xs font-bold hover:bg-white/20 transition-all flex items-center gap-1.5"
          >
            Ver en ClickUp <Link className="w-3.5 h-3.5" />
          </a>
        </div>
      )}

      {/* Main Registration Form */}
      <form onSubmit={handleSubmit} className="glass-card p-8 space-y-6">
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Factura / Invoice */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white/70 uppercase flex items-center gap-2">
              <Tag className="w-3.5 h-3.5 text-white/80" /> Número de Factura / Invoice <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              placeholder="Ej. M10025"
              value={invoice}
              onChange={(e) => {
                setInvoice(e.target.value);
                if (sharefileValidation.invoice !== undefined) {
                  setSharefileValidation(prev => ({ ...prev, invoice: e.target.value.trim() !== "" }));
                }
              }}
              className={`w-full bg-white/5 border ${
                sharefileValidation.invoice === false
                  ? "border-rose-500 ring-2 ring-rose-500/20"
                  : "border-white/15 focus:border-white/35"
              } rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 transition-all focus:outline-none`}
              required
            />
            {sharefileValidation.invoice === false && (
              <span className="text-rose-400 text-[10px] font-sans font-medium block">
                ⚠️ Se requiere número de factura para buscar en ShareFile.
              </span>
            )}
          </div>

          {/* ID de Tarea ClickUp */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white/70 uppercase flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-white/80" /> ID de Tarea ClickUp <span className="text-white/40 text-[10px]">(Opcional - para actualizar existente)</span>
            </label>
            <input
              type="text"
              placeholder="Ej. 8687abcde"
              value={clickupTaskId}
              onChange={(e) => setClickupTaskId(e.target.value)}
              className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:bg-white/10 focus:border-white/35 transition-all focus:outline-none"
            />
          </div>

          {/* ID de Ticket Zendesk */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white/70 uppercase flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-white/80" /> ID de Ticket Zendesk <span className="text-white/40 text-[10px]">(Opcional - para asociar existente)</span>
            </label>
            <input
              type="text"
              placeholder="Ej. 123456"
              value={zendeskTicketId}
              onChange={(e) => setZendeskTicketId(e.target.value)}
              className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:bg-white/10 focus:border-white/35 transition-all focus:outline-none"
            />
          </div>

          {/* Nombre Cliente */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white/70 uppercase flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-white/80" /> Nombre del Cliente <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              placeholder="Ej. Marie Antoinette"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:bg-white/10 focus:border-white/35 transition-all focus:outline-none"
              required
            />
          </div>

          {/* Email Cliente */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white/70 uppercase flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-white/80" /> Email del Cliente <span className="text-white/40 text-[10px]">(Para crear ticket en Zendesk)</span>
            </label>
            <input
              type="email"
              placeholder="Ej. marie@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:bg-white/10 focus:border-white/35 transition-all focus:outline-none"
            />
          </div>

          {/* Teléfono */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white/70 uppercase flex items-center gap-2">
              <Phone className="w-3.5 h-3.5 text-white/80" /> Teléfono del Cliente
            </label>
            <input
              type="text"
              placeholder="Ej. (305) 555-0199"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:bg-white/10 focus:border-white/35 transition-all focus:outline-none"
            />
            <span className="text-[10px] text-white/45 font-mono tracking-wide block">
              💡 Se detectará automáticamente el huso horario por código de área estadounidense.
            </span>
          </div>

          {/* Región / Region */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white/70 uppercase flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-white/80" /> Región / Region
            </label>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-sm text-white focus:bg-white/10 focus:border-white/35 transition-all focus:outline-none [&>option]:bg-slate-900"
            >
              <option value="">-- Seleccionar Región / Region --</option>
              {sortedRegions.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>

          {/* Store / Location / Class */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white/70 uppercase flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-white/80" /> Store / Location / Class
            </label>
            <select
              value={storeId}
              onChange={(e) => {
                const selectedStoreId = e.target.value;
                setStoreId(selectedStoreId);
                const matchedOpt = storeOptions.options.find(s => s.id === selectedStoreId);
                const matchedName = matchedOpt ? matchedOpt.name : "";
                setStoreLocation(matchedName);
                if (sharefileValidation.storeLocation !== undefined) {
                  setSharefileValidation(prev => ({ ...prev, storeLocation: matchedName.trim() !== "" }));
                }
              }}
              className={`w-full bg-white/5 border ${
                sharefileValidation.storeLocation === false
                  ? "border-rose-500 ring-2 ring-rose-500/20"
                  : "border-white/15 focus:border-white/35"
              } rounded-xl px-4 py-3 text-sm text-white transition-all focus:outline-none [&>option]:bg-slate-900`}
            >
              <option value="">-- Seleccionar Store / Location / Class --</option>
              {sortedStores.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {sharefileValidation.storeLocation === false && (
              <span className="text-rose-400 text-[10px] font-sans font-medium block">
                ⚠️ Se requiere seleccionar la sucursal para validar la carpeta de ShareFile.
              </span>
            )}
          </div>

          {/* Motivo / Reason */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white/70 uppercase flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-white/80" /> Motivo del Reclamo <span className="text-rose-400">*</span>
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-sm text-white focus:bg-white/10 focus:border-white/35 transition-all focus:outline-none [&>option]:bg-slate-900"
            >
              {reasonKeys.map(r => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
          </div>

          {/* Huso Horario */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white/70 uppercase flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-white/80" /> Huso Horario de Seguimiento
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-sm text-white focus:bg-white/10 focus:border-white/35 transition-all focus:outline-none [&>option]:bg-slate-900"
            >
              {timezones.map(tz => (
                <option key={tz.code} value={tz.code}>{tz.label}</option>
              ))}
            </select>
          </div>

          {/* Fecha Venta */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white/70 uppercase flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-white/80" /> Fecha de Venta
            </label>
            <input
              type="date"
              value={saleDate}
              onChange={(e) => {
                setSaleDate(e.target.value);
                if (sharefileValidation.saleDate !== undefined) {
                  setSharefileValidation(prev => ({ ...prev, saleDate: e.target.value.trim() !== "" }));
                }
              }}
              className={`w-full bg-white/5 border ${
                sharefileValidation.saleDate === false
                  ? "border-rose-500 ring-2 ring-rose-500/20"
                  : "border-white/15 focus:border-white/35"
              } rounded-xl px-4 py-3 text-sm font-mono text-white transition-all focus:outline-none`}
            />
            {sharefileValidation.saleDate === false && (
              <span className="text-rose-400 text-[10px] font-sans font-medium block">
                ⚠️ Se requiere la fecha de venta para validar los archivos de ShareFile.
              </span>
            )}
          </div>

          {/* Fecha Contacto */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white/70 uppercase flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-white/80" /> Fecha Primer Contacto
            </label>
            <input
              type="date"
              value={contactDate}
              onChange={(e) => setContactDate(e.target.value)}
              className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-sm font-mono text-white focus:bg-white/10 focus:border-white/35 transition-all focus:outline-none"
            />
          </div>

          {/* Monto USD */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white/70 uppercase flex items-center gap-2">
              <DollarSign className="w-3.5 h-3.5 text-white/80" /> Monto Total Venta (USD)
            </label>
            <input
              type="number"
              placeholder="Ej. 195.50"
              value={amountUsd}
              onChange={(e) => setAmountUsd(e.target.value)}
              className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-sm font-mono text-white placeholder-white/30 focus:bg-white/10 focus:border-white/35 transition-all focus:outline-none"
            />
          </div>

          {/* Vendedor / Seller */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-white/70 uppercase flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-white/80" /> Vendedor / Seller
            </label>
            <select
              value={seller}
              onChange={(e) => setSeller(e.target.value)}
              className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-sm text-white focus:bg-white/10 focus:border-white/35 transition-all focus:outline-none [&>option]:bg-slate-900"
            >
              <option value="">-- Seleccionar Vendedor --</option>
              {sortedSellers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>


        </div>

        {/* Sharefile Link */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="text-xs font-bold text-white/70 uppercase flex items-center gap-2">
              <Link className="w-3.5 h-3.5 text-white/80" /> Enlace de Sharefile / Documentación
            </label>
            <button
              type="button"
              onClick={() => {
                setShowSharefileConfig(!showSharefileConfig);
                setConfigSaveSuccess(null);
                setConfigSaveError(null);
              }}
              className="text-[10px] text-white/60 hover:text-white flex items-center gap-1 transition-colors cursor-pointer bg-white/5 border border-white/10 rounded-lg px-2.5 py-1"
              title="Configurar credenciales reales de ShareFile"
            >
              <Settings className="w-3 h-3" />
              <span>Configurar API</span>
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="url"
              placeholder="Ej. https://sharefile.com/d/s123abc"
              value={sharefileLink}
              onChange={(e) => setSharefileLink(e.target.value)}
              className="flex-1 bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:bg-white/10 focus:border-white/35 transition-all focus:outline-none"
            />
            <button
              type="button"
              onClick={handleAutoFetchSharefile}
              disabled={isSearchingSharefile}
              className="px-5 bg-white/10 hover:bg-white/15 border border-white/15 text-white disabled:opacity-50 rounded-xl text-xs font-bold tracking-wide transition-all cursor-pointer flex items-center gap-2"
              title="Buscar carpeta automáticamente en ShareFile usando el Invoice"
            >
              {isSearchingSharefile ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
              ) : (
                <Search className="w-3.5 h-3.5 text-white" />
              )}
              <span className="hidden sm:inline">Buscar Carpeta</span>
            </button>
          </div>

          {/* Collapsible Citrix ShareFile Credentials Manager */}
          {showSharefileConfig && (
            <div className="mt-2.5 p-4 bg-slate-950/90 border border-white/10 rounded-xl space-y-4 shadow-2xl transition-all">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-emerald-400 animate-pulse" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Conexión Citrix ShareFile Real</span>
                </div>
                <div className="flex gap-1 bg-white/5 p-0.5 rounded-lg border border-white/10">
                  <button
                    type="button"
                    onClick={() => setConfigMethod("oauth")}
                    className={`px-2 py-1 rounded text-[9px] font-bold uppercase transition-all cursor-pointer ${configMethod === "oauth" ? "bg-emerald-500 text-slate-950" : "text-white/60 hover:text-white"}`}
                  >
                    Automático (OAuth)
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfigMethod("token")}
                    className={`px-2 py-1 rounded text-[9px] font-bold uppercase transition-all cursor-pointer ${configMethod === "token" ? "bg-emerald-500 text-slate-950" : "text-white/60 hover:text-white"}`}
                  >
                    Manual (JWT)
                  </button>
                </div>
              </div>

              {configMethod === "oauth" ? (
                <div className="space-y-3">
                  <p className="text-[10px] text-white/50 leading-relaxed">
                    La autenticación automática utiliza tus credenciales para renovar el token automáticamente y evitar bloqueos por expiración de 401.
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-white/55 uppercase block">
                        Subdominio de ShareFile
                      </label>
                      <input
                        type="text"
                        placeholder="Ej. morenamiabeautygroup"
                        value={configSubdomain}
                        onChange={(e) => setConfigSubdomain(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:bg-white/10 focus:border-white/20 transition-all focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-white/55 uppercase block">
                        Username / Correo Citrix
                      </label>
                      <input
                        type="email"
                        placeholder="ejemplo@correo.com"
                        value={configUsername}
                        onChange={(e) => setConfigUsername(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:bg-white/10 focus:border-white/20 transition-all focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-white/55 uppercase block">
                        Citrix Client ID
                      </label>
                      <input
                        type="text"
                        placeholder="Pega tu Client ID..."
                        value={configClientId}
                        onChange={(e) => setConfigClientId(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-white/20 focus:bg-white/10 focus:border-white/20 transition-all focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-white/55 uppercase block">
                        Citrix Client Secret
                      </label>
                      <input
                        type="password"
                        placeholder={currentConfig?.maskedClientSecret ? "••••••••" : "Pega tu Client Secret..."}
                        value={configClientSecret}
                        onChange={(e) => setConfigClientSecret(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-white/20 focus:bg-white/10 focus:border-white/20 transition-all focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-white/55 uppercase block">
                      Contraseña de Citrix
                    </label>
                    <input
                      type="password"
                      placeholder={currentConfig?.hasPassword ? "Contraseña guardada (deja en blanco para mantener)" : "Ingresa tu contraseña de Citrix..."}
                      value={configPassword}
                      onChange={(e) => setConfigPassword(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:bg-white/10 focus:border-white/20 transition-all focus:outline-none"
                    />
                  </div>
                  
                  {currentConfig?.isOauthConfigured && (
                    <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <p className="text-[9px] text-emerald-400 font-medium">
                        ¡Listo! El sistema tiene credenciales de OAuth configuradas y renovará tus tokens de forma transparente.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-white/55 uppercase block">
                      SHAREFILE ACCESS TOKEN (OAuth / JWT)
                    </label>
                    <textarea
                      placeholder="Pega el nuevo Token de Acceso JWT obtenido desde tu Citrix ShareFile..."
                      value={configToken}
                      onChange={(e) => setConfigToken(e.target.value)}
                      rows={2}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-white/20 focus:bg-white/10 focus:border-white/20 transition-all focus:outline-none"
                    />
                    {currentConfig?.hasToken && (
                      <p className="text-[10px] text-emerald-400/80 font-mono">
                        Token actual: <span className="bg-white/5 px-1 py-0.5 rounded">{currentConfig.maskedToken}</span>
                      </p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-white/55 uppercase block">
                      SHAREFILE API BASE URL
                    </label>
                    <input
                      type="text"
                      placeholder="https://morenamiabeautygroup.sf-api.com/sf/v3/"
                      value={configBaseUrl}
                      onChange={(e) => setConfigBaseUrl(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono focus:bg-white/10 focus:border-white/20 transition-all focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowSharefileConfig(false)}
                  className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/70 rounded-lg text-[11px] font-medium transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveSharefileConfig}
                  disabled={isSavingConfig}
                  className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 disabled:opacity-50 shadow-md shadow-emerald-500/10"
                >
                  {isSavingConfig ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Check className="w-3 h-3" />
                  )}
                  Conectar de Verdad
                </button>
              </div>

              {configSaveSuccess && (
                <p className="text-xs text-emerald-400 font-sans mt-1">
                  {configSaveSuccess}
                </p>
              )}
              {configSaveError && (
                <p className="text-xs text-rose-400 font-sans mt-1">
                  {configSaveError}
                </p>
              )}
            </div>
          )}

          {sharefileSuccess && (
            <p className="text-xs text-emerald-400 font-medium font-sans mt-1 animate-pulse">
              {sharefileSuccess}
            </p>
          )}
          {sharefileError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl mt-1 space-y-2">
              <p className="text-xs text-rose-400 font-medium font-sans">
                {sharefileError}
              </p>
              {sharefileError.includes("401") && (
                <button
                  type="button"
                  onClick={() => {
                    setShowSharefileConfig(true);
                    setConfigSaveSuccess(null);
                    setConfigSaveError(null);
                  }}
                  className="px-3 py-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Key className="w-3.5 h-3.5" />
                  <span>Actualizar Token de ShareFile</span>
                </button>
              )}
            </div>
          )}
          <p className="text-[10px] text-white/40 font-sans mt-1">
            Ingresa el número de factura arriba y haz clic en "Buscar Carpeta" para vincular automáticamente la carpeta de Citrix ShareFile.
          </p>
        </div>

        {/* Comentario Inicial */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-white/70 uppercase flex items-center gap-2">
            <MessageSquare className="w-3.5 h-3.5 text-white/80" /> Comentario Inicial de Atención <span className="text-rose-400">*</span>
          </label>
          <textarea
            placeholder="Escribe el resumen del caso en español tal como te lo reportó el cliente... Ej. El cliente llamó sumamente molesto porque el producto llegó dañado o no funciona correctamente..."
            value={initialComment}
            onChange={(e) => setInitialComment(e.target.value)}
            rows={5}
            className="w-full bg-white/5 border border-white/15 rounded-xl p-4 text-sm text-white placeholder-white/30 focus:bg-white/10 focus:border-white/35 transition-all focus:outline-none font-sans leading-relaxed"
            required
          />
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-end pt-4">
          <button
            type="button"
            disabled={loading}
            onClick={() => handleSubmit(undefined, false)}
            className="w-full sm:w-auto px-6 py-3.5 bg-white/10 hover:bg-white/15 border border-white/15 hover:border-white/25 text-white disabled:opacity-50 rounded-xl text-sm font-bold tracking-wide transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin text-white" />
            ) : (
              <CheckCircle className="w-4.5 h-4.5 text-white/90" />
            )}
            Registrar en ClickUp
          </button>
          
          <button
            type="button"
            disabled={loading}
            onClick={() => handleSubmit(undefined, true)}
            className="w-full sm:w-auto px-8 py-3.5 bg-white hover:bg-white/90 text-slate-950 disabled:opacity-50 rounded-xl text-sm font-bold tracking-wide shadow-lg hover:shadow-[0_4px_20px_rgba(255,255,255,0.25)] transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" /> Procesando...
              </>
            ) : (
              <>
                <CheckCircle className="w-4.5 h-4.5 text-slate-950" /> Crear en Zendesk y ClickUp
              </>
            )}
          </button>
        </div>

      </form>
    </div>
  );
}
