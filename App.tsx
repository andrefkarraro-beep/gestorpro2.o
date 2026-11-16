import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import type {
  AgendaStatus,
  CatalogItem,
  GestorState,
  TabId,
} from "./types/gestor";
import { Sidebar } from "./components/Sidebar";
import { DocumentsTab } from "./components/DocumentsTab";
import { AgendaTab } from "./components/AgendaTab";
import { ClientsTab } from "./components/ClientsTab";
import { CatalogTab } from "./components/CatalogTab";
import { CompanyTab } from "./components/CompanyTab";
import { BudgetAssistantDrawer } from "./components/BudgetAssistantDrawer";
import { OfflineIndicator } from "./components/PWAInstallButton";

const STORAGE_KEY = "gestorservicos_state";

const DEFAULT_STATE: GestorState = {
  company: {
    name: "Nome da Empresa",
    doc: "CNPJ / CPF do Prestador",
    contact: "Tel: (11) 90000-0000",
    address: "Endereço Profissional",
    pix: "suachave@email.com",
    city: "SAO PAULO",
    logo: "",
  },
  clients: [
    {
      id: 1,
      name: "Cliente Exemplo",
      doc: "000.000.000-00",
      phone: "11999999999",
      address: "Rua Exemplo, 123",
    },
  ],
  services: [
    { id: 1, name: "Visita Técnica & Diagnóstico", unit: "un", price: 120.0 },
    { id: 2, name: "Instalação de Tomada / Interruptor", unit: "un", price: 85.0 },
    { id: 3, name: "Manutenção Preventiva (Hora Técnica)", unit: "h", price: 150.0 },
  ],
  materials: [
    { id: 1, name: "Cabo Flexível 2,5mm", unit: "m", price: 4.8 },
    { id: 2, name: "Disjuntor DIN Monopolar 20A", unit: "un", price: 28.5 },
    { id: 3, name: "Fita Isolante 20m", unit: "un", price: 12.0 },
  ],
  agenda: [],
  docItems: [
    {
      id: "init-1",
      type: "Serviço",
      desc: "Visita Técnica & Diagnóstico",
      qty: 1,
      price: 120.0,
    },
  ],
  docConfig: {
    docType: "ORÇAMENTO",
    clientId: "1",
    payment: "Pix (Pagamento Instantâneo)",
    discount: 0,
    notes: "Garantia de 90 dias para serviços executados.",
  },
};

function loadInitialState(): GestorState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<GestorState>;
    return {
      company: { ...DEFAULT_STATE.company, ...(parsed.company ?? {}) },
      clients: Array.isArray(parsed.clients)
        ? parsed.clients
        : DEFAULT_STATE.clients,
      services: Array.isArray(parsed.services)
        ? parsed.services
        : DEFAULT_STATE.services,
      materials: Array.isArray(parsed.materials)
        ? parsed.materials
        : DEFAULT_STATE.materials,
      agenda: Array.isArray(parsed.agenda)
        ? parsed.agenda.map((a) => ({
            ...a,
            status: (a.status as AgendaStatus) || "Agendado",
          }))
        : DEFAULT_STATE.agenda,
      docItems: Array.isArray(parsed.docItems)
        ? parsed.docItems.map((it, idx) => ({
            ...it,
            id: it.id ?? `item-${idx}-${Date.now()}`,
          }))
        : DEFAULT_STATE.docItems,
      docConfig: { ...DEFAULT_STATE.docConfig, ...(parsed.docConfig ?? {}) },
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export default function App() {
  const [state, setState] = useState<GestorState>(loadInitialState);
  const [activeTab, setActiveTab] = useState<TabId>("docs");
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      setToast({
        message:
          "Limite de armazenamento local atingido. Remova algumas fotos antigas para garantir o salvamento.",
        type: "error",
      });
    }
  }, [state]);

  function notify(message: string, type: "success" | "error" = "success") {
    setToast({ message, type });
    window.setTimeout(() => {
      setToast((current) =>
        current?.message === message ? null : current
      );
    }, 3200);
  }

  function handleAddItemsToQuote(
    newItems: Array<{
      type: "Serviço" | "Material";
      desc: string;
      qty: number;
      price: number;
    }>
  ) {
    setState((prev) => ({
      ...prev,
      docItems: [
        ...prev.docItems,
        ...newItems.map((it, idx) => ({
          id: `doc-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          type: it.type,
          desc: it.desc,
          qty: it.qty,
          price: it.price,
        })),
      ],
    }));
  }

  function handleSendCatalogItemToQuote(
    item: CatalogItem,
    kind: "services" | "materials"
  ) {
    handleAddItemsToQuote([
      {
        type: kind === "services" ? "Serviço" : "Material",
        desc: item.name,
        qty: 1,
        price: item.price,
      },
    ]);
    notify(`"${item.name}" incluído no orçamento.`, "success");
  }

  const pendingAgendaCount = state.agenda.filter(
    (a) => a.status === "Agendado" || a.status === "Em Andamento"
  ).length;

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex flex-col md:flex-row selection:bg-sky-500 selection:text-white">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenAssistant={() => setIsAssistantOpen(true)}
        counts={{
          agendaPending: pendingAgendaCount,
          clients: state.clients.length,
          services: state.services.length,
          materials: state.materials.length,
        }}
      />

      <main className="flex-1 p-4 md:p-8 overflow-y-auto max-w-7xl mx-auto w-full">
        {activeTab === "docs" && (
          <DocumentsTab
            company={state.company}
            clients={state.clients}
            services={state.services}
            materials={state.materials}
            docItems={state.docItems}
            docConfig={state.docConfig}
            onUpdateItems={(docItems) =>
              setState((prev) => ({ ...prev, docItems }))
            }
            onUpdateConfig={(docConfig) =>
              setState((prev) => ({ ...prev, docConfig }))
            }
            onOpenAssistant={() => setIsAssistantOpen(true)}
            onNotify={notify}
          />
        )}

        {activeTab === "agenda" && (
          <AgendaTab
            agenda={state.agenda}
            clients={state.clients}
            onAdd={(entry) =>
              setState((prev) => ({
                ...prev,
                agenda: [...prev.agenda, entry],
              }))
            }
            onUpdateStatus={(id, status) =>
              setState((prev) => ({
                ...prev,
                agenda: prev.agenda.map((a) =>
                  a.id === id ? { ...a, status } : a
                ),
              }))
            }
            onDelete={(id) =>
              setState((prev) => ({
                ...prev,
                agenda: prev.agenda.filter((a) => a.id !== id),
              }))
            }
            onNotify={notify}
          />
        )}

        {activeTab === "clientes" && (
          <ClientsTab
            clients={state.clients}
            onAdd={(client) =>
              setState((prev) => ({
                ...prev,
                clients: [...prev.clients, client],
              }))
            }
            onDelete={(id) =>
              setState((prev) => ({
                ...prev,
                clients: prev.clients.filter((c) => c.id !== id),
              }))
            }
            onNotify={notify}
          />
        )}

        {activeTab === "servicos" && (
          <CatalogTab
            kind="services"
            items={state.services}
            onAdd={(item) =>
              setState((prev) => ({
                ...prev,
                services: [...prev.services, item],
              }))
            }
            onUpdatePrice={(id, price) =>
              setState((prev) => ({
                ...prev,
                services: prev.services.map((s) =>
                  s.id === id ? { ...s, price } : s
                ),
              }))
            }
            onDelete={(id) =>
              setState((prev) => ({
                ...prev,
                services: prev.services.filter((s) => s.id !== id),
              }))
            }
            onSendToQuote={handleSendCatalogItemToQuote}
            onNotify={notify}
          />
        )}

        {activeTab === "materiais" && (
          <CatalogTab
            kind="materials"
            items={state.materials}
            onAdd={(item) =>
              setState((prev) => ({
                ...prev,
                materials: [...prev.materials, item],
              }))
            }
            onUpdatePrice={(id, price) =>
              setState((prev) => ({
                ...prev,
                materials: prev.materials.map((m) =>
                  m.id === id ? { ...m, price } : m
                ),
              }))
            }
            onDelete={(id) =>
              setState((prev) => ({
                ...prev,
                materials: prev.materials.filter((m) => m.id !== id),
              }))
            }
            onSendToQuote={handleSendCatalogItemToQuote}
            onNotify={notify}
          />
        )}

        {activeTab === "empresa" && (
          <CompanyTab
            company={state.company}
            onSave={(company) => setState((prev) => ({ ...prev, company }))}
            onNotify={notify}
          />
        )}
      </main>

      <BudgetAssistantDrawer
        isOpen={isAssistantOpen}
        onClose={() => setIsAssistantOpen(false)}
        services={state.services}
        materials={state.materials}
        clients={state.clients}
        docItems={state.docItems}
        docConfig={state.docConfig}
        onAddItemsToQuote={(items) => {
          handleAddItemsToQuote(items);
          notify(
            `${items.length} ${items.length === 1 ? "item adicionado" : "itens adicionados"} ao orçamento.`,
            "success"
          );
        }}
        onGoToDocs={() => {
          setActiveTab("docs");
          setIsAssistantOpen(false);
        }}
      />

      {/* Non-intrusive Toast Notification */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-4 right-4 z-50 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-xs font-semibold shadow-xl ${
            toast.type === "error"
              ? "border-rose-500/40 bg-[#0f172a] text-rose-300"
              : "border-emerald-500/40 bg-[#0f172a] text-emerald-300"
          }`}
        >
          {toast.type === "error" ? (
            <AlertCircle className="h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      <OfflineIndicator />
    </div>
  );
}
