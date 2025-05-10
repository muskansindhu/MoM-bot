import "dotenv/config";
import { Client, Events, GatewayIntentBits, VoiceChannel } from "discord.js";
import { joinVoiceChannel, getVoiceConnection } from "@discordjs/voice";

import { logger } from "./logger";
import { Transcription } from "./services/transcription";

const fs = require("fs");
const path = require("path");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const transcription = new Transcription();

client.on(Events.ClientReady, (bot) => {
  logger.info(`${bot.user.tag} Logged in!`);
});

const activeRecordings = new Set<string>();
const receivers = new Set<string>();

client.on("voiceStateUpdate", async (oldState, newState) => {
  const newChannel = newState.channel;
  const oldChannel = oldState.channel;
  const botId = client.user?.id;

  // If user joined a channel
  if (newChannel && newChannel instanceof VoiceChannel) {
    const nonMoMBot = newChannel.members.filter((m) => !m.user.bot);

    // Only proceed if there are real users
    if (nonMoMBot.size > 0) {
      const connection = joinVoiceChannel({
        channelId: newChannel.id,
        guildId: newChannel.guild.id,
        adapterCreator: newChannel.guild.voiceAdapterCreator,
      });

      const receiver = connection.receiver;

      if (!receivers.has(newChannel.guild.id)) {
        receivers.add(newChannel.guild.id);

        receiver.speaking.on("start", async (userId) => {
          if (!activeRecordings.has(userId)) {
            activeRecordings.add(userId);
            logger.info(`Started recording user ${userId}`);
            transcription.transcribe(receiver, userId);
          }
        });
      }
    } else {
      logger.info("No non-bot users in channel, not joining.");
    }
  }

  // If user left a channel
  if (oldChannel && (!newChannel || oldChannel.id !== newChannel.id)) {
    const remainingMembers = oldChannel.members.filter((m) => !m.user.bot);

    // If only the bot is left
    if (remainingMembers.size === 0) {
      logger.info(`No more users in ${oldChannel.name}, leaving.`);

      const connection = getVoiceConnection(oldChannel.guild.id);
      if (connection) {
        connection.destroy();
        receivers.delete(oldChannel.guild.id);
        await transcription.transcribeAllAudios();
      }
    }
  }

  // Log mute/deaf changes
  if (
    oldState.selfMute !== newState.selfMute ||
    oldState.selfDeaf !== newState.selfDeaf
  ) {
    const member = newState.member;
    if (member) {
      logger.info(`${member.user.tag} changed mute/deaf status.`);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
