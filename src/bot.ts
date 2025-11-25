import "dotenv/config";
import { Client, Events, GatewayIntentBits, VoiceChannel } from "discord.js";
import { joinVoiceChannel, getVoiceConnection } from "@discordjs/voice";

import { logger } from "./logger";
import { TranscriptionAssemblyAI } from "./services/transcription";
import { summarizeTranscript } from "./services/summarizer";
import fs from "fs";

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
        const transcriptFiles = fs
          .readdirSync("./transcripts")
          .filter((f) => f.endsWith(".txt"))
          .map((f) => `./transcripts/${f}`)
          .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);

        if (transcriptFiles.length === 0) {
          logger.warn("⚠️ No transcript file found to summarize.");
          return;
        }

        const latestTranscript = transcriptFiles[transcriptFiles.length - 1];
        logger.info(
          `📝 Summarizing MOST RECENT transcript: ${latestTranscript}`
        );

        const summary = await summarizeTranscript(latestTranscript);

        const summaryChannel = oldChannel.guild.channels.cache.find(
          (c) => c.name === "general" && c.isTextBased()
        );

        if (summaryChannel && summaryChannel.isTextBased()) {
          summaryChannel.send("📄 **Meeting Summary**:\n\n" + summary);
        }
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
