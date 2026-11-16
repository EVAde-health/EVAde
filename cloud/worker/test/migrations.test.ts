import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
// 0008 and 0011_seed_surgeon_demo are data-only (demo rows, applied on live); the tests seed their own data.
const DATA_ONLY = new Set(["0008_remove_demo_data.sql", "0011_seed_surgeon_demo.sql"]);

it("preserves 0009 goals and messages when upgrading through 0010 and 0011", () => {
  const path = join(__dirname, "..", "migrations");
  const files = readdirSync(path).filter(name => name.endsWith(".sql") && !DATA_ONLY.has(name)).sort();
  const staffIndex = files.indexOf("0009_staff_console.sql");
  const [staff, surgeon, simulation] = files.slice(staffIndex, staffIndex + 3);
  expect([staff, surgeon, simulation]).toEqual([
    "0009_staff_console.sql", "0010_surgeon_console.sql", "0011_simulated_data.sql",
  ]);
  const db = new DatabaseSync(":memory:");
  const load = (name: string) => readFileSync(join(path, name), "utf8");
  try {
    for (const file of files.slice(0, staffIndex + 1)) db.exec(load(file));
    const existing = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name));
    db.exec("INSERT INTO users (user_id,display_name,role) VALUES ('crew-one','Crew One','astronaut'),('staff-one','Staff One','flight_surgeon')");
    db.exec("INSERT INTO daily_goals (user_id,metric,target,set_by) VALUES ('crew-one','kcal_intake',2000,'staff-one')");
    db.exec("INSERT INTO staff_threads (id,astronaut_id,staff_id) VALUES (400,'crew-one','staff-one')");
    db.exec("INSERT INTO staff_messages (id,thread_id,sender_id,body) VALUES (500,400,'crew-one','Legacy fixture')");
    db.exec(load(surgeon));
    const simulationSql = load(simulation);
    for (const [, table] of simulationSql.matchAll(/^ALTER TABLE (\w+)/gm)) expect(existing.has(table), table).toBe(true);
    db.exec(simulationSql);
    expect(db.prepare("SELECT COUNT(*) AS n FROM user_goals WHERE user_id='crew-one'").get()).toMatchObject({ n: 1 });
    expect(db.prepare(
      "SELECT c.astronaut_id,m.body FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id ORDER BY c.id",
    ).all()).toEqual([
      { astronaut_id: "crew-one", body: "Legacy fixture" },
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});

it("applies every migration in the order the live evade-db applied them", () => {
  const path = join(__dirname, "..", "migrations");
  for (const name of DATA_ONLY) expect(readFileSync(join(path, name), "utf8"), name).not.toMatch(/^\s*(CREATE|ALTER|DROP)\b/im);
  // d1_migrations on live: 0009 ran before 0008, then 0010, 0011_seed_surgeon_demo and 0011_simulated_data.
  const order = [
    "0001_init.sql", "0002_seed_metrics.sql", "0003_auth_and_admin.sql", "0004_media_ai.sql", "0005_meals_hydration.sql",
    "0006_frontend_gaps.sql", "0006_voice_messages_phone.sql", "0007_seed_demo_astronaut.sql", "0009_staff_console.sql",
    "0008_remove_demo_data.sql", "0010_surgeon_console.sql", "0011_seed_surgeon_demo.sql", "0011_simulated_data.sql",
    "0012_demo_logins_and_roles.sql",
  ];
  expect([...order].sort()).toEqual(readdirSync(path).filter(name => name.endsWith(".sql")).sort());
  const db = new DatabaseSync(":memory:");
  try {
    for (const name of order) db.exec(readFileSync(join(path, name), "utf8"));
    expect(db.prepare("SELECT role FROM users WHERE user_id='00000000-0000-4000-8000-00000000d001'").get()).toEqual({ role: "astronaut" });
    expect(db.prepare("SELECT subject, user_id FROM auth_identities WHERE provider='demo' ORDER BY subject").all()).toEqual([
      { subject: "ortiz", user_id: "00000000-0000-4000-8000-00000000d002" },
      { subject: "vega", user_id: "00000000-0000-4000-8000-00000000d001" },
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
