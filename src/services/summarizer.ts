import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function summarizeTranscript(filePath: string): Promise<string> {
  if (!fs.existsSync(filePath)) {
    return "Transcript file not found.";
  }

  const transcriptText = fs.readFileSync(filePath, "utf8");

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = `
You are a meeting summarizer.
Summarize the following transcript into clear bullet points.
Keep it concise, structured, and readable.

Transcript:
${transcriptText}
`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}
