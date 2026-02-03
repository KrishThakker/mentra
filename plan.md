# Implementation Plan: Audio Recording and Summarization App

## Overview
This app will allow users to record audio through Mentra glasses, transcribe the recording, and generate a summary of the conversation using Google Gemini 2.5 Flash model.

## User Flow
1. User sees the app interface with Start and Stop buttons
2. User clicks "Start" to begin recording
3. The app records audio until the user clicks "Stop"
4. When stopped, the app transcribes the audio and uses Google Gemini to generate a one-line summary
5. The summary is displayed to the user

## Technical Components

### 1. App Structure
- **AppServer**: Main server that handles sessions, recording, and summarization
- **Webview**: HTML/JS interface with Start/Stop buttons
- **Audio Recording**: Uses MentraOS SDK's audio capture functionality
- **Transcription**: Uses MentraOS built-in transcription
- **Summarization**: Uses Google Gemini 2.5 Flash model

### 2. Required Files
- `src/index.ts`: Main server code with AppServer implementation
- `public/index.html`: Webview with Start/Stop buttons
- `.env`: Environment variables (API keys)
- `package.json`: Dependencies and scripts

### 3. Dependencies
- `@mentra/sdk`: MentraOS SDK
- `express`: Web server for handling webview
- `@google/generative-ai`: Google Gemini client library
- `dotenv`: For environment variable management

## Implementation Steps

### Step 1: Project Setup
1. Initialize project with required dependencies
2. Set up basic AppServer
3. Configure environment variables (GEMINI_API_KEY)

### Step 2: Create Webview
1. Create HTML interface with Start/Stop buttons
2. Add JavaScript for button functionality
3. Set up communication between webview and AppServer

### Step 3: Implement Audio Recording
1. Set up audio recording when Start button is pressed
2. Store audio chunks in memory
3. Implement transcription collection during recording

### Step 4: Implement Stop and Processing
1. Stop recording when Stop button is pressed
2. Process collected transcription
3. Send transcription to Google Gemini for summarization

### Step 5: Display Results
1. Show the summary on the glasses and in the webview
2. Allow the user to restart the recording process

## Detailed API Integration

### MentraOS SDK Usage
- `session.events.onTranscription`: Collect real-time transcription during recording
- `AppServer.onSession`: Initialize session and set up webview
- `session.layouts.showTextWall`: Display the summary on glasses

### Google Gemini Integration
- Initialize Gemini client with API key
- Use the "gemini-2.5-flash" model for text summarization
- Provide the transcription as input and request a one-line summary

## Code Structure

### src/index.ts
```typescript
import { AppServer, AppSession } from '@mentra/sdk';
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
```

### public/index.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Audio Recorder</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background-color: #f5f5f5;
        }
        
        .container {
            text-align: center;
            padding: 20px;
            background-color: white;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            width: 80%;
            max-width: 500px;
        }
        
        h1 {
            margin-bottom: 30px;
        }
        
        .buttons {
            display: flex;
            justify-content: space-around;
            margin-bottom: 30px;
        }
        
        button {
            padding: 15px 30px;
            font-size: 18px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            transition: background-color 0.3s;
            width: 120px;
        }
        
        #startButton {
            background-color: #4CAF50;
            color: white;
        }
        
        #stopButton {
            background-color: #f44336;
            color: white;
            display: none;
        }
        
        .summary {
            margin-top: 20px;
            padding: 15px;
            background-color: #f9f9f9;
            border-radius: 5px;
            min-height: 60px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Audio Recorder</h1>
        
        <div class="buttons">
            <button id="startButton">Start</button>
            <button id="stopButton">Stop</button>
        </div>
        
        <p id="status">Ready to record</p>
        
        <div class="summary">
            <h3>Summary</h3>
            <p id="summary">Record a conversation to see a summary here</p>
        </div>
    </div>
    
    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const startButton = document.getElementById('startButton');
            const stopButton = document.getElementById('stopButton');
            const statusElement = document.getElementById('status');
            const summaryElement = document.getElementById('summary');
            
            // Get sessionId from URL query params
            const urlParams = new URLSearchParams(window.location.search);
            const sessionId = urlParams.get('sessionId');
            
            if (!sessionId) {
                statusElement.textContent = 'Error: No session ID';
                startButton.disabled = true;
                return;
            }
            
            startButton.addEventListener('click', async () => {
                try {
                    const response = await fetch(`/api/start?sessionId=${sessionId}`, {
                        method: 'POST'
                    });
                    
                    if (response.ok) {
                        startButton.style.display = 'none';
                        stopButton.style.display = 'block';
                        statusElement.textContent = 'Recording...';
                        summaryElement.textContent = 'Recording in progress...';
                    } else {
                        const data = await response.json();
                        statusElement.textContent = `Error: ${data.error || 'Failed to start recording'}`;
                    }
                } catch (error) {
                    statusElement.textContent = 'Error: Could not connect to server';
                }
            });
            
            stopButton.addEventListener('click', async () => {
                try {
                    const response = await fetch(`/api/stop?sessionId=${sessionId}`, {
                        method: 'POST'
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        
                        startButton.style.display = 'block';
                        stopButton.style.display = 'none';
                        statusElement.textContent = 'Recording stopped';
                        
                        if (data.summary) {
                            summaryElement.textContent = data.summary;
                        } else {
                            summaryElement.textContent = 'No summary generated';
                        }
                    } else {
                        const data = await response.json();
                        statusElement.textContent = `Error: ${data.error || 'Failed to stop recording'}`;
                    }
                } catch (error) {
                    statusElement.textContent = 'Error: Could not connect to server';
                }
            });
        });
    </script>
</body>
</html>
```

### .env
```
PACKAGE_NAME=com.yourname.audiorecorder
MENTRAOS_API_KEY=your_mentraos_api_key
GEMINI_API_KEY=your_gemini_api_key
```

### package.json
```json
{
  "name": "mentraos-audio-recorder",
  "version": "1.0.0",
  "description": "Audio recording and summarization app for MentraOS",
  "main": "dist/index.js",
  "scripts": {
    "dev": "npx bun build src/index.ts --outdir=dist --watch",
    "start": "node dist/index.js",
    "build": "npx bun build src/index.ts --outdir=dist"
  },
  "dependencies": {
    "@mentra/sdk": "latest",
    "express": "^4.18.2",
    "@google/generative-ai": "^0.1.3",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.17",
    "@types/node": "^20.4.5",
    "typescript": "^5.1.6"
  }
}
```

## Testing and Validation

1. **Local Testing**:
   - Test webview functionality in browser
   - Test audio recording with MentraOS glasses
   - Validate transcription accuracy
   - Verify Gemini API integration and summarization quality

2. **Error Handling**:
   - Handle disconnected sessions
   - Account for empty or poor-quality recordings
   - Handle API failures gracefully
   - Provide clear error messages to users

## Deployment

1. Deploy to a hosting service (Railway, etc.)
2. Update the app URL in the MentraOS Developer Console
3. Install the app on MentraOS glasses and test the complete flow