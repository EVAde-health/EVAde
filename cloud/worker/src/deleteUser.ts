// Keep these statements in sync with queries/delete_user.sql. Every statement binds the user ID as ?1.
const REQUIRED_SQL = [
  "UPDATE messages SET sender_id = NULL WHERE sender_id = ?1 AND user_id <> ?1",
  "UPDATE alerts SET acknowledged_by = NULL WHERE acknowledged_by = ?1 AND user_id <> ?1",
  "UPDATE daily_goals SET set_by = NULL WHERE set_by = ?1 AND user_id <> ?1",
  "UPDATE emergencies SET acknowledged_by = NULL WHERE acknowledged_by = ?1 AND user_id <> ?1",
  "UPDATE emergencies SET resolved_by = NULL WHERE resolved_by = ?1 AND user_id <> ?1",
  "DELETE FROM staff_messages WHERE sender_id = ?1 OR thread_id IN (SELECT id FROM staff_threads WHERE astronaut_id = ?1 OR staff_id = ?1)",
  "DELETE FROM staff_threads WHERE astronaut_id = ?1 OR staff_id = ?1",
  "DELETE FROM daily_goals WHERE user_id = ?1",
  "DELETE FROM emergencies WHERE user_id = ?1",
  "DELETE FROM messages WHERE user_id = ?1",
  "DELETE FROM alerts WHERE user_id = ?1",
  "DELETE FROM phone_numbers WHERE user_id = ?1",
  "DELETE FROM meals WHERE user_id = ?1",
  "DELETE FROM hydration WHERE user_id = ?1",
  "DELETE FROM media WHERE user_id = ?1",
  "DELETE FROM tasks WHERE user_id = ?1",
  "DELETE FROM risk_scores WHERE user_id = ?1",
  "DELETE FROM model_results WHERE user_id = ?1",
  "DELETE FROM radiation_doses WHERE user_id = ?1",
  "DELETE FROM journal_entries WHERE user_id = ?1",
  "DELETE FROM instruments WHERE user_id = ?1",
  "DELETE FROM self_reports WHERE user_id = ?1",
  "DELETE FROM baselines WHERE user_id = ?1",
  "DELETE FROM observations WHERE user_id = ?1",
  "DELETE FROM auth_identities WHERE user_id = ?1",
  "DELETE FROM action_log WHERE user_id = ?1"
];

const HISTORICAL_TABLES = ["agent_jobs","daily_rollups","journal_messages","metric_forecasts","tutorial_progress","user_settings"];
const historicalDelete = (table: string) => `DELETE FROM ${table} WHERE user_id = ?1`;
const DELETE_ACCOUNT = "DELETE FROM users WHERE user_id = ?1";

export const DELETE_USER_SQL = [...REQUIRED_SQL, ...HISTORICAL_TABLES.map(historicalDelete), DELETE_ACCOUNT];

export async function deleteUserStatements(db: D1Database, userId: string) {
  // Some deployed databases already ran the historical frontend migration.
  // Only names from our static allowlist can appear in a delete statement.
  const placeholders = HISTORICAL_TABLES.map(() => "?").join(",");
  const { results } = await db.prepare(
    `SELECT name FROM sqlite_schema WHERE type='table' AND name IN (${placeholders})`
  ).bind(...HISTORICAL_TABLES).all<{ name: string }>();
  const existing = new Set(results.map(({ name }) => name));
  const historical = HISTORICAL_TABLES.filter((table) => existing.has(table)).map(historicalDelete);
  return [...REQUIRED_SQL, ...historical, DELETE_ACCOUNT].map((statement) => db.prepare(statement).bind(userId));
}
