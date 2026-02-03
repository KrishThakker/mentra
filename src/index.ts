import { AppServer, AppSession, WebViewLayout } from '@mentra/sdk';
import express from 'express';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

class AudioRecordingApp extends AppServer {
  private sessions = new Map<string, AppSession>();
  private recordings = new Map<string, { isRecording: boolean; transcript: string }>();
  private genAI: GoogleGenerativeAI;

  constructor(config: any) {
    super(config);
    
    // Initialize Gemini AI
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    
    // Set up Express routes for webview
    const app = this.getExpressApp();
    app.use(express.static(path.join(__dirname, '../public')));
    app.use(express.json());
    
    // API endpoints for the webview
    app.post('/api/start', this.handleStartRecording.bind(this));
    app.post('/api/stop', this.handleStopRecording.bind(this));
  }

  protected async onSession(session: AppSession, sessionId: string, userId: string) {
    this.sessions.set(sessionId, session);
    this.recordings.set(sessionId, { isRecording: false, transcript: '' });
    
    // Show webview
    const webview = new WebViewLayout({
      url: `http://localhost:3000?sessionId=${sessionId}`,
      title: 'Audio Recorder'
    });
    
    session.layouts.show(webview);
    session.layouts.showTextWall('Open webview to start recording');
    
    // Set up transcription handling
    session.events.onTranscription((data) => {
      const recording = this.recordings.get(sessionId);
      if (recording && recording.isRecording && data.isFinal) {
        recording.transcript += data.text + ' ';
        session.logger.info(`Adding transcription: ${data.text}`);
      }
    });
  }
  
  protected async onStop(sessionId: string, userId: string, reason: string) {
    this.sessions.delete(sessionId);
    this.recordings.delete(sessionId);
  }
  
  private async handleStartRecording(req: express.Request, res: express.Response) {
    const sessionId = req.query.sessionId as string;
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const recording = this.recordings.get(sessionId);
    if (recording) {
      recording.isRecording = true;
      recording.transcript = '';
      session.layouts.showTextWall('Recording...');
    }
    
    res.json({ success: true });
  }
  
  private async handleStopRecording(req: express.Request, res: express.Response) {
    const sessionId = req.query.sessionId as string;
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const recording = this.recordings.get(sessionId);
    if (!recording || !recording.isRecording) {
      return res.status(400).json({ error: 'Not recording' });
    }
    
    recording.isRecording = false;
    session.layouts.showTextWall('Processing recording...');
    
    try {
      const summary = await this.generateSummary(recording.transcript);
      session.layouts.showTextWall(`Summary: ${summary}`);
      res.json({ success: true, summary });
    } catch (error) {
      session.logger.error('Error generating summary:', error);
      session.layouts.showTextWall('Error generating summary');
      res.status(500).json({ error: 'Failed to generate summary' });
    }
  }
  
  private async generateSummary(transcript: string): Promise<string> {
    if (!transcript.trim()) {
      return "No speech detected.";
    }
    
    try {
      const model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      
      const prompt = `
        Please provide a one-line summary of the following transcript:
        
        ${transcript}
        
        One-line summary:
      `;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      return text.trim();
    } catch (error) {
      console.error('Error with Gemini API:', error);
      throw new Error('Failed to generate summary');
    }
  }
}

const server = new AudioRecordingApp({
  packageName: process.env.PACKAGE_NAME!,
  apiKey: process.env.MENTRAOS_API_KEY!,
  port: 3000,
});

server.start().catch(console.error);