/**
 * Servicio de Integración de Citrix ShareFile con Estrategia de Búsqueda de 2 Consultas
 * 
 * Este módulo implementa la lógica de localización quirúrgica y listado directo
 * para asociar registros con sus facturas digitales (JPG/PDF) y carpetas en ShareFile.
 */

/**
 * Normaliza nombres de archivos y carpetas para realizar coincidencias flexibles.
 * Remueve acentos, convierte a minúsculas y elimina caracteres especiales.
 */
export function normalizeNameForFlexibleMatch(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remueve acentos / diacríticos
    .replace(/[^a-z0-9]/g, " ")     // Reemplaza caracteres especiales con espacios
    .replace(/\s+/g, " ")           // Colapsa múltiples espacios
    .trim();
}

export interface ShareFileItem {
  Id: string;
  id: string;
  Name: string;
  name: string;
  ParentId?: string;
  parentId?: string;
  ParentName?: string;
  parentName?: string;
  "odata.type"?: string;
  typename?: string;
  type?: string;
  FileCount?: number;
  fileCount?: number;
  FileSizeBytes?: number;
  fileSizeBytes?: number;
  size?: number;
  CreationDate?: string;
  creationDate?: string;
  Path?: string;
  path?: string;
}

export interface SearchResult {
  success: boolean;
  isDemo: boolean;
  items: ShareFileItem[];
  matchedFolderId: string | null;
  matchedFolderUrl: string | null;
  matchedFolderName: string | null;
  methodUsed: string;
  warning?: string;
}

/**
 * Busca una carpeta en ShareFile por Invoice utilizando el Sistema de 2 Consultas:
 * 1. Primera Consulta: Búsqueda global del Invoice para ubicar el primer archivo/carpeta candidato y extraer su ParentID.
 * 2. Segunda Consulta: Listado directo de todos los archivos contenidos en esa Carpeta de Hallazgo.
 * 
 * Combina, desduplica por ID único y normaliza los nombres para máxima flexibilidad y velocidad.
 * 
 * @param invoice Número de Invoice único (ej. "MM-1001" o "166510")
 * @param options Opciones adicionales como fecha de venta, token directo y base url de la API
 */
export async function searchShareFileByInvoice(
  invoice: string,
  options?: {
    saleDate?: string;
    token?: string;
    baseUrl?: string;
    subdomain?: string;
  }
): Promise<SearchResult> {
  const cleanInvoice = invoice.trim();
  const saleDate = options?.saleDate || "";
  const directToken = options?.token;
  const directBaseUrl = options?.baseUrl;

  // Lógica de desduplicación de elementos
  const deduplicateItems = (list: ShareFileItem[]): ShareFileItem[] => {
    const seen = new Set<string>();
    return list.filter(item => {
      const itemId = item.Id || item.id;
      if (!itemId || seen.has(itemId)) return false;
      seen.add(itemId);
      return true;
    });
  };

  // --- ESCENARIO A: BÚSQUEDA DIRECTA CLIENT-SIDE (Si se proveen credenciales directas) ---
  if (directToken && directBaseUrl) {
    try {
      console.log(`[ShareFile Service] Iniciando consulta directa client-side por Invoice: ${cleanInvoice}`);
      const baseUrlClean = directBaseUrl.replace(/\/$/, "");
      const searchUrl = `${baseUrlClean}/Items/Search?query=${encodeURIComponent(cleanInvoice)}`;
      
      // 1. Primera Consulta: Buscar globalmente por el invoice
      const searchResponse = await fetch(searchUrl, {
        headers: {
          "Authorization": `Bearer ${directToken}`,
          "Accept": "application/json"
        }
      });

      if (!searchResponse.ok) {
        throw new Error(`Error en búsqueda de ShareFile: ${searchResponse.statusText}`);
      }

      const searchData = await searchResponse.json();
      const rawItems: ShareFileItem[] = searchData.value || searchData.Results || searchData.results || [];
      
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
      
      let items: ShareFileItem[] = rawItems
        .map(item => ({
          ...item,
          Id: item.Id || item.id,
          Name: item.Name || item.name,
          ParentId: item.ParentId || item.parentId
        }))
        .filter(item => !isBlacklistedId(item.Id) && !isBlacklistedId(item.ParentId));

      // Buscar candidato para obtener el ID de la carpeta
      const candidate = items.find(item => {
        const normName = normalizeNameForFlexibleMatch(item.Name || item.name || "");
        const normSearch = normalizeNameForFlexibleMatch(cleanInvoice);
        return normName.includes(normSearch);
      });

      let matchedFolderId: string | null = null;
      let matchedFolderName: string | null = null;
      let methodUsed = "none";

      if (candidate) {
        const isFolder = !!(
          candidate["odata.type"]?.includes("Folder") ||
          candidate.typename === "Folder" ||
          (candidate as any).type === "Folder" ||
          candidate.FileCount !== undefined
        );

        matchedFolderId = isFolder ? candidate.Id : (candidate.ParentId || null);
        matchedFolderName = isFolder ? candidate.Name : (candidate.ParentName || "Carpeta Relacionada");
        methodUsed = isFolder ? "direct_folder_match" : "parent_folder_via_file_match";

        // 2. Segunda Consulta: Listado directo de los hijos de la carpeta de hallazgo
        if (matchedFolderId) {
          console.log(`[ShareFile Service] ¡Salto Inteligente! Encontrada Carpeta ID: ${matchedFolderId}. Listando contenido...`);
          const childrenUrl = `${baseUrlClean}/Items(${matchedFolderId})/Children?$top=1000`;
          try {
            const childrenResponse = await fetch(childrenUrl, {
              headers: {
                "Authorization": `Bearer ${directToken}`,
                "Accept": "application/json"
              }
            });

            if (childrenResponse.ok) {
              const childrenData = await childrenResponse.json();
              const rawChildren: ShareFileItem[] = childrenData.value || [];
              const childrenItems = rawChildren.map(child => ({
                ...child,
                Id: child.Id || child.id,
                Name: child.Name || child.name,
                ParentId: child.ParentId || child.parentId
              }));

              // Fusión y desduplicación
              items = deduplicateItems([...items, ...childrenItems]);
              console.log(`[ShareFile Service] Fusión de consultas exitosa. Total elementos: ${items.length}`);
            }
          } catch (childErr: any) {
            console.warn("[ShareFile Service] Error en segunda consulta (Children list):", childErr.message);
          }
        }
      }

      const subdomain = options?.subdomain || "morenamiabeautygroup";
      const folderId = matchedFolderId ? (matchedFolderId.startsWith("fo") ? matchedFolderId : `fo${matchedFolderId}`) : null;
      const folderUrl = folderId ? `https://${subdomain.toLowerCase()}.sharefile.com/home/shared/${folderId}` : null;

      return {
        success: true,
        isDemo: false,
        items,
        matchedFolderId,
        matchedFolderUrl: folderUrl,
        matchedFolderName,
        methodUsed
      };

    } catch (err: any) {
      console.error("[ShareFile Service] Error en consulta directa:", err.message);
      // Fallback a simulación o retorno de error
      return {
        success: false,
        isDemo: true,
        items: [],
        matchedFolderId: null,
        matchedFolderUrl: null,
        matchedFolderName: null,
        methodUsed: "error_fallback",
        warning: `Error de API directa: ${err.message}.`
      };
    }
  }

  // --- ESCENARIO B: CONSULTA MEDIANTE EL BACKEND PROXY (Mantiene las llaves seguras del servidor) ---
  try {
    console.log(`[ShareFile Service] Consultando a través de proxy del backend para Invoice: ${cleanInvoice}`);
    const queryParams = new URLSearchParams({
      search: cleanInvoice,
      saleDate: saleDate
    });

    const response = await fetch(`/api/sharefile/items?${queryParams.toString()}`);
    if (!response.ok) {
      throw new Error(`El proxy del backend devolvió status: ${response.status}`);
    }

    const data = await response.json();
    if (data.success) {
      return {
        success: true,
        isDemo: !!data.isDemo,
        items: data.items || [],
        matchedFolderId: data.matchedFolderId || null,
        matchedFolderUrl: data.matchedFolderUrl || null,
        matchedFolderName: data.matchedFolderName || null,
        methodUsed: data.methodUsed || "backend_proxy",
        warning: data.warning
      };
    } else {
      throw new Error(data.error || "Respuesta fallida del proxy");
    }
  } catch (error: any) {
    console.error("[ShareFile Service] Error llamando al proxy del backend:", error.message);
    return {
      success: false,
      isDemo: true,
      items: [],
      matchedFolderId: null,
      matchedFolderUrl: null,
      matchedFolderName: null,
      methodUsed: "proxy_error_fallback",
      warning: `Fallo de conexión con el backend: ${error.message}`
    };
  }
}

/**
 * Busca la carpeta contenedora exacta en ShareFile dada una factura, nombre, fecha y sucursal.
 * Devuelve la URL de la carpeta, los archivos contenidos y el enlace para descargar el ZIP.
 */
export async function locateShareFileFolder(params: {
  invoice: string;
  name?: string;
  saleDate?: string;
  storeLocation?: string;
}): Promise<{
  success: boolean;
  url?: string;
  folder?: any;
  files?: any[];
  zipDownloadUrl?: string;
  warnings?: string[];
  message?: string;
}> {
  try {
    const res = await fetch("/api/sharefile/search-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params)
    });

    const data = await res.json();
    return data;
  } catch (err: any) {
    console.error("[ShareFile Service] Error localizando carpeta de ShareFile:", err.message);
    return {
      success: false,
      message: `Error de conexión al servidor: ${err.message}`
    };
  }
}

/**
 * Obtiene la lista de archivos dentro de una carpeta de ShareFile especificada por ID.
 */
export async function getFolderFiles(folderId: string): Promise<{
  success: boolean;
  files?: any[];
  zipDownloadUrl?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`/api/sharefile/folder-files/${encodeURIComponent(folderId)}`);
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Obtiene la URL para descargar un archivo individual.
 */
export function getFileDownloadUrl(itemId: string, fileName?: string): string {
  const cleanId = itemId.replace(/^fida/, "").replace(/^fo/, "");
  return `/api/sharefile/download-file/${cleanId}${fileName ? `?name=${encodeURIComponent(fileName)}` : ""}`;
}

/**
 * Obtiene la URL para descargar todos los archivos de una carpeta en formato ZIP.
 */
export function getFolderZipDownloadUrl(folderId: string, invoice?: string): string {
  const cleanId = folderId.replace(/^fo/, "");
  return `/api/sharefile/download-folder-zip/${cleanId}${invoice ? `?invoice=${encodeURIComponent(invoice)}` : ""}`;
}
