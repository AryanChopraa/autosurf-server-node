import WebSocket, { WebSocketServer } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/index';
import { ScriptRunnerAgent } from '../real-browsing-agent/script-runner-agent';
import { Server } from 'http';
import { 
    AuthenticatedWebSocket,
    Automation,
    ScriptCommand
} from '../types';
import { OpenAI } from 'openai';
const fs = require('fs');
const path = require('path');

const supabaseAuth = createClient(config.supabaseUrl!, config.supabaseKey!);
const SCREENSHOT_UPDATE_INTERVAL = 500; // 1 second

export class ScriptRunnerWebSocketServer {
    private wss: WebSocketServer;
    private activeAgents: Map<string, ScriptRunnerAgent> = new Map();
    private heartbeatInterval: NodeJS.Timeout;
    private screenshotIntervals: Map<string, NodeJS.Timeout> = new Map();
    private client: OpenAI;

    constructor(server: Server) {
        console.log('🚀 Initializing ScriptRunnerWebSocketServer...');
        this.wss = new WebSocketServer({ noServer: true });
        this.setupWebSocketServer();
        this.heartbeatInterval = this.setupHeartbeat();
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
        console.log('✅ ScriptRunnerWebSocketServer initialized successfully');
    }

    public handleUpgrade(request: any, socket: any, head: any) {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.wss.emit('connection', ws, request);
        });
    }

    private setupHeartbeat() {
        console.log('⏱️  Setting up heartbeat check...');
        return setInterval(() => this.checkClientHeartbeats(), 30000);
    }

    private checkClientHeartbeats() {
        console.log('💓 Checking client heartbeats...');
        this.wss.clients.forEach((ws) => {
            const client = ws as unknown as AuthenticatedWebSocket;
            if ('isAlive' in client && !client.isAlive) {
                console.log('❌ Client failed heartbeat check, terminating connection');
                return client.terminate();
            }
            if ('isAlive' in client) {
                client.isAlive = false;
                client.ping();
                console.log('📍 Sent ping to client');
            }
        });
    }

    private async authenticateUser(token: string): Promise<string | null> {
        console.log('🔐 Authenticating user...');
        try {
            const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
            if (error || !user) {
                console.error('❌ Authentication failed:', error?.message || 'No user found');
                return null;
            }
            console.log('✅ User authenticated successfully');
            return user.id;
        } catch (error) {
            console.error('❌ Authentication error:', error);
            return null;
        }
    }

    private async startPeriodicScreenshotUpdates(ws: AuthenticatedWebSocket, automationId: string, agent: ScriptRunnerAgent) {
        console.log('📸 Starting periodic screenshot updates...');
        const interval = setInterval(async () => {
            try {
                const screenshot = await agent.page?.screenshot({ 
                    encoding: 'base64',
                    type: 'jpeg',
                    quality: 80
                });
                
                if (screenshot) {
                    // console.log('📸 Sending screenshot update');
                    ws.send(JSON.stringify({
                        type: 'screenshot_update',
                        screenshot,
                        automationId
                    }));
                }
            } catch (error) {
                console.error('❌ Error capturing screenshot:', error);
            }
        }, SCREENSHOT_UPDATE_INTERVAL);

        this.screenshotIntervals.set(automationId, interval);
        console.log('✅ Screenshot updates started successfully');
    }

    private stopPeriodicScreenshotUpdates(automationId: string) {
        console.log('🛑 Stopping screenshot updates for automation:', automationId);
        const interval = this.screenshotIntervals.get(automationId);
        if (interval) {
            clearInterval(interval);
            this.screenshotIntervals.delete(automationId);
            console.log('✅ Screenshot updates stopped successfully');
        }
    }

    private async analyzeScreenshotWithGPT(screenshot: string, automation: Automation): Promise<string> {
        console.log('🤖 Analyzing final screenshot with GPT-4V...');
        
        if (!screenshot) {
            console.error('❌ No screenshot data provided');
            return "Unable to analyze: No screenshot data available";
        }

        // Validate base64 format
        if (!screenshot.match(/^[A-Za-z0-9+/=]+$/)) {
            console.error('❌ Invalid base64 format for screenshot');
            return "Unable to analyze: Invalid screenshot format";
        }

        try {
            console.log('📸 Screenshot size:', Math.round(screenshot.length / 1024), 'KB');
            console.log('📸 Screenshot data (first 100 chars):', screenshot.substring(0, 100));
            
            const response = await this.client.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: `You are analyzing the final result of an automation named "${automation.automation_name}" with the objective: "${automation.objective}". Based on the final screenshot, provide a concise summary of what was achieved. Focus only on the key information or data that was gathered/shown in relation to the objective.`
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:image/jpeg;base64,${screenshot}`,
                                    detail: "high"
                                }
                            }
                        ],
                    }
                ],
                max_tokens: 150
            });

            if (!response.choices?.[0]?.message?.content) {
                console.error('❌ No response content from GPT');
                return "Unable to analyze: No response from analysis";
            }

            // // Store the screenshot data
            // const screenshotPath = path.join(__dirname, 'screenshots', `${automation.automation_name}_final_screenshot.jpeg`);

            // // Ensure the directory exists
            // fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });

            // // Write the screenshot to a file
            // fs.writeFileSync(screenshotPath, screenshot, { encoding: 'base64' });
            // console.log('📁 Screenshot stored at:', screenshotPath);

            return response.choices[0].message.content;
        } catch (error) {
            console.error('❌ Error analyzing screenshot:', error);
            if (error instanceof Error) {
                console.error('Error details:', error.message);
                if (error.message.includes('413') || error.message.includes('too large')) {
                    return "Unable to analyze: Screenshot file size too large";
                }
                return `Unable to analyze the final result: ${error.message}`;
            }
            return "Unable to analyze the final result due to an error.";
        }
    }

    private async handleScriptStart(ws: AuthenticatedWebSocket, automationId: string) {
        if (!ws.userId || !ws.supabase) {
            console.error('❌ Attempt to start script without authentication');
            return;
        }

        console.log('🚀 Starting script execution for automation:', automationId);
        try {
            console.log('📥 Fetching automation data...');
            const { data: automationData, error: automationError } = await ws.supabase
                .from('saved_automations')
                .select('*')
                .eq('id', automationId)
                .eq('user_id', ws.userId)
                .single();

            if (automationError || !automationData) {
                console.error('❌ Failed to fetch automation data:', automationError);
                throw new Error('Failed to fetch automation data');
            }

            console.log('✅ Automation data fetched successfully');
            const automation = automationData as Automation;
            
            console.log('🌐 Initializing browser agent...');
            const agent = new ScriptRunnerAgent();
            await agent.initialize();
            this.activeAgents.set(automationId, agent);
            console.log('✅ Browser agent initialized successfully');

            console.log('📸 Setting up screenshot updates...');
            this.startPeriodicScreenshotUpdates(ws, automationId, agent);

            console.log('▶️  Starting step execution...');
            const steps = automation.steps;
            for (let i = 0; i < steps.length; i++) {
                console.log(`\n📍 Starting Step ${i + 1} of ${steps.length}`);
                ws.send(JSON.stringify({
                    type: 'step_started',
                    number: i + 1
                }));

                try {
                    const hasCaptcha = await agent.detectCaptcha();
                    if (hasCaptcha) {
                        console.log('🔒 CAPTCHA detected');
                        ws.send(JSON.stringify({
                            type: 'captcha_detected'
                        }));
                    }

                    console.log(`🔄 Executing command: ${steps[i].type}`);
                    await agent.executeCommand(steps[i]);

                    if (hasCaptcha) {
                        console.log('✅ CAPTCHA solved successfully');
                        ws.send(JSON.stringify({
                            type: 'captcha_solved'
                        }));
                    }
                    
                    console.log(`✅ Step ${i + 1} completed successfully`);
                    ws.send(JSON.stringify({
                        type: 'step_completed',
                        
                        number: i + 1
                    }));
                } catch (error) {
                    console.error(`❌ Error in step ${i + 1}:`, error);
                    ws.send(JSON.stringify({
                        type: 'failed',
                        error: error instanceof Error ? error.message : 'Unknown error'
                    }));
                    throw error;
                }
            }

            console.log('🎉 All steps completed successfully');
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Get the final screenshot and analyze it
            const finalScreenshot = await agent.page?.screenshot({ 
                encoding: 'base64',
                type: 'jpeg',
                quality: 80
            });

            let finalAnalysis = "Automation completed successfully.";
            if (finalScreenshot && automationData) {
                finalAnalysis = await this.analyzeScreenshotWithGPT(finalScreenshot, automationData);
            }

            ws.send(JSON.stringify({
                type: 'completion',
                message: finalAnalysis
            }));

            // Add delay to ensure final screenshot is captured and sent
            console.log('📸 Waiting for final screenshot capture...');
            await new Promise(resolve => setTimeout(resolve, SCREENSHOT_UPDATE_INTERVAL * 2));

        } catch (error) {
            console.error('❌ Script execution failed:', error);
            ws.send(JSON.stringify({
                type: 'failed',
                error: error instanceof Error ? error.message : 'Unknown error'
            }));
        } finally {
            console.log('🧹 Cleaning up resources...');
            this.cleanupAgent(automationId);
        }
    }

    private cleanupAgent(automationId: string) {
        console.log('🧹 Cleaning up agent for automation:', automationId);
        const agent = this.activeAgents.get(automationId);
        if (agent) {
            agent.close().catch(console.error);
            this.activeAgents.delete(automationId);
        }
        this.stopPeriodicScreenshotUpdates(automationId);
        console.log('✅ Cleanup completed');
    }

    private setupWebSocketServer() {
        console.log('🔌 Setting up WebSocket server...');
        this.wss.on('connection', this.handleConnection.bind(this));
        this.wss.on('error', (error) => console.error('❌ WebSocket server error:', error));
        console.log('✅ WebSocket server setup completed');
    }

    private handleConnection(ws: WebSocket) {
        console.log('🔌 New client connected');
        const client = Object.assign(ws, {
            isAlive: true,
            userId: undefined,
            supabase: undefined
        }) as AuthenticatedWebSocket;

        ws.on('pong', () => {
            client.isAlive = true;
            console.log('📍 Received pong from client');
        });

        ws.on('message', (data: WebSocket.RawData) => {
            console.log('📥 Received message from client');
            this.handleMessage(client, data.toString());
        });

        ws.on('close', () => {
            console.log('🔌 Client disconnected');
        });

        ws.on('error', (error: Error) => {
            console.error('❌ WebSocket client error:', error);
        });
    }

    private async handleMessage(client: AuthenticatedWebSocket, message: string) {
        try {
            const data = JSON.parse(message);
            console.log('📨 Processing message type:', data.type);
            
            if (data.type === 'authenticate') {
                console.log('🔐 Processing authentication request');
                await this.handleAuthentication(client, data.token);
            } else if (!client.userId) {
                console.log('⚠️  Unauthenticated message received');
                this.handleUnauthenticatedMessage(client);
            } else if (data.type === 'start_script' && data.automationId) {
                console.log('▶️  Starting script execution');
                await this.handleScriptStart(client, data.automationId);
            }
        } catch (error) {
            console.error('❌ Error handling message:', error);
            client.send(JSON.stringify({
                type: 'error',
                error: 'Failed to process message'
            }));
        }
    }

    private async handleAuthentication(client: AuthenticatedWebSocket, token?: string) {
        if (!token) {
            console.log('❌ Authentication failed: No token provided');
            client.send(JSON.stringify({
                type: 'authentication',
                status: 'failed',
                error: 'No token provided'
            }));
            return;
        }

        const userId = await this.authenticateUser(token);
        if (userId) {
            console.log('✅ Authentication successful');
            this.setupAuthenticatedClient(client, userId, token);
        } else {
            console.log('❌ Authentication failed: Invalid token');
            this.handleFailedAuthentication(client);
        }
    }

    private setupAuthenticatedClient(client: AuthenticatedWebSocket, userId: string, token: string) {
        client.userId = userId;
        client.supabase = createClient(config.supabaseUrl!, config.supabaseKey!, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            },
            global: {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        });
        client.send(JSON.stringify({
            type: 'authentication',
            status: 'success'
        }));
    }

    private handleFailedAuthentication(client: AuthenticatedWebSocket) {
        client.send(JSON.stringify({
            type: 'authentication',
            status: 'failed',
            error: 'Invalid authentication token'
        }));
        client.close();
    }

    private handleUnauthenticatedMessage(client: AuthenticatedWebSocket) {
        client.send(JSON.stringify({
            type: 'error',
            error: 'Not authenticated'
        }));
        client.close();
    }

    public close() {
        console.log('🛑 Shutting down ScriptRunnerWebSocketServer...');
        clearInterval(this.heartbeatInterval);
        
        console.log('🧹 Cleaning up screenshot intervals...');
        this.screenshotIntervals.forEach((interval) => clearInterval(interval));
        this.screenshotIntervals.clear();
        
        console.log('🧹 Closing active agents...');
        this.activeAgents.forEach((agent) => agent.close().catch(console.error));
        this.activeAgents.clear();

        this.wss.close();
        console.log('✅ Server shutdown complete');
    }
} 