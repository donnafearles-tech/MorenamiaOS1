export interface ZendeskTicketSummary {
  id: number | string;
  subject: string;
  status: string;
  priority?: string;
  created_at?: string;
  updated_at?: string;
  zendesk_url: string;
}

export interface ZendeskUserResult {
  id: number | string;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  verified?: boolean;
  active?: boolean;
  suspended?: boolean;
  time_zone?: string;
  created_at?: string;
  updated_at?: string;
  organization_id?: number | string;
  details?: string;
  notes?: string;
  external_id?: string;
  tickets_count?: number;
  recent_tickets?: ZendeskTicketSummary[];
  zendesk_profile_url: string;
}

export interface CheckZendeskUserResponse {
  success: boolean;
  exists: boolean;
  isConfigured?: boolean;
  count?: number;
  user?: ZendeskUserResult | null;
  users?: ZendeskUserResult[];
  search_criteria?: {
    email?: string;
    phone?: string;
    name?: string;
    query?: string;
  };
  message?: string;
  details?: string;
  error?: string;
}

export async function checkZendeskUser(params: {
  email?: string;
  phone?: string;
  name?: string;
  query?: string;
  external_id?: string;
}): Promise<CheckZendeskUserResponse> {
  try {
    const res = await fetch("/api/zendesk/check-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params)
    });
    
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return {
        success: false,
        exists: false,
        error: errData.error || `Error HTTP ${res.status} al consultar Zendesk`
      };
    }

    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      exists: false,
      error: err.message || "Error de red al consultar el servidor."
    };
  }
}
