// Local demo crew for the admin console. Writes only to the local Miniflare D1.
// Staff accounts keep their D1 role; dev login can open a staff session when ACCESS_STAFF_AUD is set.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SURGEON = '11111111-1111-4111-8111-111111111111';
const THERAPIST = '22222222-2222-4222-8222-222222222222';
const NOVA = '33333333-3333-4333-8333-333333333333';
const KEPLER = '44444444-4444-4444-8444-444444444444';
const IDS = [SURGEON, THERAPIST, NOVA, KEPLER].map(id => `'${id}'`).join(',');

const day = (offset) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
};
const at = (offset, hour) => `${day(offset)}T${String(hour).padStart(2, '0')}:00:00.000Z`;
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;

const lines = [
  `DELETE FROM staff_messages WHERE thread_id IN (SELECT id FROM staff_threads WHERE astronaut_id IN (${IDS}) OR staff_id IN (${IDS}));`,
  `DELETE FROM staff_threads WHERE astronaut_id IN (${IDS}) OR staff_id IN (${IDS});`,
  `DELETE FROM emergencies WHERE user_id IN (${IDS});`,
  `DELETE FROM daily_goals WHERE user_id IN (${IDS});`,
  `DELETE FROM alerts WHERE user_id IN (${IDS});`,
  `DELETE FROM observations WHERE user_id IN (${IDS});`,
  `DELETE FROM daily_rollups WHERE user_id IN (${IDS});`,
  `DELETE FROM self_reports WHERE user_id IN (${IDS});`,
  `DELETE FROM journal_entries WHERE user_id IN (${IDS});`,
  `DELETE FROM meals WHERE user_id IN (${IDS});`,
  `DELETE FROM hydration WHERE user_id IN (${IDS});`,
  `DELETE FROM risk_scores WHERE user_id IN (${IDS});`,
  `DELETE FROM user_settings WHERE user_id IN (${IDS});`,
  `DELETE FROM auth_identities WHERE user_id IN (${IDS});`,
  `DELETE FROM users WHERE user_id IN (${IDS});`,
  `INSERT INTO users (user_id, display_name, full_name, role, crew_role, mission_name, mission_start, mission_length_days, points, streak_days, last_active) VALUES
    (${q(SURGEON)}, 'Hale', 'Dr. Amira Hale', 'flight_surgeon', 'Flight surgeon', 'Expedition 74', ${q(day(140))}, 180, 0, 12, ${q(at(0, 8))}),
    (${q(THERAPIST)}, 'Moss', 'Dr. Chidi Okonkwo', 'therapist', 'Crew therapist', 'Expedition 74', ${q(day(140))}, 180, 0, 9, ${q(at(0, 7))}),
    (${q(NOVA)}, 'Nova', 'Nova Vega', 'astronaut', 'Flight engineer', 'Expedition 74', ${q(day(141))}, 180, 860, 6, ${q(at(0, 9))}),
    (${q(KEPLER)}, 'Kepler', 'Kepler Ames', 'astronaut', 'Mission specialist', 'Expedition 74', ${q(day(141))}, 180, 1240, 11, ${q(at(0, 9))});`,
  `INSERT INTO auth_identities (provider, subject, user_id, email) VALUES
    ('dev', 'dev:hale@evade.health', ${q(SURGEON)}, 'hale@evade.health'),
    ('dev', 'dev:moss@evade.health', ${q(THERAPIST)}, 'moss@evade.health'),
    ('dev', 'dev:nova@evade.health', ${q(NOVA)}, 'nova@evade.health'),
    ('dev', 'dev:kepler@evade.health', ${q(KEPLER)}, 'kepler@evade.health');`,
];

for (let offset = 13; offset >= 0; offset -= 1) {
  const novaHr = offset === 1 ? 108 : 64 + (offset % 5);
  const keplerHr = 58 + (offset % 4);
  const novaSleep = offset === 2 ? 5.6 : 7.1 + (offset % 3) * 0.3;
  const keplerSleep = 7.4 + (offset % 2) * 0.4;
  for (const [user, hr, sleep, mood] of [[NOVA, novaHr, novaSleep, offset === 2 ? 2 : 4], [KEPLER, keplerHr, keplerSleep, 4]]) {
    const level = hr > 100 ? 'yellow' : 'green';
    lines.push(`INSERT INTO observations (user_id, metric, value, unit, ts, source, level) VALUES
      (${q(user)}, 'heart_rate', ${hr}, 'bpm', ${q(at(offset, 12))}, 'manual', ${q(level)}),
      (${q(user)}, 'systolic_bp', ${112 + (offset % 6)}, 'mmHg', ${q(at(offset, 12))}, 'manual', 'green'),
      (${q(user)}, 'diastolic_bp', ${70 + (offset % 4)}, 'mmHg', ${q(at(offset, 12))}, 'manual', 'green'),
      (${q(user)}, 'body_temp', ${36.4 + (offset % 3) * 0.1}, '°C', ${q(at(offset, 12))}, 'manual', 'green'),
      (${q(user)}, 'spo2', ${offset === 4 && user === NOVA ? 93 : 98}, '%', ${q(at(offset, 12))}, 'manual', ${q(offset === 4 && user === NOVA ? 'yellow' : 'green')}),
      (${q(user)}, 'sleep_hours', ${sleep.toFixed(1)}, 'hours', ${q(at(offset, 6))}, 'manual', ${q(sleep < 6 ? 'yellow' : 'green')}),
      (${q(user)}, 'mood', ${mood}, '/5', ${q(at(offset, 20))}, 'manual', 'green');`);
    lines.push(`INSERT INTO self_reports (user_id, ts, mood, stress, fatigue, note) VALUES (${q(user)}, ${q(at(offset, 20))}, ${mood}, ${offset === 2 && user === NOVA ? 4 : 2}, ${offset === 2 && user === NOVA ? 4 : 2}, ${q(offset === 2 && user === NOVA ? 'Short night, still foggy.' : 'Steady day.')});`);
    const sum = hr * 4;
    lines.push(`INSERT INTO daily_rollups (user_id, metric, day, n, sum, min, max, last, last_ts, n_green, n_yellow, n_red) VALUES (${q(user)}, 'heart_rate', ${q(day(offset))}, 4, ${sum}, ${hr - 2}, ${hr + 2}, ${hr}, ${q(at(offset, 12))}, ${level === 'green' ? 4 : 3}, ${level === 'yellow' ? 1 : 0}, 0);`);
  }
}

lines.push(
  `INSERT INTO meals (id, user_id, ts, name, grams, kcal, protein, carbs, fat) VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', ${q(NOVA)}, ${q(at(0, 8))}, 'Oatmeal with raisins', 180, 420, 14, 68, 8),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', ${q(NOVA)}, ${q(at(0, 13))}, 'Chicken teriyaki', 250, 510, 42, 38, 16),
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', ${q(KEPLER)}, ${q(at(0, 8))}, 'Scrambled eggs', 160, 310, 24, 4, 22);`,
  `INSERT INTO hydration (id, user_id, ts, amount_ml) VALUES
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', ${q(NOVA)}, ${q(at(0, 9))}, 500),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', ${q(NOVA)}, ${q(at(0, 14))}, 750),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', ${q(KEPLER)}, ${q(at(0, 10))}, 1000);`,
  `INSERT INTO journal_entries (user_id, ts, source, content, ai_summary, sentiment, mood_label, concern_level) VALUES
    (${q(NOVA)}, ${q(at(1, 21))}, 'text', 'Slept badly and snapped at Kepler during the procedure review. I do not want another night like that.', 'Short sleep and irritability after a procedure review.', -0.4, 'tired', 'low'),
    (${q(KEPLER)}, ${q(at(0, 21))}, 'text', 'Window time helped. Exercise felt strong and I called home.', 'Positive day with exercise and a family call.', 0.6, 'calm', 'none');`,
  `INSERT INTO alerts (user_id, ts, level, metric, message, action, escalate, acknowledged) VALUES
    (${q(NOVA)}, ${q(at(1, 12))}, 'yellow', 'heart_rate', 'Resting heart rate is 108 bpm (yellow).', 'Rest 10 minutes and re-measure.', 0, 0),
    (${q(NOVA)}, ${q(at(4, 12))}, 'yellow', 'spo2', 'Blood oxygen is 93% (yellow).', 'Recheck on another finger and review cabin CO2.', 1, 1);`,
  `INSERT INTO emergencies (user_id, status, message, created_at) VALUES (${q(NOVA)}, 'open', 'Chest tightness during the evening exercise block.', ${q(at(0, 16))});`,
  `INSERT INTO daily_goals (user_id, metric, target, unit, note, set_by, effective_at, superseded_at) VALUES
    (${q(NOVA)}, 'kcal_intake', 2800, 'kcal', 'Mission default confirmed', ${q(SURGEON)}, ${q(at(10, 9))}, ${q(at(2, 9))}),
    (${q(NOVA)}, 'kcal_intake', 2600, 'kcal', 'Lower while appetite is down', ${q(SURGEON)}, ${q(at(2, 9))}, NULL);`,
  `INSERT INTO user_settings (user_id, kcal_goal) VALUES (${q(NOVA)}, 2600);`,
  `INSERT INTO risk_scores (user_id, ts, r, band, domains, source) VALUES
    (${q(NOVA)}, ${q(at(0, 12))}, 0.42, 'moderate', '{"cardiac":0.3}', 'worker'),
    (${q(KEPLER)}, ${q(at(0, 12))}, 0.18, 'low', '{"cardiac":0.1}', 'worker');`,
  `INSERT INTO staff_threads (astronaut_id, staff_id, created_at, updated_at) VALUES (${q(NOVA)}, ${q(SURGEON)}, ${q(at(1, 18))}, ${q(at(0, 15))});`,
  `INSERT INTO staff_messages (thread_id, sender_id, body, created_at) SELECT id, ${q(NOVA)}, 'Can we look at yesterday''s heart rate? It felt high after exercise.', ${q(at(0, 15))} FROM staff_threads WHERE astronaut_id=${q(NOVA)} AND staff_id=${q(SURGEON)};`,
  `INSERT INTO staff_messages (thread_id, sender_id, body, created_at) SELECT id, ${q(SURGEON)}, 'Yes. The 108 bpm reading is yellow, not red. Rest and we will recheck this evening.', ${q(at(0, 15))} FROM staff_threads WHERE astronaut_id=${q(NOVA)} AND staff_id=${q(SURGEON)};`,
);

const file = join(tmpdir(), 'evade-local-seed.sql');
writeFileSync(file, lines.join('\n'));
const result = spawnSync('npx', ['wrangler', 'd1', 'execute', 'evade-db', '--local', '--file', file], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
