import "dotenv/config";
import { Client, Events, GatewayIntentBits, VoiceChannel } from "discord.js";
import { joinVoiceChannel, getVoiceConnection } from "@discordjs/voice";

import { logger } from "./logger";
import { TranscriptionAssemblyAI } from "./services/transcription";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const transcription = new TranscriptionAssemblyAI();

const activeUsers = new Set<string>();
const receivers = new Set<string>();

client.on(Events.ClientReady, (bot) => {
  logger.info(`${bot.user.tag} Logged in!`);
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  const newChannel = newState.channel;
  const oldChannel = oldState.channel;

  if (newChannel && newChannel instanceof VoiceChannel) {
    const nonBots = newChannel.members.filter((m) => !m.user.bot);

    if (nonBots.size > 0) {
      const connection = joinVoiceChannel({
        channelId: newChannel.id,
        guildId: newChannel.guild.id,
        adapterCreator: newChannel.guild.voiceAdapterCreator,
      });

      const receiver = connection.receiver;

      if (!receivers.has(newChannel.guild.id)) {
        receivers.add(newChannel.guild.id);

        receiver.speaking.on("start", async (userId) => {
          if (activeUsers.has(userId)) return;
          activeUsers.add(userId);

          logger.info(`Started recording user ${userId}`);
          transcription.transcribeStream(receiver, userId);
        });
      }
    }
  }

  if (oldChannel && (!newChannel || oldChannel.id !== newChannel.id)) {
    const remaining = oldChannel.members.filter((m) => !m.user.bot);
    if (remaining.size === 0) {
      logger.info(`No more users in ${oldChannel.name}, leaving.`);

      const connection = getVoiceConnection(oldChannel.guild.id);
      if (connection) {
        connection.destroy();
        receivers.delete(oldChannel.guild.id);
      }
    }
  }

  if (
    oldState.selfMute !== newState.selfMute ||
    oldState.selfDeaf !== newState.selfDeaf
  ) {
    const member = newState.member;
    if (member) logger.info(`${member.user.tag} changed mute/deaf status.`);
  }
});

client.login(process.env.DISCORD_TOKEN);
