import React, { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import Sidebar from "./components/Sidebar";
import TaskWheel from "./components/TaskWheel";
import NewCaseForm from "./components/NewCaseForm";
import AISearch from "./components/AISearch";
import DisputesSync from "./components/DisputesSync";
import RefundsList from "./components/RefundsList";
import MetricsPanel from "./components/MetricsPanel";
import TaskDetailModal from "./components/TaskDetailModal";
import ZendeskUserChecker from "./components/ZendeskUserChecker";
import { Task } from "./types";
import { Loader2 } from "lucide-react";

export default function App() {
  const [activeTab, setActiveTab] = useState("task-wheel");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  useEffect(() => {
    fetchTasks();
    
    // Auto refresh tasks every 60 seconds
    const interval = setInterval(fetchTasks, 60000);
    return () => clearInterval(interval);
  }, []);

  // Toast automatic auto-clear timeout
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 7000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const fetchTasks = async (retries = 3, delay = 1000) => {
    setLoadingTasks(true);
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetch("/api/today-tasks");
        if (res.ok) {
          const data = await res.json();
          setTasks(data.tasks || []);
          setLoadingTasks(false);
          return;
        } else {
          throw new Error(`HTTP error ${res.status}`);
        }
      } catch (err: any) {
        console.warn(`[Attempt ${attempt}/${retries}] Error fetching today's tasks:`, err.message);
        if (attempt === retries) {
          console.error("All retries failed for today's tasks fetch:", err);
          setToast({
            message: "No se pudieron cargar las tareas de hoy. Por favor, verifica tu conexión o vuelve a intentar.",
            type: "error"
          });
        } else {
          // Wait before retrying with backoff
          await new Promise((resolve) => setTimeout(resolve, delay * attempt));
        }
      }
    }
    setLoadingTasks(false);
  };

  const renderActiveTabContent = () => {
    switch (activeTab) {
      case "new-case":
        return <NewCaseForm onCaseCreated={fetchTasks} />;
      case "task-wheel":
        return (
          <TaskWheel
            tasks={tasks}
            loading={loadingTasks}
            onRefresh={fetchTasks}
            onSelectTask={(id) => setSelectedTaskId(id)}
          />
        );
      case "ai-search":
        return <AISearch />;
      case "disputes-sync":
        return <DisputesSync />;
      case "refund-list":
        return <RefundsList />;
      case "zendesk-check":
        return <ZendeskUserChecker />;
      case "metrics":
        return <MetricsPanel />;
      default:
        return <NewCaseForm onCaseCreated={fetchTasks} />;
    }
  };

  return (
    <div className="flex bg-[#05050b] min-h-screen text-white overflow-x-hidden font-sans bg-grid-pattern relative">
      
      {/* Dynamic Background Glows */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-purple-900/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-cyan-900/10 rounded-full blur-[150px] pointer-events-none" />

      {/* Sidebar Navigation */}
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        tasksCount={tasks.length}
      />

      {/* Main Content Area */}
      <main className="flex-1 p-8 md:p-12 overflow-y-auto max-w-6xl mx-auto w-full">
        
        {/* Animated Page Transitions */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="w-full"
          >
            {renderActiveTabContent()}
          </motion.div>
        </AnimatePresence>

      </main>

      {/* Task Details Modal (Slide Over) */}
      <AnimatePresence>
        {selectedTaskId && (
          <TaskDetailModal
            taskId={selectedTaskId}
            onClose={() => setSelectedTaskId(null)}
            onActionComplete={() => { fetchTasks(); }}
            showToast={(msg, type) => setToast({ message: msg, type })}
          />
        )}
      </AnimatePresence>

      {/* Floating Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            className={`fixed bottom-6 right-6 z-50 flex items-center justify-between gap-4 px-5 py-4 rounded-xl border shadow-2xl backdrop-blur-md max-w-sm ${
              toast.type === "success" 
                ? "bg-emerald-950/90 border-emerald-500/40 text-emerald-200" 
                : toast.type === "error"
                ? "bg-rose-950/90 border-rose-500/40 text-rose-200"
                : "bg-blue-950/90 border-blue-500/40 text-blue-200"
            }`}
          >
            <div className="flex-1 text-xs font-sans font-medium whitespace-pre-line leading-relaxed">
              {toast.message}
            </div>
            <button 
              onClick={() => setToast(null)}
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition-all text-white"
            >
              Cerrar
            </button>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
