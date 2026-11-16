import { DatabaseSync } from "node:sqlite";
import { AbuseBudget } from "../src/abuseBudget";

export function budgetHarness(config: Record<string, string> = {}) {
  const stores = new Map<string, { db: DatabaseSync; object: AbuseBudget }>();
  const env = {
    ABUSE_BUDGET: {
      idFromName: (name: string) => name,
      get: (name: string) => {
        let store = stores.get(name);
        if (!store) {
          const db = new DatabaseSync(":memory:");
          let alarm: number | null = null;
          const storage = {
            sql: { exec: (sql: string, ...bind: any[]) => {
              const stmt = db.prepare(sql);
              if (/^(SELECT|DELETE.*RETURNING)/i.test(sql)) return { toArray: () => stmt.all(...bind) };
              stmt.run(...bind);
              return { toArray: () => [] };
            } },
            transactionSync: (fn: () => unknown) => {
              db.exec("BEGIN");
              try {
                const result = fn();
                db.exec("COMMIT");
                return result;
              } catch (error) {
                db.exec("ROLLBACK");
                throw error;
              }
            },
            getAlarm: async () => alarm, setAlarm: async (n: number) => { alarm = n; },
          };
          store = { db, object: new AbuseBudget({ storage } as unknown as DurableObjectState, config) };
          stores.set(name, store);
        }
        return { fetch: (url: string, init?: RequestInit) => store.object.fetch(new Request(url, init)) };
      },
    } as unknown as DurableObjectNamespace,
  };
  return { env, close: () => { for (const store of stores.values()) store.db.close(); } };
}
