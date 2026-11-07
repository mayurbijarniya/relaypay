import "server-only";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Pool, type PoolClient } from "pg";
import type { PolicyChecks } from "@/lib/policy";
import { initialInventory } from "@/lib/policy";

export type Intent = {
  id: string;
  task?: string;
  product: string;
  quantity: number;
  amount: string;
  currency: string;
  rationale: string;
  alternatives: string[];
  status: "PROPOSED" | "APPROVED" | "REJECTED" | "CAPTURED" | "DISPUTED";
  receiptHash?: string;
  receiptPayload?: any;
  approvedBy?: string;
  approvedAt?: string;
  agentId?: string;
  model?: string;
  promptHash?: string;
  policyChecks?: PolicyChecks;
  marketCheck?: any;
  toolCalls?: any[];
  agentMode?: string;
  createdAt: string;
};

export type OrderRecord = {
  id: string;
  intentId: string;
  paypalOrderId: string;
  captureId?: string;
  status: string;
  customId: string;
  amount: string;
  currency: string;
  createdAt: string;
  capturedAt?: string;
  verifiedAt?: string;
  verificationSource?: string;
  stockApplied?: boolean;
  paypalConfirmedAt?: string;
  reconciledAt?: string;
};

export type EventRecord = {
  id: string;
  providerEventId: string;
  eventType: string;
  source: "REAL" | "SIMULATOR";
  resourceId?: string;
  summary?: string;
  rawPayload: any;
  receivedAt: string;
};

export type DisputeRecord = {
  id: string;
  paypalDisputeId: string;
  orderId?: string;
  captureId?: string;
  reason: string;
  status: string;
  amount?: string;
  sellerResponseDueDate?: string;
  paypalLinks?: string[];
  agentClassification?: string;
  agentDraft?: string;
  agentPayload?: any;
  agentRecommendation?: string;
  agentDecisionReason?: string;
  hashVerified?: boolean;
  hashSource?: string;
  paypalDisputeCustomId?: string;
  toolCalls?: any[];
  merchantApproved: boolean;
  submitted: boolean;
  resolution?: "ACCEPTED" | "CONTESTED";
  simulator?: boolean;
  paypalResponse?: any;
  rawDisputeJson?: any;
  createdAt: string;
  updatedAt?: string;
};

export type LedgerEntry = {
  id: string;
  intentId?: string;
  orderId?: string;
  disputeId?: string;
  /** OWNER = the café owner (approves purchases); MERCHANT = the supplier running RelayPay (answers disputes). */
  actor: "AGENT" | "OWNER" | "MERCHANT" | "PAYPAL" | "SYSTEM";
  eventType: string;
  amount?: string;
  note?: string;
  createdAt: string;
};

export type RateLimitRow = { key: string; count: number; day: string; lastAt: number; windowStart?: number; windowCount?: number };

export type DB = {
  intents: Intent[];
  orders: OrderRecord[];
  events: EventRecord[];
  disputes: DisputeRecord[];
  ledger: LedgerEntry[];
  vault: { vaultId?: string; merchantCustomerId?: string; setupTokenId?: string; approveLink?: string; status?: string; approvedAt?: string };
  /** Units on hand at the cafe, by catalog product. */
  inventory: Record<string, number>;
  rateLimits: RateLimitRow[];
};

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const DATABASE_URL = process.env.DATABASE_URL || "";
const TABLE = "relaypay_store";

// Keep the single JSON document from growing without bound on a public demo.
const MAX_LEDGER = 2000;
const MAX_EVENTS = 500;

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function hasPostgres() {
  return !!DATABASE_URL;
}

function getPool() {
  if (!pool) {
    const ssl = /sslmode=require|render\.com/.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined;
    pool = new Pool({ connectionString: DATABASE_URL, ssl, max: 5 });
  }
  return pool;
}

async function ensureSchema() {
  if (!hasPostgres()) return;
  if (!schemaReady) {
    schemaReady = getPool()
      .query(
        `CREATE TABLE IF NOT EXISTS ${TABLE} (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`
      )
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  return schemaReady;
}

export function emptyDB(): DB {
  return {
    intents: [],
    orders: [],
    events: [],
    disputes: [],
    ledger: [],
    vault: {},
    inventory: initialInventory(),
    rateLimits: [],
  };
}

function normalize(raw: any): DB {
  const base = emptyDB();
  if (!raw || typeof raw !== "object") return base;
  const inventory = { ...base.inventory };
  if (raw.inventory && typeof raw.inventory === "object") {
    for (const [k, v] of Object.entries(raw.inventory)) {
      const n = Math.floor(Number(v));
      if (k in inventory && Number.isFinite(n) && n >= 0) inventory[k] = n;
    }
  }
  return {
    intents: Array.isArray(raw.intents) ? raw.intents : base.intents,
    orders: Array.isArray(raw.orders) ? raw.orders : base.orders,
    events: Array.isArray(raw.events) ? raw.events : base.events,
    disputes: Array.isArray(raw.disputes) ? raw.disputes : base.disputes,
    ledger: Array.isArray(raw.ledger) ? raw.ledger : base.ledger,
    vault: raw.vault && typeof raw.vault === "object" ? raw.vault : base.vault,
    inventory,
    rateLimits: Array.isArray(raw.rateLimits)
      ? raw.rateLimits.map((r: any) => ({ ...r, lastAt: Number(r.lastAt) || 0 }))
      : base.rateLimits,
  };
}

function trim(db: DB) {
  if (db.ledger.length > MAX_LEDGER) db.ledger = db.ledger.slice(-MAX_LEDGER);
  if (db.events.length > MAX_EVENTS) db.events = db.events.slice(-MAX_EVENTS);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Read a snapshot. Use for GET handlers and for preparing slow external calls
 * (PayPal, the LLM). Never save a snapshot back; use mutate() for writes.
 */
export async function loadDB(): Promise<DB> {
  if (hasPostgres()) {
    await ensureSchema();
    const result = await getPool().query(`SELECT value FROM ${TABLE} WHERE key = 'db'`);
    if (!result.rows.length) return emptyDB();
    const value = result.rows[0].value;
    return normalize(typeof value === "string" ? JSON.parse(value) : value);
  }
  return readFile();
}

function readFile(): DB {
  try {
    if (!fs.existsSync(DB_FILE)) return emptyDB();
    return normalize(JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
  } catch {
    return emptyDB();
  }
}

function writeFile(db: DB) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${DB_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DB_FILE);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** In-process queue so two requests in the same server never interleave writes. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Atomically read, change and save the database.
 *
 * - Local file: serialized through an in-process queue.
 * - Postgres: serialized through the queue AND a row lock (SELECT … FOR
 *   UPDATE) inside a transaction, so it also holds across instances.
 *
 * Keep `fn` short and free of network calls. Do slow work (PayPal, LLM)
 * before calling mutate(), then re-check state inside `fn`.
 */
export function mutate<T>(fn: (db: DB) => T | Promise<T>): Promise<T> {
  const run = async () => {
    if (!hasPostgres()) {
      const db = readFile();
      const result = await fn(db);
      trim(db);
      writeFile(db);
      return result;
    }

    await ensureSchema();
    const client: PoolClient = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO ${TABLE} (key, value) VALUES ('db', $1::jsonb) ON CONFLICT (key) DO NOTHING`,
        [JSON.stringify(emptyDB())]
      );
      const row = await client.query(`SELECT value FROM ${TABLE} WHERE key = 'db' FOR UPDATE`);
      const raw = row.rows[0]?.value;
      const db = normalize(typeof raw === "string" ? JSON.parse(raw) : raw);
      const result = await fn(db);
      trim(db);
      await client.query(`UPDATE ${TABLE} SET value = $1::jsonb, updated_at = now() WHERE key = 'db'`, [JSON.stringify(db)]);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

export function addLedger(db: DB, entry: Omit<LedgerEntry, "id" | "createdAt">) {
  db.ledger.push({ ...entry, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
}

export function uid() {
  return crypto.randomUUID();
}

export function storageMode() {
  return hasPostgres() ? "postgres" : "file";
}

/** Thrown inside mutate() to abort with an HTTP status and a readable message. */
export class HttpError extends Error {
  status: number;
  body?: Record<string, unknown>;
  constructor(status: number, message: string, body?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
  }
}
