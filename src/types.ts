export interface Task {
  id: string;
  name: string;
  status: string;
  url: string;
  due_date?: string;
  local_time?: string;
  tz_tag?: string;
  answered_at?: string;
  priority?: string;
}

export interface Metric {
  tasks_created: number;
  ai_search_calls: number;
  ai_search_avg_time_ms: number;
  total_ai_time_ms: number;
  logs_pushed: number;
  state_distribution?: Record<string, number>;
  total_active_clients?: number;
  total_with_phone?: number;
  total_with_us_state?: number;
  history?: Array<{
    timestamp: string;
    distribution: Record<string, number>;
    total_clients: number;
  }>;
}

export interface DisputeResult {
  invoice: string;
  status: string;
  leyenda?: string | null;
}

export interface ChatMessage {
  sender: "user" | "donna";
  text: string;
  timestamp: Date;
}
