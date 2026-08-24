import { pool } from "@workspace/db";

export type GuildConfig = {
  levelUpChannelId?: string;
  mainChannelId?: string;
  levelUpFormat?: string;
  chatXp: number;
  voiceXpPerMinute: number;
  xpGoalBase: number;
  xpGoalStep: number;
  boosterRoleId?: string;
  boosterAmount: number;
  allowedMessageChannels: string[];
  blockedMessageChannels: string[];
  allowedVoiceChannels: string[];
  blockedVoiceChannels: string[];
  blockedUsersChat: string[];
  blockedUsersVoice: string[];
  blockedRolesChat: string[];
  blockedRolesVoice: string[];
  levelRoles: Record<string, string>;
  staffRoles: string[];
  adminRoles: string[];
  weeklyAnnouncementChannelId?: string;
  weeklyAnnouncementFormat?: string;
  statusType: "online" | "idle" | "dnd" | "invisible";
  statusMessage: string;
};

export const defaultConfig: GuildConfig = {
  chatXp: 2,
  voiceXpPerMinute: 5,
  xpGoalBase: 100,
  xpGoalStep: 200,
  boosterAmount: 2,
  allowedMessageChannels: [],
  blockedMessageChannels: [],
  allowedVoiceChannels: [],
  blockedVoiceChannels: [],
  blockedUsersChat: [],
  blockedUsersVoice: [],
  blockedRolesChat: [],
  blockedRolesVoice: [],
  levelRoles: {},
  staffRoles: [],
  adminRoles: [],
  weeklyAnnouncementFormat:
    "Weekly Chat Champions: [1st Person On Weekly Chat Leaderboard] — [1st Person Total Weekly Messages]\nWeekly Voice Champions: [1st Person On Weekly Voice Leaderboard] — [1st Person Total Weekly Voice Time]",
  statusType: "online",
  statusMessage: "leveling up the server",
};

export async function initStore() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leveling_guilds (
      guild_id TEXT PRIMARY KEY, config JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS leveling_members (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT NOT NULL,
      xp BIGINT NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 0,
      messages BIGINT NOT NULL DEFAULT 0, voice_minutes BIGINT NOT NULL DEFAULT 0,
      weekly_messages BIGINT NOT NULL DEFAULT 0, weekly_voice_minutes BIGINT NOT NULL DEFAULT 0,
      last_chat_xp_at TIMESTAMPTZ, PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS leveling_no_prefix (
      guild_id TEXT NOT NULL, subject_id TEXT NOT NULL, subject_type TEXT NOT NULL,
      expires_at TIMESTAMPTZ, PRIMARY KEY (guild_id, subject_id, subject_type)
    );
  `);
}

export async function getConfig(guildId: string): Promise<GuildConfig> {
  const result = await pool.query<{ config: GuildConfig }>(
    "SELECT config FROM leveling_guilds WHERE guild_id = $1",
    [guildId],
  );
  if (!result.rows[0]) {
    await pool.query(
      "INSERT INTO leveling_guilds (guild_id, config) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [guildId, JSON.stringify(defaultConfig)],
    );
    return { ...defaultConfig };
  }
  return { ...defaultConfig, ...result.rows[0].config };
}

export async function updateConfig(guildId: string, patch: Partial<GuildConfig>) {
  const config = { ...(await getConfig(guildId)), ...patch };
  await pool.query(
    "INSERT INTO leveling_guilds (guild_id, config) VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE SET config = $2, updated_at = NOW()",
    [guildId, JSON.stringify(config)],
  );
  return config;
}

export async function ensureMember(guildId: string, userId: string, username: string) {
  await pool.query(
    `INSERT INTO leveling_members (guild_id, user_id, username) VALUES ($1, $2, $3)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET username = $3`,
    [guildId, userId, username],
  );
}

export async function getMember(guildId: string, userId: string) {
  const result = await pool.query(
    "SELECT * FROM leveling_members WHERE guild_id = $1 AND user_id = $2",
    [guildId, userId],
  );
  return result.rows[0] as
    | {
        user_id: string; username: string; xp: number; level: number; messages: number;
        voice_minutes: number; weekly_messages: number; weekly_voice_minutes: number;
      }
    | undefined;
}

export async function addChatXp(guildId: string, userId: string, username: string, amount: number) {
  await ensureMember(guildId, userId, username);
  const result = await pool.query(
    `UPDATE leveling_members SET xp = xp + $3, messages = messages + 1,
      weekly_messages = weekly_messages + 1 WHERE guild_id = $1 AND user_id = $2 RETURNING *`,
    [guildId, userId, amount],
  );
  return result.rows[0] as { xp: number; level: number };
}

export async function addVoiceMinute(guildId: string, userId: string, username: string, amount: number) {
  await ensureMember(guildId, userId, username);
  await pool.query(
    `UPDATE leveling_members SET xp = xp + $3, voice_minutes = voice_minutes + 1,
      weekly_voice_minutes = weekly_voice_minutes + 1 WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId, amount],
  );
}

export async function setProgress(guildId: string, userId: string, xp: number, level: number) {
  await pool.query(
    "UPDATE leveling_members SET xp = $3, level = $4 WHERE guild_id = $1 AND user_id = $2",
    [guildId, userId, xp, level],
  );
}

export async function resetMember(guildId: string, userId: string) {
  await pool.query("DELETE FROM leveling_members WHERE guild_id = $1 AND user_id = $2", [guildId, userId]);
}

export async function leaderboard(guildId: string, category: string) {
  const column: Record<string, string> = {
    allTime: "xp", allTimeMessage: "messages", allTimeVoice: "voice_minutes",
    weeklyMessage: "weekly_messages", weeklyVoice: "weekly_voice_minutes",
  };
  const selected = column[category] ?? "xp";
  const result = await pool.query(
    `SELECT user_id, username, xp, level, messages, voice_minutes, weekly_messages, weekly_voice_minutes
     FROM leveling_members WHERE guild_id = $1 ORDER BY ${selected} DESC, user_id ASC LIMIT 100`,
    [guildId],
  );
  return result.rows;
}

export async function resetWeekly(guildId?: string) {
  await pool.query(guildId
    ? "UPDATE leveling_members SET weekly_messages = 0, weekly_voice_minutes = 0 WHERE guild_id = $1"
    : "UPDATE leveling_members SET weekly_messages = 0, weekly_voice_minutes = 0", guildId ? [guildId] : []);
}

export async function allGuilds() {
  const result = await pool.query<{ guild_id: string; config: GuildConfig }>("SELECT guild_id, config FROM leveling_guilds");
  return result.rows;
}

export async function toggleNoPrefix(guildId: string, subjectId: string, subjectType: "user" | "role", expiresAt?: Date) {
  const existing = await pool.query(
    "SELECT 1 FROM leveling_no_prefix WHERE guild_id = $1 AND subject_id = $2 AND subject_type = $3",
    [guildId, subjectId, subjectType],
  );
  if (existing.rowCount) {
    await pool.query("DELETE FROM leveling_no_prefix WHERE guild_id = $1 AND subject_id = $2 AND subject_type = $3", [guildId, subjectId, subjectType]);
    return false;
  }
  await pool.query(
    "INSERT INTO leveling_no_prefix (guild_id, subject_id, subject_type, expires_at) VALUES ($1, $2, $3, $4)",
    [guildId, subjectId, subjectType, expiresAt ?? null],
  );
  return true;
}

export async function hasNoPrefix(guildId: string, userId: string, roleIds: string[]) {
  const result = await pool.query(
    `SELECT 1 FROM leveling_no_prefix WHERE guild_id = $1 AND (subject_id = $2 OR subject_id = ANY($3))
     AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
    [guildId, userId, roleIds],
  );
  return Boolean(result.rowCount);
}