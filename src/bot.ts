import 'dotenv/config';
import path from 'path'
import { nodewhisper } from 'nodejs-whisper'
import { Client, GatewayIntentBits, Events } from "discord.js";
import { joinVoiceChannel, getVoiceConnection } from "@discordjs/voice";

const fs = require('fs');
const { opus } = require('prism-media');
const ffmpeg = require('fluent-ffmpeg');


const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildVoiceStates
    ]
});

const userStreams: Map<string, any> = new Map(); 

client.on('ready', (c) => {
    console.log(`Bot is online as ${c.user.tag}`);
});

client.on('messageCreate', (message) => {
    if (message.author.bot) return;

    if (message.content === "!ping") {
        message.channel.send('hey');
    }
});

async function createNewRecording() {
    if (!fs.existsSync('./recordings')) {
        fs.mkdirSync('./recordings');
    };
    const newFileName = "rec1"
    const pathToFile = 'recordings/' + newFileName + '.pcm';
    return fs.createWriteStream(pathToFile);
}

function convertPcmToMp3(inputFilePath: string, outputFilePath: string) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputFilePath)
            .inputFormat('s16le') // PCM format
            .inputOptions([
                '-ar 48000',        // Input sample rate
                '-ac 2',            // Input channels
                '-f s16le',         // Force input format
            ])
            .outputOptions([
                '-acodec libmp3lame',  // MP3 codec
                '-ar 48000',           // Maintain sample rate
                '-ac 2',               // Maintain stereo
                '-b:a 128k'            // Bit rate
            ])
            .output(outputFilePath)
            .on('end', () => {
                console.log(`Conversion to MP3 completed: ${outputFilePath}`);
                resolve(outputFilePath);
            })
            .on('error', (err: any) => {
                console.error('Error during conversion:', err);
                reject(err);
            })
            .run();
    });
}

async function transcribeAudioToJson() {
    const filePath = path.resolve(__dirname, '/Users/muskansindhu/Desktop/MoM-bot/recordings/rec1.mp3');

    try {
        const res = await nodewhisper(filePath, {
            modelName: 'base.en', 
            autoDownloadModelName: 'base.en', 
        });

         
        const jsonOutput = JSON.stringify(res)
        fs.writeFileSync('/Users/muskansindhu/Desktop/MoM-bot/whisper_output.json', jsonOutput);

    } catch (error) {
        console.error('Error during inference:', error);
    }
}

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const userLeft = newState.channelId === null;
    const userJoined = oldState.channelId === null;
    const guildId = oldState.guild.id;

    if (userLeft) {
        console.log('User left channel:', oldState.channelId);

        const connection = getVoiceConnection(guildId);

        if (connection) {
            const channel = oldState.channel;
            if (channel && channel.members.filter(member => !member.user.bot).size === 0) {
                console.log(`Channel ${channel.name} is empty, bot leaving.`);
                connection.destroy(); 
            }
        }

        const userId = oldState.id;
        const audioStream = userStreams.get(userId);
        if (audioStream) {
            audioStream.destroy();

            const pcmFilePath = `recordings/rec1.pcm`;
            const mp3FilePath = pcmFilePath.replace('.pcm', '.mp3');

            convertPcmToMp3(pcmFilePath, mp3FilePath).then(() => {
                fs.unlinkSync(pcmFilePath);
                console.log(`Converted ${pcmFilePath} to ${mp3FilePath}`);

                transcribeAudioToJson().then(()=>{
                    console.log('Transcribed successfully!');
                }).catch(err=>{
                    console.error('Unable to transcribe!', err);
                })

            }).catch(err => {
                console.error('Error during MP3 conversion:', err);
            });
            userStreams.delete(userId);
        }
    } else if (userJoined) {
        console.log('User joined channel:', newState.channelId);

        const channel = newState.channel;
        if (channel) {
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
            });

            const receiver = connection.receiver;

            receiver.speaking.once('start', (userId) => {
                console.log(`Recording started for user: ${userId}`);
                const audioStream = receiver.subscribe(userId);
                const decoder = new opus.Decoder({ 
                    frameSize: 960,
                    channels: 2,
                    rate: 48000 
                });
                const rawAudio = audioStream.pipe(decoder);

                createNewRecording().then((writeStream) => {
                    rawAudio.pipe(writeStream);

                    audioStream.on('end', () => {
                        console.log(`Recording ended for user: ${userId}`);
                        writeStream.end();

                        const pcmFilePath = 'recordings/rec1.pcm'
                        const mp3FilePath = pcmFilePath.replace('.pcm', '.mp3');

                        convertPcmToMp3(pcmFilePath, mp3FilePath).then(() => {
                            fs.unlinkSync(pcmFilePath);

                            transcribeAudioToJson().then(()=>{
                                console.log('Transcribed successfully!');
                            }).catch(err=>{
                                console.error('Unable to transcribe!', err);
                            })
                            
                        }).catch(err => {
                            console.error('Error during MP3 conversion:', err);
                        });
                    });
                });

                userStreams.set(userId, audioStream);
            });

            console.log(`Bot joined channel: ${channel.name}`);
        }
    } else {
        console.log('User moved channels:', oldState.channelId, newState.channelId);
    }
});

client.login(process.env.DISCORD_TOKEN);