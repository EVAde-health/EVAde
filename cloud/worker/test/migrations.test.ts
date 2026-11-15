import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("applies 0009, 0010 and 0011 in order and safely replays the surgeon backfill", () => {
  const path = join(__dirname, "..", "migrations");
  const files = readdirSync(path).filter(name => name.endsWith(".sql")).sort();
  const [staff, surgeon, simulation] = files.slice(-3);
  expect([staff, surgeon, simulation]).toEqual([
    "0009_staff_console.sql", "0010_surgeon_console.sql", "0011_simulated_data.sql",
  ]);
  const db = new DatabaseSync(":memory:");
  const load = (name: string) => readFileSync(join(path, name), "utf8");
  try {
    for (const file of files.slice(0, -2)) db.exec(load(file));
    const existing = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name));
    db.exec(load(surgeon));
    db.exec("INSERT INTO users (user_id,display_name,role) VALUES ('crew-one','Crew One','astronaut'),('crew-two','Crew Two','astronaut'),('staff-one','Staff One','flight_surgeon')");
    db.exec("INSERT INTO daily_goals (user_id,metric,target,set_by) VALUES ('crew-one','kcal_intake',2000,'staff-one')");
    db.exec("INSERT INTO conversations (id,astronaut_id,surgeon_id) VALUES (400,'crew-two','staff-one')");
    db.exec("INSERT INTO conversation_messages (id,conversation_id,sender_id,body) VALUES (500,400,'crew-two','Existing fixture')");
    db.exec("INSERT INTO staff_threads (id,astronaut_id,staff_id) VALUES (400,'crew-one','staff-one')");
    db.exec("INSERT INTO staff_messages (id,thread_id,sender_id,body) VALUES (500,400,'crew-one','Legacy fixture')");
    const simulationSql = load(simulation);
    for (const [, table] of simulationSql.matchAll(/^ALTER TABLE (\w+)/gm)) expect(existing.has(table), table).toBe(true);
    db.exec(simulationSql);
    for (const [index] of simulationSql.matchAll(/^CREATE UNIQUE INDEX[^;]*;/gm)) db.exec(index);
    db.exec(load(surgeon));
    db.exec(load(surgeon));
    expect(db.prepare("SELECT COUNT(*) AS n FROM user_goals WHERE user_id='crew-one'").get()).toMatchObject({ n: 1 });
    expect(db.prepare(
      "SELECT c.astronaut_id,m.body FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id ORDER BY c.id",
    ).all()).toEqual([
      { astronaut_id: "crew-two", body: "Existing fixture" },
      { astronaut_id: "crew-one", body: "Legacy fixture" },
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
