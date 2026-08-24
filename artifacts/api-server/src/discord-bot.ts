import {
  ActivityType, Client, Collection, Events, GatewayIntentBits, GuildMember,
  Interaction, REST, Routes, SlashCommandBuilder, StringSelectMenuBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ModalBuilder,
  TextInputBuilder, TextInputStyle, PermissionFlagsBits, ChannelType,
} from "discord.js";
import { logger } from "./lib/logger";
import {
  addChatXp, addVoiceMinute, allGuilds, defaultConfig, getConfig, getMember,
  initStore, leaderboard, resetMember, resetWeekly, setProgress, toggleNoPrefix,
  updateConfig, hasNoPrefix,
} from "./lib/guild-store";

const OWNER_ID = "1262248731353546763";
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates,
  ],
});

const slashCommands = [
  new SlashCommandBuilder().setName("leaderboard").setDescription("View a guild leaderboard"),
  new SlashCommandBuilder().setName("rank").setDescription("View a member rank").addUserOption(o => o.setName("user").setDescription("Member").setRequired(false)),
  new SlashCommandBuilder().setName("givexp").setDescription("Give XP").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString()).addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)).addIntegerOption(o => o.setName("amount").setDescription("XP").setRequired(true)),
  new SlashCommandBuilder().setName("removexp").setDescription("Remove XP").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString()).addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)).addIntegerOption(o => o.setName("amount").setDescription("XP").setRequired(true)),
  new SlashCommandBuilder().setName("give-level").setDescription("Give levels").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString()).addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)).addIntegerOption(o => o.setName("amount").setDescription("Levels").setRequired(true)),
  new SlashCommandBuilder().setName("remove-level").setDescription("Remove levels").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString()).addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)).addIntegerOption(o => o.setName("amount").setDescription("Levels").setRequired(true)),
  new SlashCommandBuilder().setName("reset").setDescription("Reset a member").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString()).addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)),
  new SlashCommandBuilder().setName("noprefix").setDescription("Toggle no-prefix access").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString()).addUserOption(o => o.setName("user").setDescription("Member").setRequired(false)).addRoleOption(o => o.setName("role").setDescription("Role").setRequired(false)).addIntegerOption(o => o.setName("duration").setDescription("Duration in minutes").setRequired(false)),
  new SlashCommandBuilder().setName("help").setDescription("Show all bot commands"),
].map(command => command.toJSON());

const categories = ["allTime", "allTimeMessage", "allTimeVoice", "weeklyMessage", "weeklyVoice"] as const;
const categoryLabels = ["All Time Ranking", "All Time Message", "All Time Voice", "Weekly Message", "Weekly Voice"];
const icons = ["<:Ranked_One_Above_All:1526829944947216384> π", "<a:Chat:1526829172838633472> ∂", "<:Staffvcmod_SG:1526829293123141733> ∫", "<:cal:1526827284923678791> π", "<a:Clock:1526828668586823800> π"];

function isPrivileged(interactionOrMember: Interaction | GuildMember) {
  if (interactionOrMember instanceof GuildMember) {
    return interactionOrMember.user.id === OWNER_ID || interactionOrMember.guild.ownerId === interactionOrMember.user.id;
  }
  return interactionOrMember.user.id === OWNER_ID || interactionOrMember.guild?.ownerId === interactionOrMember.user.id;
}

function mention(id: string) { return `<@${id}>`; }
function goal(config: typeof defaultConfig, level: number) { return config.xpGoalBase + level * config.xpGoalStep; }
function progressBar(percent: number) {
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
  return "▰".repeat(filled) + "▱".repeat(10 - filled);
}

async function levelCheck(guildId: string, userId: string, username: string, member?: GuildMember) {
  const config = await getConfig(guildId);
  const row = await getMember(guildId, userId);
  if (!row) return;
  let level = row.level;
  while (row.xp >= goal(config, level)) level++;
  if (level === row.level) return;
  await setProgress(guildId, userId, row.xp, level);
  const roleId = config.levelRoles[String(level)];
  if (member && roleId) {
    const role = member.guild.roles.cache.get(roleId);
    if (role) await member.roles.add(role).catch(() => undefined);
    for (const [configuredLevel, configuredRoleId] of Object.entries(config.levelRoles)) {
      if (Number(configuredLevel) > level) {
        const oldRole = member.guild.roles.cache.get(configuredRoleId);
        if (oldRole) await member.roles.remove(oldRole).catch(() => undefined);
      }
    }
  }
  return level;
}

async function sendLeaderboard(interaction: Interaction, categoryIndex: number, page: number) {
  if (!interaction.guild) return;
  const rows = await leaderboard(interaction.guild.id, categories[categoryIndex]);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const title = `${icons[categoryIndex]} ${categoryLabels[categoryIndex]}`;
  const lines = rows.slice(safePage * pageSize, (safePage + 1) * pageSize).map((row, i) => {
    const value = categories[categoryIndex] === "allTime" ? `Lvl ${row.level} (${row.xp} XP)` :
      categories[categoryIndex] === "allTimeMessage" ? `${row.messages} Messages` :
      categories[categoryIndex] === "allTimeVoice" ? `${row.voice_minutes} Minutes` :
      categories[categoryIndex] === "weeklyMessage" ? `${row.weekly_messages} Messages` : `${row.weekly_voice_minutes} minutes`;
    return `**${safePage * pageSize + i + 1}. ${mention(row.user_id)} — ${value}**`;
  });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`lb:${categoryIndex}:${safePage - 1}`).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(safePage === 0),
    new ButtonBuilder().setCustomId(`lb:${categoryIndex}:${safePage + 1}`).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1),
  );
  const content = `## ${title}\n--------------------------------------\n${lines.join("\n") || "No activity yet."}\n\n_Page ${safePage + 1}/${totalPages} • π_`;
  if (interaction.isButton()) await interaction.update({ content, components: [row] });
  else if (interaction.isChatInputCommand() || interaction.isStringSelectMenu()) {
    await interaction.reply({ content, components: [row] });
  }
}

function helpText() {
  return [
    "## Leveling Bot Commands",
    "`/leaderboard` or `!lb` — choose a leaderboard category",
    "`/rank [user]` or `!rank/!r [user]` — view stats",
    "`/givexp`, `/removexp`, `/give-level`, `/remove-level`, `/reset` — owner/admin controls",
    "`/noprefix` or `!NoPrefix` — toggle no-prefix access for a user or role",
    "`!setup` — open guild setup controls",
    "`!announce [#channel]` — configure weekly announcement destination",
    "`!setstaff [role]` / `!setadmin [role]` — exclude staff/admin roles from announcement rankings",
    "`!status` — bot status panel; `!say [message] [repeat] [#channel]` — owner broadcast",
    "All settings and XP are separate for every server. Commands reply with normal messages, not embeds.",
  ].join("\n");
}

async function rankText(guildId: string, userId: string, displayName: string) {
  const config = await getConfig(guildId);
  const row = await getMember(guildId, userId);
  if (!row) return `## <a:stats:1526828029790130217> ∫ ${displayName}'s Stats\nNo leveling data yet.`;
  const next = goal(config, row.level);
  const percent = Math.floor((row.xp / Math.max(1, next)) * 100);
  const all = await leaderboard(guildId, "allTime");
  const weekly = await leaderboard(guildId, "weeklyMessage");
  const voice = await leaderboard(guildId, "weeklyVoice");
  return `## <a:stats:1526828029790130217> ∫ ${displayName}'s Stats\n**Level ${row.level} • ${row.xp}/ ${next} XP • ${percent}%**\n${progressBar(percent)}\n<a:cup:1526827406160298036> Leaderboard Rank: #${all.findIndex(x => x.user_id === userId) + 1}\n<:cal:1526827284923678791> Weekly Rank: <a:Chat:1526829172838633472> #${weekly.findIndex(x => x.user_id === userId) + 1} • <:Staffvcmod_SG:1526829293123141733> #${voice.findIndex(x => x.user_id === userId) + 1}`;
}

async function handleAdmin(guild: NonNullable<Interaction["guild"]>, actorId: string, action: string, targetId: string, amount?: number) {
  if (actorId !== OWNER_ID && guild.ownerId !== actorId) return "Only the server owner or the bot owner can use this command.";
  const member = await guild.members.fetch(targetId);
  const current = await getMember(guild.id, targetId);
  if (action === "reset") { await resetMember(guild.id, targetId); return `${mention(targetId)} has been reset in this server.`; }
  if (!current) return "That member has no leveling record yet.";
  if (action === "xp") await setProgress(guild.id, targetId, Math.max(0, Number(current.xp) + (amount ?? 0)), current.level);
  if (action === "level") await setProgress(guild.id, targetId, Number(current.xp), Math.max(0, Number(current.level) + (amount ?? 0)));
  await levelCheck(guild.id, targetId, member.user.username, member);
  return `${mention(targetId)} updated by ${amount} ${action}.`;
}

async function processPrefix(message: import("discord.js").Message, command: string, args: string[]): Promise<unknown> {
  if (!message.guild || message.author.bot) return;
  const privileged = message.author.id === OWNER_ID || message.guild.ownerId === message.author.id;
  const target = message.mentions.users.first();
  if (command === "help") return message.reply(helpText());
  if (command === "lb") return sendLeaderboardForMessage(message);
  if (command === "rank" || command === "r") return message.reply(await rankText(message.guild.id, target?.id ?? message.author.id, target?.username ?? message.member?.displayName ?? message.author.username));
  if (["givexp", "gxp", "removexp", "rxp", "give-level", "gl", "remove-level", "rl", "reset", "res"].includes(command)) {
    if (!privileged || !target) return message.reply("Only the server owner or bot owner can use this command, and a user is required.");
    const amount = Number(args.find(arg => /^-?\d+$/.test(arg)) ?? 0);
    const action = command.includes("level") || ["gl", "rl"].includes(command) ? "level" : command.startsWith("reset") || command === "res" ? "reset" : "xp";
    return message.reply(await handleAdmin(message.guild, message.author.id, action, target.id, command.startsWith("remove") || ["rxp", "rl"].includes(command) ? -Math.abs(amount) : amount));
  }
  if (command === "noprefix") {
    if (!privileged) return message.reply("Only the server owner or bot owner can use this command.");
    const role = message.mentions.roles.first();
    const id = target?.id ?? role?.id;
    if (!id) return message.reply("Mention a user or role.");
    const duration = Number(args.find(arg => /^\d+$/.test(arg)) ?? 0);
    const active = await toggleNoPrefix(message.guild.id, id, role ? "role" : "user", duration ? new Date(Date.now() + duration * 60_000) : undefined);
    return message.reply(`${role ? "Role" : "User"} ${mention(id)} no-prefix mode ${active ? "enabled" : "removed"}.`);
  }
  if (command === "setup") {
    if (!privileged) return message.reply("Only the server owner or bot owner can use setup.");
    const subcommand = args[0]?.toLowerCase();
    const config = await getConfig(message.guild.id);
    if (subcommand === "chatxp" && Number(args[1]) >= 0) await updateConfig(message.guild.id, { chatXp: Number(args[1]) });
    else if (subcommand === "voicexp" && Number(args[1]) >= 0) await updateConfig(message.guild.id, { voiceXpPerMinute: Number(args[1]) });
    else if (subcommand === "levelupchannel") await updateConfig(message.guild.id, { levelUpChannelId: message.mentions.channels.first()?.id });
    else if (subcommand === "mainchannel") await updateConfig(message.guild.id, { mainChannelId: message.mentions.channels.first()?.id });
    else if (subcommand === "levelrole" && Number(args[1]) >= 0) await updateConfig(message.guild.id, { levelRoles: { ...config.levelRoles, [args[1]]: message.mentions.roles.first()?.id ?? "" } });
    else if (subcommand === "booster" && message.mentions.roles.first() && Number(args[2]) >= 0) await updateConfig(message.guild.id, { boosterRoleId: message.mentions.roles.first()!.id, boosterAmount: Number(args[2]) });
    else if (["allowchat", "blockchat", "allowvoice", "blockvoice"].includes(subcommand ?? "") && message.mentions.channels.first()) {
      const field = subcommand === "allowchat" ? "allowedMessageChannels" : subcommand === "blockchat" ? "blockedMessageChannels" : subcommand === "allowvoice" ? "allowedVoiceChannels" : "blockedVoiceChannels";
      const values = [...new Set([...config[field], message.mentions.channels.first()!.id])];
      await updateConfig(message.guild.id, { [field]: values });
    } else if (["blockchatuser", "blockvoiceuser"].includes(subcommand ?? "") && message.mentions.users.first()) {
      const field = subcommand === "blockchatuser" ? "blockedUsersChat" : "blockedUsersVoice";
      await updateConfig(message.guild.id, { [field]: [...new Set([...config[field], message.mentions.users.first()!.id])] });
    } else if (["blockchatrole", "blockvoicerole"].includes(subcommand ?? "") && message.mentions.roles.first()) {
      const field = subcommand === "blockchatrole" ? "blockedRolesChat" : "blockedRolesVoice";
      await updateConfig(message.guild.id, { [field]: [...new Set([...config[field], message.mentions.roles.first()!.id])] });
    } else if (subcommand === "goals" && Number(args[1]) >= 0 && Number(args[2]) >= 0) {
      await updateConfig(message.guild.id, { xpGoalBase: Number(args[1]), xpGoalStep: Number(args[2]) });
    } else if (subcommand === "format" && args.slice(1).join(" ").length > 0) {
      await updateConfig(message.guild.id, { levelUpFormat: args.slice(1).join(" ") });
    }
    else return message.reply(`## Guild Setup\nCurrent chat XP: ${config.chatXp} per message\nCurrent voice XP: ${config.voiceXpPerMinute} per minute\nLevel-up channel: ${config.levelUpChannelId ? `<#${config.levelUpChannelId}>` : "not set"}\nMain channel: ${config.mainChannelId ? `<#${config.mainChannelId}>` : "not set"}\n\nUse \`!setup chatxp <amount>\`, \`!setup voicexp <amount>\`, \`!setup levelupchannel #channel\`, \`!setup mainchannel #channel\`, \`!setup levelrole <level> @role\`, or \`!setup booster @role <amount>\`.\nAll changes apply only to this server.`);
    return message.reply("Guild setup updated.");
  }
  if (command === "announce" && privileged) {
    const channel = message.mentions.channels.first();
    if (!channel || channel.type !== ChannelType.GuildText) return message.reply("Mention a text channel.");
    await updateConfig(message.guild.id, { weeklyAnnouncementChannelId: channel.id });
    return message.reply(`Weekly leaderboard announcements will be sent to ${channel}.`);
  }
  if (command === "setstaff" || command === "setadmin") {
    if (!privileged) return message.reply("Only the server owner or bot owner can use this command.");
    const role = message.mentions.roles.first() ?? message.guild.roles.cache.find(r => r.name.toLowerCase() === args.join(" ").toLowerCase());
    if (!role) return message.reply("Mention a role or provide its exact name.");
    const config = await getConfig(message.guild.id);
    const key = command === "setstaff" ? "staffRoles" : "adminRoles";
    await updateConfig(message.guild.id, { [key]: [...new Set([...config[key], role.id])] });
    return message.reply(`${role} added to ${command === "setstaff" ? "staff" : "admin"} exclusions.`);
  }
  if (command === "say" && message.author.id === OWNER_ID) {
    const channel = message.mentions.channels.first() ?? message.channel;
    const repeat = Math.max(1, Math.min(20, Number(args.find(arg => /^\d+$/.test(arg)) ?? 1)));
    const text = args.filter(arg => !/^\d+$/.test(arg) && !arg.startsWith("<#")).join(" ").trim();
    if (channel.isTextBased() && "send" in channel) {
      for (let i = 0; i < repeat; i++) await channel.send(text);
    }
    return;
  }
  if (command === "status" && message.author.id === OWNER_ID) {
    if (args[0] && ["online", "idle", "dnd", "invisible"].includes(args[0].toLowerCase())) {
      const status = args[0].toLowerCase() as "online" | "idle" | "dnd" | "invisible";
      const statusMessage = args.slice(1).join(" ") || "leveling up the server";
      await updateConfig(message.guild.id, { statusType: status, statusMessage });
      await client.user?.setPresence({ activities: [{ name: statusMessage, type: ActivityType.Playing }], status });
      return message.reply(`Bot status set to ${status}: ${statusMessage}`);
    }
    const menu = new StringSelectMenuBuilder().setCustomId("statusmenu").setPlaceholder("Choose bot presence").addOptions(
      ["online", "idle", "dnd", "invisible"].map(value => ({ label: value, value })),
    );
    return message.reply({ content: "Owner status panel — choose a presence, then use `!status <type> <message>` to set its text.", components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] });
  }
  const noPrefix = await hasNoPrefix(message.guild.id, message.author.id, message.member?.roles.cache.map(r => r.id) ?? []);
  if (noPrefix) return processPrefix(message, command, args);
  return;
}

async function sendLeaderboardForMessage(message: import("discord.js").Message) {
  const menu = new StringSelectMenuBuilder().setCustomId(`lbmenu:${message.author.id}`).setPlaceholder("Choose a leaderboard").addOptions(categoryLabels.map((label, i) => ({ label, value: String(i), description: label })));
  return message.reply({ content: "Choose a leaderboard to view:", components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] });
}

async function interactionHandler(interaction: Interaction) {
  if (!interaction.guild) return;
  if (interaction.isButton() && interaction.customId.startsWith("lb:")) {
    const [, category, page] = interaction.customId.split(":");
    return sendLeaderboard(interaction, Number(category), Number(page));
  }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("lbmenu:")) return sendLeaderboard(interaction, Number(interaction.values[0]), 0);
  if (interaction.isStringSelectMenu() && interaction.customId === "statusmenu") {
    if (interaction.user.id !== OWNER_ID) return interaction.reply("Only the bot owner can change status.");
    const selected = interaction.values[0] as "online" | "idle" | "dnd" | "invisible";
    await client.user?.setPresence({ activities: [{ name: (await getConfig(interaction.guild.id)).statusMessage, type: ActivityType.Playing }], status: selected });
    await updateConfig(interaction.guild.id, { statusType: selected });
    return interaction.reply(`Bot presence set to ${selected}.`);
  }
  if (!interaction.isChatInputCommand()) return;
  const name = interaction.commandName;
  if (name === "help") return interaction.reply(helpText());
  if (name === "leaderboard") {
    const menu = new StringSelectMenuBuilder().setCustomId(`lbmenu:${interaction.user.id}`).setPlaceholder("Choose a leaderboard").addOptions(categoryLabels.map((label, i) => ({ label, value: String(i), description: label })));
    return interaction.reply({ content: "Choose a leaderboard to view:", components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] });
  }
  if (name === "rank") {
    const user = interaction.options.getUser("user") ?? interaction.user;
    return interaction.reply(await rankText(interaction.guild.id, user.id, user.username));
  }
  if (["givexp", "removexp", "give-level", "remove-level", "reset"].includes(name)) {
    if (!isPrivileged(interaction)) return interaction.reply("Only the server owner or bot owner can use this command.");
    const user = interaction.options.getUser("user", true);
    const amount = interaction.options.getInteger("amount") ?? 0;
    const action = name.includes("level") ? "level" : name === "reset" ? "reset" : "xp";
    const signed = name.startsWith("remove") ? -Math.abs(amount) : amount;
    return interaction.reply(await handleAdmin(interaction.guild, interaction.user.id, action, user.id, signed));
  }
  if (name === "noprefix") {
    if (!isPrivileged(interaction)) return interaction.reply("Only the server owner or bot owner can use this command.");
    const user = interaction.options.getUser("user");
    const role = interaction.options.getRole("role");
    if (!user && !role) return interaction.reply("Choose a user or role.");
    const duration = interaction.options.getInteger("duration");
    const id = user?.id ?? role!.id;
    const active = await toggleNoPrefix(interaction.guild.id, id, role ? "role" : "user", duration ? new Date(Date.now() + duration * 60_000) : undefined);
    return interaction.reply(`No-prefix mode ${active ? "enabled" : "removed"} for ${user ? mention(id) : role}.`);
  }
}

client.once(Events.ClientReady, async ready => {
  logger.info({ tag: ready.user.tag }, "Discord bot ready");
  await ready.user.setPresence({ activities: [{ name: "leveling up the server", type: ActivityType.Playing }], status: "online" });
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!);
  await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!), { body: slashCommands });
});

client.on(Events.InteractionCreate, interaction => interactionHandler(interaction).catch(err => logger.error({ err }, "Discord interaction failed")));
client.on(Events.MessageCreate, message => {
  if (message.content.startsWith("!")) {
    const parts = message.content.slice(1).trim().split(/\s+/);
    const command = parts.shift()?.toLowerCase();
    if (command) processPrefix(message, command, parts).catch(err => logger.error({ err }, "Discord prefix command failed"));
    return;
  }
  if (message.guild && !message.author.bot) {
    getConfig(message.guild.id).then(async config => {
      if (config.blockedUsersChat.includes(message.author.id) || config.blockedMessageChannels.includes(message.channel.id)) return;
      const booster = message.member?.roles.cache.has(config.boosterRoleId ?? "") ? config.boosterAmount : 0;
      await addChatXp(message.guild!.id, message.author.id, message.author.username, config.chatXp + booster);
      const level = await levelCheck(message.guild!.id, message.author.id, message.author.username, message.member ?? undefined);
      if (level && config.levelUpChannelId) {
        const channel = message.guild!.channels.cache.get(config.levelUpChannelId);
        if (channel?.isTextBased() && "send" in channel) {
          await channel.send(`<:SC_Rankings:1526826834040193116> ** ${message.author} Congratulations! You Just Reached Level ${level} **\n<a:Stars:1526827005729964094> Keep Grinding To Obtain More Perks By Leveling Up In ${config.mainChannelId ? `<#${config.mainChannelId}>` : "the main channel"} And To Be In List Of Active Members!`);
        }
      }
    }).catch(err => logger.error({ err }, "Discord XP update failed"));
  }
});

let lastWeeklyResetKey = "";

setInterval(async () => {
  for (const guild of client.guilds.cache.values()) {
    for (const member of guild.members.cache.values()) {
      if (!member.user.bot && member.voice.channelId) {
        const config = await getConfig(guild.id);
        if (!config.blockedUsersVoice.includes(member.id) && !config.blockedVoiceChannels.includes(member.voice.channelId)) {
          await addVoiceMinute(guild.id, member.id, member.user.username, config.voiceXpPerMinute);
          await levelCheck(guild.id, member.id, member.user.username, member);
        }
      }
    }
  }
}, 60_000);

setInterval(async () => {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const resetKey = `${ist.getFullYear()}-${ist.getMonth()}-${ist.getDate()}`;
  if (ist.getDay() === 0 && ist.getHours() === 12 && ist.getMinutes() === 30 && resetKey !== lastWeeklyResetKey) {
    lastWeeklyResetKey = resetKey;
    for (const { guild_id: guildId, config } of await allGuilds()) {
      if (!config.weeklyAnnouncementChannelId) continue;
      const guild = client.guilds.cache.get(guildId);
      const channel = guild?.channels.cache.get(config.weeklyAnnouncementChannelId);
      if (guild && channel?.isTextBased()) {
        const chatRows = await leaderboard(guildId, "weeklyMessage");
        const voiceRows = await leaderboard(guildId, "weeklyVoice");
        const excluded = (row: { user_id: string }) => {
          const member = guild.members.cache.get(row.user_id);
          return !member || member.roles.cache.some(role => config.adminRoles.includes(role.id));
        };
        const normalChat = chatRows.filter(excluded).filter(row => {
          const member = guild.members.cache.get(row.user_id);
          return !member?.roles.cache.some(role => config.staffRoles.includes(role.id));
        });
        const normalVoice = voiceRows.filter(excluded).filter(row => {
          const member = guild.members.cache.get(row.user_id);
          return !member?.roles.cache.some(role => config.staffRoles.includes(role.id));
        });
        const staffChat = chatRows.filter(excluded).filter(row => guild.members.cache.get(row.user_id)?.roles.cache.some(role => config.staffRoles.includes(role.id)));
        const staffVoice = voiceRows.filter(excluded).filter(row => guild.members.cache.get(row.user_id)?.roles.cache.some(role => config.staffRoles.includes(role.id)));
        const chat = normalChat;
        const voice = normalVoice;
        const text = (config.weeklyAnnouncementFormat ?? defaultConfig.weeklyAnnouncementFormat!)
          .replace(/\[1st Person On Weekly Chat Leaderboard\]/g, chat[0] ? mention(chat[0].user_id) : "—")
          .replace(/\[2nd Person On Weekly Chat Leaderboard\]/g, chat[1] ? mention(chat[1].user_id) : "—")
          .replace(/\[3rd Person On Weekly Chat Leaderboard\]/g, chat[2] ? mention(chat[2].user_id) : "—")
          .replace(/\[1st Person Total Weekly Messages\]/g, chat[0]?.weekly_messages?.toString() ?? "0")
          .replace(/\[2nd Person Total Weekly Messages\]/g, chat[1]?.weekly_messages?.toString() ?? "0")
          .replace(/\[3rd Person Total Weekly Messages\]/g, chat[2]?.weekly_messages?.toString() ?? "0")
          .replace(/\[1st Person On Weekly Voice Leaderboard\]/g, voice[0] ? mention(voice[0].user_id) : "—")
          .replace(/\[2nd Person On Weekly Voice Leaderboard\]/g, voice[1] ? mention(voice[1].user_id) : "—")
          .replace(/\[3rd Person On Weekly Voice Leaderboard\]/g, voice[2] ? mention(voice[2].user_id) : "—")
          .replace(/\[1st Person Total Weekly Voice Time\]/g, voice[0]?.weekly_voice_minutes?.toString() ?? "0")
          .replace(/\[2nd Person Total Weekly Voice Time\]/g, voice[1]?.weekly_voice_minutes?.toString() ?? "0")
          .replace(/\[3rd Person Total Weekly Voice Time\]/g, voice[2]?.weekly_voice_minutes?.toString() ?? "0")
          .replace(/\[Top Staff In Weekly Chat Leaderboard\]/g, staffChat[0] ? mention(staffChat[0].user_id) : "—")
          .replace(/\[Top Staff Total Message In Weekly Leaderboard\]/g, staffChat[0]?.weekly_messages?.toString() ?? "0")
          .replace(/\[Top Staff In Weekly Voice Leaderboard\]/g, staffVoice[0] ? mention(staffVoice[0].user_id) : "—")
          .replace(/\[Top Staff Total Voice Time In Weekly Leaderboard\]/g, staffVoice[0]?.weekly_voice_minutes?.toString() ?? "0");
        await channel.send(text);
      }
      await resetWeekly(guildId);
    }
  }
}, 60_000);

export async function startDiscordBot() {
  if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID) {
    logger.warn("DISCORD_TOKEN and DISCORD_CLIENT_ID are not set; Discord bot is disabled.");
    return;
  }
  await initStore();
  await client.login(process.env.DISCORD_TOKEN);
}