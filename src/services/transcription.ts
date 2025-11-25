import prism from "prism-media";
import WebSocket from "ws";
import { Transform, PassThrough, Readable } from "stream";
import { VoiceReceiver, EndBehaviorType } from "@discordjs/voice";
import { logger } from "../logger";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";

process.env.PRISM_MEDIA_OPUS = "native";

export class TranscriptionAssemblyAI {
  private readonly INPUT_SAMPLE_RATE = 48000;
  private readonly CHANNELS = 1;
  private readonly SKIP_PACKETS = 150;
  private readonly MIN_OPUS_BYTES = 5;
  private readonly API_KEY = process.env.ASSEMBLYAI_API_KEY!;
  private readonly TRANSCRIPTS_DIR = path.join(process.cwd(), "transcripts");

  constructor() {
    if (!fs.existsSync(this.TRANSCRIPTS_DIR)) {
      fs.mkdirSync(this.TRANSCRIPTS_DIR, { recursive: true });
      logger.info(`📁 Created transcripts directory: ${this.TRANSCRIPTS_DIR}`);
    }
  }

  private getTranscriptFilePath(userId: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return path.join(
      this.TRANSCRIPTS_DIR,
      `transcript_${userId}_${timestamp}.txt`
    );
  }

  private appendToTranscript(filePath: string, text: string) {
    try {
      const timestamp = new Date().toISOString();
      const line = `[${timestamp}] ${text}\n`;
      fs.appendFileSync(filePath, line, "utf8");
    } catch (err) {
      logger.error("❌ Failed to write transcript:", err);
    }
  }

  private downsample48kTo16k(input: Readable) {
    const output = new PassThrough();
    let pcm48BytesReceived = 0;
    let pcm16BytesOutput = 0;

    input.on("data", (chunk) => {
      pcm48BytesReceived += chunk.length;
      if (pcm48BytesReceived === chunk.length) {
        logger.info(`📥 First PCM48 chunk received: ${chunk.length} bytes`);
      }
      if (pcm48BytesReceived % 10000 < chunk.length) {
        logger.info(`📥 PCM48 total received: ${pcm48BytesReceived} bytes`);
      }
    });

    input.on("end", () => {
      logger.info(`📥 PCM48 stream ended. Total: ${pcm48BytesReceived} bytes`);
    });

    input.on("error", (err) => {
      logger.error("❌ PCM48 input error:", err);
    });

    output.on("data", (chunk) => {
      pcm16BytesOutput += chunk.length;
      if (pcm16BytesOutput === chunk.length) {
        logger.info(`📤 First PCM16 chunk output: ${chunk.length} bytes`);
      }
    });

    const ff = ffmpeg()
      .input(input)
      .inputFormat("s16le")
      .inputOptions(["-ar", "48000", "-ac", "1"])
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec("pcm_s16le")
      .format("s16le")
      .on("start", (cmd) => {
        logger.info("🎵 ffmpeg started:", cmd);
      })
      .on("stderr", (line) => {
        if (
          line.includes("error") ||
          line.includes("warning") ||
          line.includes("size=")
        ) {
          logger.info("ffmpeg:", line);
        }
      })
      .on("error", (err) => {
        logger.error("❌ ffmpeg error:", err);
        output.destroy(err);
      })
      .on("end", () => {
        logger.info("🎵 ffmpeg ended normally");
        output.end();
      });

    ff.pipe(output, { end: true });

    return output;
  }

  async transcribeStream(receiver: VoiceReceiver, userId: string) {
    logger.info(`🎤 Starting live transcription for user ${userId}`);

    const transcriptFile = this.getTranscriptFilePath(userId);
    logger.info(`📝 Saving transcript to: ${transcriptFile}`);

    const ws = await this.createAaiWebsocket(transcriptFile);

    const opus = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.Manual },
    });

    let opusPackets = 0;
    opus.on("data", () => {
      opusPackets++;
      if (opusPackets === 1) {
        logger.info("📦 First Opus packet received from Discord");
      }
    });

    opus.on("end", () => {
      logger.info(`📦 Opus stream ended. Total packets: ${opusPackets}`);
    });

    opus.on("error", (err) => {
      logger.error("❌ Opus stream error:", err);
    });

    const pcm48 = this.opusToPcm(opus);
    const pcm16 = this.downsample48kTo16k(pcm48);

    let firstAudio = false;
    let totalBytesSent = 0;

    pcm16.on("data", (chunk) => {
      if (ws.readyState !== WebSocket.OPEN) {
        logger.warn("⚠️ WebSocket not open, skipping chunk");
        return;
      }

      ws.send(chunk);
      totalBytesSent += chunk.length;

      if (!firstAudio) {
        firstAudio = true;
        logger.info("🎉 First audio frame sent – streaming started.");
      }

      if (totalBytesSent % 10000 < chunk.length) {
        logger.info(`📡 Sent ${totalBytesSent} bytes to AssemblyAI`);
      }
    });

    pcm16.on("end", () => {
      logger.info(`📡 PCM16 stream ended. Total sent: ${totalBytesSent} bytes`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "session-termination" }));
        ws.close();
      }
    });

    pcm16.on("error", (err) => {
      logger.error("❌ PCM16 stream error:", err);
    });
  }

  private async createAaiWebsocket(transcriptFile: string): Promise<WebSocket> {
    const url =
      "wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&encoding=pcm_s16le&format_turns=true";

    const ws = new WebSocket(url, {
      headers: { authorization: this.API_KEY },
    });

    return new Promise((resolve, reject) => {
      ws.on("open", () => {
        logger.info("🔗 Connected to AssemblyAI Streaming");
        logger.info("📤 Waiting for audio...");
        resolve(ws);
      });

      ws.on("message", (msg) => {
        let data: any;
        try {
          data = JSON.parse(msg.toString());
        } catch {
          return;
        }

        if (data.type === "session.begins" || data.type === "Begin") {
          logger.info(`🎬 Session started: ${data.session_id}`);
          this.appendToTranscript(transcriptFile, `=== SESSION STARTED ===`);
        } else if (data.type === "turn" || data.type === "Turn") {
          const formattedMarker = data.turn_is_formatted
            ? "✨ [FORMATTED]"
            : "📝 [RAW]";
          const eotMarker = data.end_of_turn ? " [EOT]" : "";

          logger.info(`${formattedMarker} ${data.transcript}${eotMarker}`);

          if (data.turn_is_formatted && data.transcript.trim().length > 0) {
            this.appendToTranscript(transcriptFile, data.transcript);
          }
        } else {
          logger.info(`📨 Unknown message type: ${data.type}`, data);
        }
      });

      ws.on("error", (err) => {
        logger.error("❌ WebSocket error:", err);
        reject(err);
      });

      ws.on("close", (code, reason) => {
        logger.info(`🔌 WebSocket closed: ${code} - ${reason.toString()}`);
        this.appendToTranscript(transcriptFile, `=== SESSION ENDED ===`);
      });
    });
  }

  private opusToPcm(opusStream: Readable): Readable {
    let skip = this.SKIP_PACKETS;
    let valid = 0;
    let skipped = 0;
    let invalid = 0;

    const stripRtp = (packet: Buffer) =>
      packet.length > 12 && packet[0] >> 6 === 2 ? packet.slice(12) : packet;

    const looksLikeOpus = (buf: Buffer) =>
      buf.length >= this.MIN_OPUS_BYTES &&
      buf.some((b) => b !== 0) &&
      buf[0] >= 0 &&
      buf[0] <= 127;

    const rtpStripper = new Transform({
      transform(chunk, _enc, cb) {
        if (skip-- > 0) {
          skipped++;
          if (skipped === 1) {
            logger.info(`⏭️  Skipping initial packets...`);
          }
          return cb();
        }

        const pkt = stripRtp(chunk);
        if (!looksLikeOpus(pkt)) {
          invalid++;
          if (invalid === 1) {
            logger.warn(
              `⚠️ Invalid Opus packet detected (size: ${pkt.length})`
            );
          }
          return cb();
        }

        valid++;
        if (valid === 1) {
          logger.info("✅ Started processing Opus packets");
          logger.info(`   Skipped: ${skipped}, Invalid: ${invalid}`);
        }
        if (valid % 100 === 0) {
          logger.info(`✅ Processed ${valid} Opus packets`);
        }

        cb(null, pkt);
      },
    });

    const decoder = new prism.opus.Decoder({
      rate: this.INPUT_SAMPLE_RATE,
      channels: this.CHANNELS,
      frameSize: 960,
    });

    let decodedChunks = 0;
    let decodedBytes = 0;
    decoder.on("data", (chunk) => {
      decodedChunks++;
      decodedBytes += chunk.length;
      if (decodedChunks === 1) {
        logger.info(`🔊 First PCM chunk decoded: ${chunk.length} bytes`);
      }
      if (decodedChunks % 50 === 0) {
        logger.info(
          `🔊 Decoded ${decodedChunks} chunks, ${decodedBytes} bytes total`
        );
      }
    });

    decoder.on("error", (err) => {
      logger.error("❌ Opus decoder error:", err);
    });

    return opusStream.pipe(rtpStripper).pipe(decoder);
  }
}
