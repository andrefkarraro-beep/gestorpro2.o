import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import type { Content, FunctionDeclaration, Part } from "@google/genai";
import JSZip from "jszip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;

interface CatalogEntry {
  id: number;
  name: string;
  unit: string;
  price: number;
}

interface QuoteItemInput {
  type: "Serviço" | "Material";
  desc: string;
  qty: number;
  price: number;
}

interface AssistantContext {
  services: CatalogEntry[];
  materials: CatalogEntry[];
  currentDoc: {
    docType: string;
    clientName: string;
    discount: number;
    items: QuoteItemInput[];
  };
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não configurada no ambiente.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function normalizeText(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const searchCatalogTool: FunctionDeclaration = {
  name: "searchCatalog",
  description:
    "Busca itens e valores nas pastas de Mão de Obra (Serviços) e Materiais & Insumos cadastrados pelo usuário. Passe query vazia para listar tudo de uma categoria.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description:
          "Termo de busca (ex: 'cabo', 'disjuntor', 'instalação', 'manutenção'). Deixe vazio para listar todos os itens da pasta.",
      },
      folder: {
        type: Type.STRING,
        description:
          "Pasta para pesquisar: 'all' (ambas), 'services' (Mão de Obra / Serviços), ou 'materials' (Materiais & Insumos).",
      },
    },
    required: ["folder"],
  },
};

const getQuoteSummaryTool: FunctionDeclaration = {
  name: "getQuoteSummary",
  description:
    "Obtém os itens atuais, subtotais de mão de obra e materiais, desconto e valor total do orçamento aberto no momento.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

const addQuoteItemsTool: FunctionDeclaration = {
  name: "addQuoteItems",
  description:
    "Adiciona um ou mais itens (Mão de Obra/Serviço ou Material) diretamente no orçamento atual do usuário. Sempre busque os valores nas pastas primeiro com searchCatalog antes de adicionar itens cadastrados.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      items: {
        type: Type.ARRAY,
        description: "Lista de itens a incluir no orçamento.",
        items: {
          type: Type.OBJECT,
          properties: {
            type: {
              type: Type.STRING,
              description: "Use exatamente 'Serviço' ou 'Material'.",
            },
            desc: {
              type: Type.STRING,
              description: "Descrição clara do serviço ou material.",
            },
            qty: {
              type: Type.NUMBER,
              description: "Quantidade (ex: 1, 2, 10).",
            },
            price: {
              type: Type.NUMBER,
              description: "Preço unitário em Reais (BRL).",
            },
          },
          required: ["type", "desc", "qty", "price"],
        },
      },
    },
    required: ["items"],
  },
};

function parseGeminiError(error: unknown): { status: number; message: string } {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const lower = raw.toLowerCase();
  if (lower.includes("403") || lower.includes("permission_denied") || lower.includes("api_key")) {
    return {
      status: 403,
      message:
        "Chave da API Gemini inválida ou sem permissão. Verifique em Settings > Secrets.",
    };
  }
  if (lower.includes("429") || lower.includes("resource_exhausted") || lower.includes("quota")) {
    return {
      status: 429,
      message:
        "Limite de requisições atingido no momento. Aguarde alguns instantes e tente novamente.",
    };
  }
  return {
    status: 500,
    message: raw || "Erro ao consultar o assistente virtual.",
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.use("/api", (req, res, next) => {
    const origin = req.headers.origin;
    if (
      origin &&
      (origin === "https://localhost" ||
        origin === "http://localhost" ||
        origin === "capacitor://localhost" ||
        origin.startsWith("http://localhost:") ||
        origin.startsWith("https://"))
    ) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true, hasKey: Boolean(process.env.GEMINI_API_KEY) });
  });

  app.get("/api/export-project-zip", async (_req: Request, res: Response) => {
    try {
      const zip = new JSZip();
      const rootDir = __dirname;
      const excludedDirs = new Set([
        "node_modules",
        ".git",
        "dist",
        "dev-dist",
        "android",
        "ios",
      ]);
      const excludedFiles = new Set([
        ".env",
        ".env.local",
        ".env.production",
        ".env.development",
        "bun.lock",
      ]);

      const addDirToZip = (dirPath: string, relBase: string) => {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            if (excludedDirs.has(entry.name)) continue;
            if (relPath === "public/assets/aistudio") continue;
            addDirToZip(fullPath, relPath);
          } else if (entry.isFile()) {
            if (excludedFiles.has(entry.name)) continue;
            if (entry.name.endsWith(".log")) continue;
            zip.file(relPath, fs.readFileSync(fullPath));
          }
        }
      };

      addDirToZip(rootDir, "");

      const readmeContent = `# GestorServiços - Pacote Completo para Gerar APK

## Pastas e arquivos incluídos
- \`src/\`: Código-fonte do aplicativo (Orçamentos, 4 fotos por item, Pix, Agenda, Clientes, Catálogo, Assistente Virtual)
- \`public/\`: Ícones do aplicativo Android e PWA
- \`capacitor.config.json\`: Configuração do Capacitor Android (\`com.gestorservicos.app\`)
- \`.github/workflows/build-apk.yml\`: Automação do GitHub Actions para compilar o \`app-debug.apk\`
- \`package.json\`, \`vite.config.ts\`, \`tsconfig.json\`, \`index.html\`, \`server.ts\`

## Como gerar o APK pelo GitHub (sem PC)
1. Extraia este arquivo ZIP e envie todas as pastas (inclusive \`.github\`) para um repositório no GitHub.
2. Abra a aba **Actions** no repositório, clique em **Gerar APK Android** e execute o workflow.
3. Ao concluir, baixe o artefato **GestorServicos-APK** e instale o \`app-debug.apk\` no Android.

## Como gerar o APK localmente (PC com Node 22 + Java 21 + Android Studio)
\`\`\`bash
npm install --legacy-peer-deps
npm run build
npm install --no-save @capacitor/core@^7.4.0 @capacitor/cli@^7.4.0 @capacitor/android@^7.4.0
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
\`\`\`
`;
      zip.file("README-APK.md", readmeContent);

      const buffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="gestorservicos-projeto-apk.zip"'
      );
      res.send(buffer);
    } catch {
      res.status(500).json({
        error: "Não foi possível empacotar as pastas do projeto para download.",
      });
    }
  });

  app.post("/api/assistant/chat", async (req: Request, res: Response) => {
    try {
      const { message, history = [], context } = req.body as {
        message?: string;
        history?: Array<{ role: "user" | "model"; text: string }>;
        context?: AssistantContext;
      };

      if (!message || !message.trim()) {
        res.status(400).json({ error: "Envie uma mensagem para o assistente." });
        return;
      }

      const safeContext: AssistantContext = context ?? {
        services: [],
        materials: [],
        currentDoc: {
          docType: "ORÇAMENTO",
          clientName: "Cliente",
          discount: 0,
          items: [],
        },
      };

      const ai = getAiClient();

      const systemInstruction = `Você é o Assistente Virtual Técnico do aplicativo GestorServiços.
Sua missão é ajudar o profissional prestador de serviços a:
1. Buscar preços e itens nas duas pastas do sistema:
   - Pasta "Mão de Obra / Serviços" (${safeContext.services.length} itens cadastrados)
   - Pasta "Materiais & Insumos" (${safeContext.materials.length} itens cadastrados)
2. Calcular valores, propor quantidades e estruturar orçamentos claros em Reais (R$).
3. Adicionar itens diretamente no orçamento ativo quando o usuário solicitar (ou quando confirmar uma sugestão).

Regras importantes:
- Sempre consulte os dados reais usando a ferramenta \`searchCatalog\` antes de afirmar se um material ou serviço existe ou qual é seu valor cadastrado.
- Se um item não existir nas pastas do usuário, informe claramente que não foi encontrado nas pastas cadastradas e, se útil, ofereça uma estimativa de referência deixando claro que é uma sugestão manual.
- Ao apresentar valores, use formato brasileiro (R$ 0,00) e especifique se o item veio da pasta de Materiais ou de Mão de Obra (Serviços).
- Responda de forma objetiva, amigável e prática em português do Brasil.`;

      const contents: Content[] = [
        ...history
          .filter((h) => h.text && h.text.trim().length > 0)
          .map((h) => ({
            role: h.role,
            parts: [{ text: h.text }],
          })),
        {
          role: "user",
          parts: [{ text: message.trim() }],
        },
      ];

      const foundCatalogItems: Array<{
        id: number;
        folder: "Serviço" | "Material";
        name: string;
        unit: string;
        price: number;
      }> = [];
      const addedItems: QuoteItemInput[] = [];

      const tools = [
        {
          functionDeclarations: [
            searchCatalogTool,
            getQuoteSummaryTool,
            addQuoteItemsTool,
          ],
        },
      ];

      let finalReply = "";
      for (let round = 0; round < 4; round++) {
        const response = await ai.models.generateContent({
          model: "gemini-4-hydrogen",
          contents,
          config: {
            systemInstruction,
            tools,
          },
        });

        const candidateContent = response.candidates?.[0]?.content;
        const functionCalls = response.functionCalls ?? [];

        if (functionCalls.length === 0) {
          finalReply = (response.text ?? "").trim();
          break;
        }

        if (candidateContent) {
          contents.push(candidateContent);
        }

        const functionResponseParts: Part[] = [];

        for (const call of functionCalls) {
          const args = (call.args ?? {}) as Record<string, unknown>;

          if (call.name === "searchCatalog") {
            const rawQuery = String(args.query ?? "");
            const folder = String(args.folder ?? "all");
            const terms = normalizeText(rawQuery)
              .split(/\s+/)
              .filter(Boolean);

            const matchItem = (item: CatalogEntry) => {
              if (terms.length === 0) return true;
              const hay = normalizeText(`${item.name} ${item.unit}`);
              return terms.some((t) => hay.includes(t));
            };

            const results: Array<{
              id: number;
              folder: "Serviço" | "Material";
              name: string;
              unit: string;
              price: number;
            }> = [];

            if (folder === "all" || folder === "services") {
              for (const s of safeContext.services.filter(matchItem)) {
                const entry = {
                  id: s.id,
                  folder: "Serviço" as const,
                  name: s.name,
                  unit: s.unit,
                  price: s.price,
                };
                results.push(entry);
                if (
                  !foundCatalogItems.some(
                    (f) => f.id === entry.id && f.folder === entry.folder
                  )
                ) {
                  foundCatalogItems.push(entry);
                }
              }
            }

            if (folder === "all" || folder === "materials") {
              for (const m of safeContext.materials.filter(matchItem)) {
                const entry = {
                  id: m.id,
                  folder: "Material" as const,
                  name: m.name,
                  unit: m.unit,
                  price: m.price,
                };
                results.push(entry);
                if (
                  !foundCatalogItems.some(
                    (f) => f.id === entry.id && f.folder === entry.folder
                  )
                ) {
                  foundCatalogItems.push(entry);
                }
              }
            }

            functionResponseParts.push({
              functionResponse: {
                id: call.id,
                name: call.name,
                response: {
                  totalFound: results.length,
                  items: results,
                },
              },
            });
          } else if (call.name === "getQuoteSummary") {
            const doc = safeContext.currentDoc;
            let subtotalServices = 0;
            let subtotalMaterials = 0;
            for (const it of doc.items) {
              const sub = (Number(it.qty) || 0) * (Number(it.price) || 0);
              if (it.type === "Serviço") subtotalServices += sub;
              else subtotalMaterials += sub;
            }
            const total = Math.max(
              0,
              subtotalServices + subtotalMaterials - (Number(doc.discount) || 0)
            );

            functionResponseParts.push({
              functionResponse: {
                id: call.id,
                name: call.name,
                response: {
                  docType: doc.docType,
                  clientName: doc.clientName,
                  itemsCount: doc.items.length,
                  items: doc.items,
                  subtotalServices,
                  subtotalMaterials,
                  discount: doc.discount,
                  total,
                },
              },
            });
          } else if (call.name === "addQuoteItems") {
            const rawItems = Array.isArray(args.items) ? args.items : [];
            const sanitized: QuoteItemInput[] = rawItems.map((raw) => {
              const obj = raw as Record<string, unknown>;
              const typeVal =
                String(obj.type ?? "").toLowerCase().includes("mat")
                  ? "Material"
                  : "Serviço";
              return {
                type: typeVal,
                desc: String(obj.desc ?? "Item").trim(),
                qty: Math.max(0.1, Number(obj.qty) || 1),
                price: Math.max(0, Number(obj.price) || 0),
              };
            });

            addedItems.push(...sanitized);
            safeContext.currentDoc.items.push(...sanitized);

            functionResponseParts.push({
              functionResponse: {
                id: call.id,
                name: call.name,
                response: {
                  addedCount: sanitized.length,
                  addedItems: sanitized,
                },
              },
            });
          }
        }

        contents.push({
          role: "user",
          parts: functionResponseParts,
        });
      }

      if (!finalReply) {
        finalReply =
          "Conclui a consulta nas pastas. Confira os itens encontrados abaixo.";
      }

      res.json({
        reply: finalReply,
        foundCatalogItems,
        addedItems,
      });
    } catch (error) {
      const parsed = parseGeminiError(error);
      res.status(parsed.status).json({ error: parsed.message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("/{*splat}", (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`GestorServiços listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
