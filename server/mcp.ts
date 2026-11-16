import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  applyOperationsToState,
  buildFullPlanData,
  buildPlanOverview,
  DEFAULT_BRIDGE_URL,
  findValidSlotsForExam,
  getReviewInboxEnriched,
  listBridgeBackups,
  requireBridgeState,
  resolveReviewTicketsForState,
  restoreBridgeBackup,
  saveBridgeState,
  type PlanOperation,
} from './mcpLogic.ts';

const MCP_HOST = process.env.KLAUSURPLANER_MCP_HOST || '127.0.0.1';
const MCP_PORT = Number(process.env.KLAUSURPLANER_MCP_PORT || '8788');

const DayOfWeekSchema = z.enum(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
const TimingSchema = z.enum(['normal', 'early', 'late']);
const ResolutionStatusSchema = z.enum(['open', 'applied', 'dismissed']);

const PlanOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('move_exam'),
    examId: z.string().optional().describe('ID der Klausur (alternativ className + subject)'),
    className: z.string().optional().describe('Klassenname (z. B. BG25a)'),
    subject: z.string().optional().describe('Fachkürzel/-name'),
    weekId: z.string().nullable().describe('Ziel-Wochen-ID (z. B. 2026-KW46) oder null zum Entfernen aus dem Kalender'),
    day: DayOfWeekSchema.nullable().describe('Ziel-Wochentag oder null zum Entfernen'),
    isPinned: z.boolean().optional().describe('Optional: Klausur danach anpinnen/entpinnen'),
    allowInvalid: z.boolean().optional().describe('Optional: Regelverstoß explizit erlauben'),
  }),
  z.object({
    type: z.literal('set_exam_pinned'),
    examId: z.string().optional(),
    className: z.string().optional(),
    subject: z.string().optional(),
    isPinned: z.boolean(),
  }),
  z.object({
    type: z.literal('set_exam_duration'),
    examId: z.string().optional(),
    className: z.string().optional(),
    subject: z.string().optional(),
    durationMinutes: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('set_blocked_day'),
    scope: z.enum(['global', 'class']).describe("'global' für alle Klassen oder 'class' für eine Klasse"),
    className: z.string().optional().describe("Pflichtfeld wenn scope='class'"),
    weekId: z.string(),
    day: DayOfWeekSchema,
    blocked: z.boolean(),
    label: z.string().optional().describe('Optionales Label für globale Sperrtage (z. B. Konferenz)'),
  }),
  z.object({
    type: z.literal('set_week_blocked'),
    weekId: z.string(),
    isBlocked: z.boolean(),
  }),
  z.object({
    type: z.literal('set_week_type'),
    weekId: z.string(),
    weekType: z.enum(['A', 'B']).describe('Legacy-Wochentyp (nur wirksam ohne konkrete weeklySchedules)'),
  }),
  z.object({
    type: z.literal('set_subject_timing'),
    scope: z.enum(['global', 'class']),
    className: z.string().optional(),
    subject: z.string(),
    timing: TimingSchema,
  }),
  z.object({
    type: z.literal('set_exam_teacher'),
    className: z.string(),
    subject: z.string(),
    teacher: z.string().nullable().describe('Lehrerkürzel oder null zum Zurücksetzen'),
  }),
  z.object({
    type: z.literal('set_selected_subjects'),
    className: z.string(),
    subjects: z.array(z.string()),
  }),
  z.object({
    type: z.literal('set_class_grade_level'),
    className: z.string(),
    gradeLevel: z.string(),
  }),
  z.object({
    type: z.literal('update_solver_settings'),
    settings: z.object({
      maxExamsPerWeek: z.number().int().min(1).max(5).optional(),
      keepPinnedOnDistribute: z.boolean().optional(),
      preferSameGradeSubjectSameWeek: z.boolean().optional(),
      avoidConsecutiveDays: z.boolean().optional(),
      avoidTeacherCollisions: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal('update_pdf_settings'),
    settings: z.object({
      title: z.string().optional(),
      makeupExamInfo: z.string().optional(),
      gradesDueDate: z.string().optional(),
    }),
  }),
]);

function jsonContent(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorContent(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: message }, null, 2),
      },
    ],
  };
}

export function createKlausurplanerMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'klausurplaner-mcp',
      version: '1.0.0',
    },
    {
      instructions:
        'MCP-Server für den lokalen Klausurplaner. Workflow: ' +
        '1) Zuerst Plan (get_plan_overview / get_full_plan_data), Ausweichslots (find_valid_slots) und Kollegen-Feedback (get_review_inbox) lesen. ' +
        '2) Größere Änderungen immer erst mit simulate_changes im Speicher testen und dem Nutzer den Diff + Konflikte zur Freigabe vorlegen. ' +
        '3) Erst nach ausdrücklicher Bestätigung durch den Nutzer mit apply_changes in den lokalen Plan pushen (und optional resolve_review_tickets ausführen).',
    }
  );

  server.registerTool(
    'get_plan_overview',
    {
      title: 'Plan-Übersicht & Konflikte',
      description:
        'Liefert eine kompakte Übersicht über den aktuellen lokalen Klausurplan: Revision, Wochen (inkl. Feiertage), Klassen, Lehrkräfte (inkl. Klarnamen), Solver-Bewertung und alle aktuellen Konflikte (unplatzierte Klausuren, Regelverstöße, Lehrkraft-Kollisionen, Nachbartage).',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const { state, revision, updatedAt, updatedBy } = await requireBridgeState();
        return jsonContent(buildPlanOverview(state, { revision, updatedAt, updatedBy }));
      } catch (err) {
        return errorContent(err);
      }
    }
  );

  server.registerTool(
    'get_full_plan_data',
    {
      title: 'Alle Plandaten abrufen',
      description:
        'Gibt vollständige Details zu Klausuren, konkreten Wochen-Stundenplänen (weeklySchedules inkl. freeDays und Fallback-Pläne), Lehrkräften pro Tag/Fach (inkl. Klarnamen), Sperrtagen, Zeitpräferenzen und Einstellungen zurück. Optional filterbar nach Klassen, Fächern, Lehrkraft oder Wochen.',
      inputSchema: {
        classNames: z.array(z.string()).optional().describe('Optional auf bestimmte Klassen filtern'),
        subjects: z.array(z.string()).optional().describe('Optional auf bestimmte Fächer filtern'),
        teacherCode: z.string().optional().describe('Optional auf ein Lehrerkürzel filtern'),
        weekIds: z.array(z.string()).optional().describe('Optional auf bestimmte Wochen-IDs filtern'),
        onlyUnassigned: z.boolean().optional().describe('Nur noch nicht platzierte Klausuren zurückgeben'),
        includeSchedules: z
          .boolean()
          .optional()
          .describe('Stundenpläne (subjects/weeklySchedules/subjectTeachers) mit ausgeben (Standard: true)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const { state, revision } = await requireBridgeState();
        return jsonContent({
          revision,
          ...buildFullPlanData(state, args),
        });
      } catch (err) {
        return errorContent(err);
      }
    }
  );

  server.registerTool(
    'get_review_inbox',
    {
      title: 'Kollegen-Rückmeldungen abrufen',
      description:
        'Lädt alle Rückmeldungen, Änderungswünsche und No-Go-/Wunschtermine aus der Kollegen-Abstimmung (https://klausurplaner.pages.dev), angereichert mit Lehrkraft-Namen, aktuellem Termin, Pin-Status und betroffenen Klassen.',
      inputSchema: {
        statusFilter: z
          .enum(['open', 'done', 'all'])
          .optional()
          .describe("Tickets filtern nach 'open', 'done' oder 'all' (Standard: 'all')"),
        teacherCode: z.string().optional().describe('Optional nach Lehrerkürzel filtern'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const { state, revision } = await requireBridgeState();
        const inbox = await getReviewInboxEnriched(state, args);
        return jsonContent({ revision, ...inbox });
      } catch (err) {
        return errorContent(err);
      }
    }
  );

  server.registerTool(
    'find_valid_slots',
    {
      title: 'Gültige Ausweichtermine suchen',
      description:
        'Prüft für eine einzelne Klausur alle Wochen und Wochentage mit der offiziellen Regel-Logik (validateMove inkl. weeklySchedules & freeDays) und listet alle gültigen Termine inkl. Lehrkräfte, Doppelstunden, Stufen-Kopplung und weicher Warnungen sortiert auf.',
      inputSchema: {
        examId: z.string().optional().describe('ID der Klausur (alternativ className + subject)'),
        className: z.string().optional(),
        subject: z.string().optional(),
        weekIds: z.array(z.string()).optional().describe('Optional Suche auf bestimmte Wochen beschränken'),
        includeInvalidReasons: z
          .boolean()
          .optional()
          .describe('Auch ungültige Tage mit Begründung auflisten (hilfreich zur Konfliktanalyse)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const { state } = await requireBridgeState();
        return jsonContent(findValidSlotsForExam(state, args));
      } catch (err) {
        return errorContent(err);
      }
    }
  );

  server.registerTool(
    'simulate_changes',
    {
      title: 'Änderungen simulieren (Dry-Run)',
      description:
        'Simuliert ein Paket aus Änderungen (Klausuren verschieben/pinnen, Sperrtage, Zeitpräferenzen, Solver/Auto-Fix) rein im Speicher ohne den lokalen Plan zu verändern. Liefert Vorher/Nachher-Bewertung, alle Konflikte und ein vollständiges Diff für die Freigabe durch den Nutzer.',
      inputSchema: {
        operations: z.array(PlanOperationSchema).describe('Liste der auszuführenden Operationen'),
        runAutoFixAfter: z
          .boolean()
          .optional()
          .describe('Danach autoFix ausführen (hält gepinnte Klausuren fest und optimiert ungepinnte)'),
        runDistributeAfter: z
          .boolean()
          .optional()
          .describe('Danach distributeExams komplett neu ausführen'),
        strictValidation: z
          .boolean()
          .optional()
          .describe('Ungültige move_exam-Züge ablehnen (Standard: true)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const { state, revision } = await requireBridgeState();
        const result = applyOperationsToState(state, {
          operations: args.operations as PlanOperation[],
          runAutoFixAfter: args.runAutoFixAfter,
          runDistributeAfter: args.runDistributeAfter,
          strictValidation: args.strictValidation,
        });
        return jsonContent({
          dryRun: true,
          baseRevision: revision,
          warnings: result.warnings,
          diff: result.diff,
          evaluationBefore: result.evaluationBefore,
          evaluationAfter: result.evaluationAfter,
          diagnosticsAfter: result.diagnosticsAfter,
        });
      } catch (err) {
        return errorContent(err);
      }
    }
  );

  server.registerTool(
    'apply_changes',
    {
      title: 'Änderungen in lokalen Plan pushen',
      description:
        'Wendet validierte Änderungen am lokalen Klausurplan an, legt automatisch ein Backup in server/data/backups/ an und speichert in den laufenden lokalen Server (Browser aktualisiert sich live). NUR nach Freigabe durch den Nutzer aufrufen!',
      inputSchema: {
        operations: z.array(PlanOperationSchema).describe('Liste der anzuwendenden Operationen'),
        runAutoFixAfter: z.boolean().optional(),
        runDistributeAfter: z.boolean().optional(),
        strictValidation: z.boolean().optional(),
        expectedRevision: z
          .number()
          .int()
          .optional()
          .describe('Optional: erwartete Revision aus vorheriger Abfrage/Simulation zur Konfliktvermeidung'),
        reason: z
          .string()
          .optional()
          .describe('Kurze Begründung für das automatische Backup (z. B. kollegen-feedback-kw46)'),
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => {
      try {
        const { state, revision } = await requireBridgeState();
        if (args.expectedRevision !== undefined && args.expectedRevision !== revision) {
          throw new Error(
            `Revisionskonflikt vor Anwendung: erwartet Rev. ${args.expectedRevision}, aktuell ist Rev. ${revision}. Bitte zuerst neu prüfen/simulieren.`
          );
        }

        const result = applyOperationsToState(state, {
          operations: args.operations as PlanOperation[],
          runAutoFixAfter: args.runAutoFixAfter,
          runDistributeAfter: args.runDistributeAfter,
          strictValidation: args.strictValidation,
        });

        const saved = await saveBridgeState(result.nextState, {
          expectedRevision: revision,
          reason: args.reason || 'mcp-apply',
        });

        return jsonContent({
          saved: saved.saved,
          previousRevision: revision,
          newRevision: saved.revision,
          savedAt: saved.savedAt,
          backupFile: saved.backupFile,
          warnings: result.warnings,
          diff: result.diff,
          evaluationBefore: result.evaluationBefore,
          evaluationAfter: result.evaluationAfter,
          diagnosticsAfter: result.diagnosticsAfter,
        });
      } catch (err) {
        return errorContent(err);
      }
    }
  );

  server.registerTool(
    'resolve_review_tickets',
    {
      title: 'Kollegen-Tickets als erledigt markieren',
      description:
        'Markiert bearbeitete Klausur-Rückmeldungen oder Tageswünsche in der Review-Inbox auf https://klausurplaner.pages.dev als applied/dismissed/open. Nur aufrufen, wenn der Nutzer die Tickets abhaken möchte.',
      inputSchema: {
        resolutions: z.array(
          z.object({
            itemType: z.enum(['exam', 'wish']),
            itemId: z.string(),
            status: ResolutionStatusSchema,
            note: z.string().optional(),
          })
        ),
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => {
      try {
        const { state } = await requireBridgeState();
        const res = await resolveReviewTicketsForState(state, args.resolutions);
        return jsonContent(res);
      } catch (err) {
        return errorContent(err);
      }
    }
  );

  server.registerTool(
    'list_backups',
    {
      title: 'Lokale Backups auflisten',
      description:
        'Listet die automatisch vor Schreibvorgängen gespeicherten Snapshots in server/data/backups/ auf.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const backups = await listBridgeBackups();
        return jsonContent({ backups });
      } catch (err) {
        return errorContent(err);
      }
    }
  );

  server.registerTool(
    'rollback_backup',
    {
      title: 'Backup wiederherstellen',
      description:
        'Stellt ein lokales Backup (ohne Angabe das neueste) wieder her und synchronisiert es in den Browser. Legt vorher ein Sicherheits-Backup des aktuellen Stands an.',
      inputSchema: {
        filename: z.string().optional().describe('Optionaler Backup-Dateiname (leer = neuestes Backup)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => {
      try {
        const restored = await restoreBridgeBackup(args.filename);
        return jsonContent(restored);
      } catch (err) {
        return errorContent(err);
      }
    }
  );

  return server;
}

async function runStdio() {
  const server = createKlausurplanerMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[klausurplaner-mcp] stdio bereit (Bridge: ${DEFAULT_BRIDGE_URL})`);
}

async function runHttp() {
  const app = createMcpExpressApp({ host: MCP_HOST });
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      transport: 'streamable-http',
      endpoint: `http://${MCP_HOST}:${MCP_PORT}/mcp`,
      bridgeUrl: DEFAULT_BRIDGE_URL,
      activeSessions: transports.size,
    });
  });

  app.post('/mcp', async (req, res) => {
    const rawSessionId = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;

    try {
      if (sessionId) {
        const existing = transports.get(sessionId);
        if (!existing) {
          res.status(404).json({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Session not found' },
            id: null,
          });
          return;
        }
        await existing.handleRequest(req, res, req.body);
        return;
      }

      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null,
        });
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, transport);
        },
      });

      const server = createKlausurplanerMcpServer();
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) transports.delete(sid);
        void server.close().catch(() => {});
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[klausurplaner-mcp] HTTP POST Fehler:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', async (req, res) => {
    const rawSessionId = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
    if (!sessionId) {
      res.status(400).send('Missing mcp-session-id header');
      return;
    }
    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).send('Session not found');
      return;
    }
    await transport.handleRequest(req, res);
  });

  app.delete('/mcp', async (req, res) => {
    const rawSessionId = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
    if (!sessionId) {
      res.status(400).send('Missing mcp-session-id header');
      return;
    }
    const transport = transports.get(sessionId);
    if (!transport) {
      res.status(404).send('Session not found');
      return;
    }
    await transport.handleRequest(req, res);
  });

  const httpServer = app.listen(MCP_PORT, MCP_HOST, () => {
    console.error(
      `[klausurplaner-mcp] Läuft auf http://${MCP_HOST}:${MCP_PORT}/mcp (Bridge: ${DEFAULT_BRIDGE_URL})`
    );
  });

  const shutdown = async () => {
    for (const transport of transports.values()) {
      await transport.close().catch(() => {});
    }
    transports.clear();
    httpServer.close(() => process.exit(0));
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

const isMain = process.argv[1]?.endsWith('mcp.ts') || process.argv[1]?.endsWith('mcp.js');
if (isMain) {
  const useStdio = process.argv.includes('--stdio');
  if (useStdio) {
    runStdio().catch((err) => {
      console.error('[klausurplaner-mcp] Fataler stdio-Fehler:', err);
      process.exit(1);
    });
  } else {
    runHttp().catch((err) => {
      console.error('[klausurplaner-mcp] Fataler HTTP-Fehler:', err);
      process.exit(1);
    });
  }
}
