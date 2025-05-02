import fs from "fs";
import path from "path";
import prism from "prism-media";
import ffmpeg from "fluent-ffmpeg";
import { PassThrough } from "stream";
import { EndBehaviorType, VoiceReceiver } from "@discordjs/voice";

import { logger } from "../logger";

export class Transcription {
  async transcribe(receiver: VoiceReceiver, userId: string) {
    const outputDir = "./recordings";
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      logger.info(`Created output directory at ${outputDir}`);
    }

    logger.info(`Starting transcription for user ${userId}`);
    const rawStream = this.opusToPcm(receiver, userId);

    let chunkIndex = 0;
    let buffer: Buffer[] = [];
    rawStream.on("data", (chunk) => {
      buffer.push(chunk);
    });

    try {
      await this.processChunksLoop(userId, buffer, chunkIndex, outputDir);
    } catch (err) {
      logger.error(`Error in transcription process for ${userId}: ${err}`);
    }
  }

  opusToPcm(receiver: VoiceReceiver, userId: string) {
    logger.debug(`Subscribing to voice receiver for user ${userId}`);

    const opusStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.Manual,
      },
    });

    const decoder = new prism.opus.Decoder({
      frameSize: 960,
      channels: 1,
      rate: 48000,
    });

    const rawStream = opusStream.pipe(decoder);
    logger.debug(`Initialized Opus decoder for user ${userId}`);
    return rawStream;
  }

  async pcmToWav(pass: PassThrough, outputPath: string) {
    logger.debug(`Starting FFmpeg process for ${outputPath}`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(pass)
        .inputFormat("s16le")
        .audioFrequency(48000)
        .audioChannels(1)
        .audioCodec("libmp3lame")
        .format("mp3")
        .on("start", () => {
          logger.info(`FFmpeg started writing to ${outputPath}`);
        })
        .on("end", () => {
          logger.info(`FFmpeg finished writing ${outputPath}`);
          resolve();
        })
        .on("error", (err) => {
          logger.error(`FFmpeg error while writing ${outputPath}: ${err}`);
          reject(err);
        })
        .save(outputPath);
    });
  }

  async processChunksLoop(
    userId: string,
    buffer: Buffer[],
    chunkIndex: number,
    outputDir: string
  ) {
    logger.info(`Processing chunks for user ${userId}`);
    while (true) {
      if (buffer.length === 0) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }

      const chunkDurationMs = 20_000;
      const bytesPerSecond = 48000 * 2;
      const chunkSize = bytesPerSecond * (chunkDurationMs / 1000);
      const chunkBuffer = Buffer.concat(buffer);

      if (chunkBuffer.length < chunkSize) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }

      const audioChunk = chunkBuffer.slice(0, chunkSize);
      buffer.splice(0, buffer.length, chunkBuffer.slice(chunkSize));

      const pass = new PassThrough();
      pass.end(audioChunk);

      const timestamp = Date.now();
      const outputPath = path.join(
        outputDir,
        `${userId}-${timestamp}-chunk${chunkIndex}.mp3`
      );

      logger.debug(`Saving audio chunk ${chunkIndex} for user ${userId}`);
      await this.pcmToWav(pass, outputPath);
      chunkIndex++;
    }
  }
}
