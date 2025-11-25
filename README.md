# MoM-bot

**MoM-bot** is a Discord bot designed to automatically transcribe and summarize meetings conducted in Discord voice channels. When users join or leave voice channels, MoM-bot records live audio, transcribes speech using AssemblyAI, then summarizes meeting transcripts with Google Gemini, and posts the summary to the `#general` text channel.

## Features

- **Live Voice Transcription:** Automatically records and converts audio in Discord voice channels into text using AssemblyAI’s streaming API.
- **Automated Meeting Summaries:** Uses Google Gemini API to turn meeting transcripts into clear, concise bullet-point summaries.
- **Text Channel Integration:** Posts a structured summary of the latest meeting to the `#general` channel after participants leave.
- **File Management:** Stores transcripts in a local `transcripts/` directory, sorted and managed per user.

## Technology Stack

- **Discord.js & @discordjs/voice:** For Discord bot communication and voice channel interaction.
- **AssemblyAI Streaming:** For real-time audio transcription.
- **Google Gemini API:** For transcript summarization.
- **TypeScript:** Full type safety for all code.
- **Other dependencies:** Axios, dotenv, prism-media, fluent-ffmpeg, winston logging.

## Setup

1. **Clone the repository:**

   ```bash
   git clone https://github.com/muskansindhu/MoM-bot.git
   cd MoM-bot
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Configure environment variables:**

   Create a `.env` file in the root directory and add your keys:

   ```
   DISCORD_TOKEN=your_discord_bot_token
   DISCORD_CLIENT_ID=your_discord_client_id
   ASSEMBLYAI_API_KEY=your_assemblyai_api_key
   GEMINI_API_KEY=your_gemini_api_key
   ```

4. **Start the bot:**

   - For development (using ts-node):
     ```
     npm run dev
     ```
   - For production:
     ```
     npm run build
     npm start
     ```

## Usage

- **Join a voice channel:** MoM-bot connects and starts recording/transcribing audio.
- **End meeting:** Once all non-bot users leave the channel, MoM-bot summarizes the transcript and posts it in `#general`.
- **Transcripts:** All transcripts are saved in the `transcripts/` folder with metadata.

## Repository Structure

```
src/
  bot.ts               # Main Discord bot logic
  logger.ts            # Logging utility
  services/
    summarizer.ts      # Transcript summarizer using Gemini
    transcription.ts   # Voice transcription using AssemblyAI
assets/                # (optional) Static assets
transcripts/           # Generated transcript files
```

## Sample Message

<div align="center">
  <img src="https://github.com/muskansindhu/MoM-bot/blob/main/assets/sample.png" width="500" />
</div>
