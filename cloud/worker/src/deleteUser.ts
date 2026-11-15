// Generated from queries/delete_user.sql (keep them in sync). Every statement binds the user_id as ?1.
// Runs as one D1 batch, so it either all applies or none of it does.
export const DELETE_USER_SQL: string[] = [
  "UPDATE messages SET sender_id = NULL WHERE sender_id = ?1 AND user_id <> ?1",
  "UPDATE alerts SET acknowledged_by = NULL WHERE acknowledged_by = ?1 AND user_id <> ?1",
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
  "DELETE FROM action_log WHERE user_id = ?1",
  "DELETE FROM users WHERE user_id = ?1"
];
