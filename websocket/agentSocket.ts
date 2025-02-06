import WebSocket, { WebSocketServer } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/index';
import { AIBrowserAgent } from '../real-browsing-agent/open-ai-agent';
import { Server } from 'http';

// Create the base Supabase client for authentication only
const supabaseAuth = createClient(config.supabaseUrl!, config.supabaseKey!);

type AgentRunStatus = 'PENDING' | 'INPROGRESS' | 'FAILED' | 'COMPLETED';



interface WebSocketMessage {
    type: string;
    runId?: string;
    token?: string;
}

interface AuthenticatedClient extends WebSocket {
    userId?: string;
    isAlive: boolean;
    supabase?: ReturnType<typeof createClient>;  // Add Supabase client for each authenticated connection
}

interface Step {
  number: number;
  action: string;
  explanation: string;
}

interface AgentRunSteps {
  steps: Step[];
  finalAnswer: string;
}

interface AgentRun {
    id: string;
    user_id: string;
    run_objective: string;
    started_at: string;
    completed_at: string | null;
    status: AgentRunStatus;
    steps: AgentRunSteps | null;
    commands: string[] | null;
}

export class AgentWebSocketServer {
  private wss: WebSocketServer;
  private activeAgents: Map<string, AIBrowserAgent> = new Map();
  private heartbeatInterval: NodeJS.Timeout;

  constructor(server: Server) {
    console.log('Initializing AgentWebSocketServer...');
    this.wss = new WebSocketServer({ server });
    this.setupWebSocketServer();
    this.heartbeatInterval = this.setupHeartbeat();
    console.log('AgentWebSocketServer initialized successfully');
  }

  private setupHeartbeat() {
    console.log('Setting up heartbeat mechanism...');
    const interval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        const client = ws as AuthenticatedClient;
        if (!client.isAlive) {
          console.log('Client failed heartbeat check, terminating connection');
          return client.terminate();
        }
        client.isAlive = false;
        client.ping();
        console.debug('Sent ping to client');
      });
    }, 30000);
    console.log('Heartbeat mechanism setup complete');
    return interval;
  }

  private async authenticateUser(token: string): Promise<string | null> {
    console.log('Attempting to authenticate user with token...');
    try {
      const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
      if (error || !user) {
        console.error('Authentication failed:', error?.message || 'No user found');
        return null;
      }
      console.log('User authenticated successfully:', user.id);
      return user.id;
    } catch (error) {
      console.error('Authentication error:', error);
      return null;
    }
  }

  private setupWebSocketServer() {
    console.log('Setting up WebSocket server event handlers...');
    
    this.wss.on('connection', (ws) => {
      const client = ws as AuthenticatedClient;
      console.log('New WebSocket connection established');
      client.isAlive = true;

      client.on('pong', () => {
        console.debug('Received pong from client');
        client.isAlive = true;
      });

      client.on('message', async (message: string) => {
        console.log('Received message:', message);
        try {
          const data: WebSocketMessage = JSON.parse(message);
          console.log('Parsed message data:', data);
          
          // Handle authentication first
          if (data.type === 'authenticate' && data.token) {
            console.log('Processing authentication request...');
            const userId = await this.authenticateUser(data.token);
            if (userId) {
              client.userId = userId;
              // Create an authenticated Supabase client for this connection
              client.supabase = createClient(config.supabaseUrl!, config.supabaseKey!, {
                auth: {
                  persistSession: false,
                  autoRefreshToken: false,
                  detectSessionInUrl: false
                },
                global: {
                  headers: {
                    Authorization: `Bearer ${data.token as string}`
                  }
                }
              });
              console.log('Client authenticated successfully:', userId);
              client.send(JSON.stringify({
                type: 'authentication',
                status: 'success'
              }));
            } else {
              console.error('Authentication failed for token');
              client.send(JSON.stringify({
                type: 'authentication',
                status: 'failed',
                error: 'Invalid authentication token'
              }));
              client.close();
            }
            return;
          }

          // Check authentication for all other messages
          if (!client.userId) {
            console.error('Unauthenticated message received');
            client.send(JSON.stringify({
              type: 'error',
              error: 'Not authenticated'
            }));
            client.close();
            return;
          }

          if (data.type === 'start_agent' && data.runId) {
            console.log('Starting agent run:', data.runId);
            await this.handleAgentStart(client, data.runId);
          } else if (data.type === 'heartbeat') {
            console.debug('Received heartbeat message');
            client.isAlive = true;
          } else {
            console.warn('Unknown message type received:', data.type);
          }
        } catch (error) {
          console.error('Error handling WebSocket message:', error);
          if (error instanceof SyntaxError) {
            console.log('Raw message that failed parsing:', message);
          }
          client.send(JSON.stringify({
            type: 'error',
            error: 'Failed to process message'
          }));
        }
      });

      client.on('close', () => {
        console.log('Client disconnected');
      });

      client.on('error', (error) => {
        console.error('WebSocket client error:', error);
      });
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });
  }

  private async handleAgentStart(ws: AuthenticatedClient, runId: string) {
    if (!ws.userId || !ws.supabase) {
      console.error('Attempt to start agent without authentication');
      return;
    }

    console.log(`Starting agent run ${runId} for user ${ws.userId}`);

    try {
      // Check if agent is already running
      if (this.activeAgents.has(runId)) {
        console.warn(`Agent run ${runId} is already in progress`);
        ws.send(JSON.stringify({
          type: 'error',
          error: 'This agent run is already in progress'
        }));
        return;
      }

      // Get run objective from database with user validation using authenticated client
      console.log('Fetching run objective from database...');
      const { data: runDataArray, error: runError } = await ws.supabase
        .from('agent_runs')
        .select('run_objective, status, steps, commands')
        .eq('id', runId)
        .eq('user_id', ws.userId)
        .returns<Pick<AgentRun, 'run_objective' | 'status' | 'steps' | 'commands'>[]>();

      if (runError) {
        console.error('Failed to fetch run data:', runError.message);
        await this.updateRunStatus(ws, runId, ws.userId, 'FAILED', [], null, null);
        ws.send(JSON.stringify({
          type: 'completion',
          status: 'failed',
          finalAnswer: 'Failed to fetch run data'
        }));
        return;
      }

      if (!runDataArray || runDataArray.length === 0) {
        console.error('No run data found or unauthorized access');
        await this.updateRunStatus(ws, runId, ws.userId, 'FAILED', [], null, null);
        ws.send(JSON.stringify({
          type: 'completion',
          status: 'failed',
          finalAnswer: 'Run not found or unauthorized access'
        }));
        return;
      }

      const runData = runDataArray[0];

      // If run is already completed or failed, return existing data and close
      if (runData.status === 'COMPLETED' || runData.status === 'FAILED') {
        console.log(`Returning existing run data for ${runId} in ${runData.status} state`);
        ws.send(JSON.stringify({
          type: 'completion',
          status: runData.status.toLowerCase(),
          finalAnswer: runData.steps?.finalAnswer || `This run is already in ${runData.status} state`,
          steps: runData.steps?.steps || [],
          commands: runData.commands || []
        }));
        ws.close();
        return;
      }

      console.log('Run objective fetched:', runData.run_objective);

      // Update run status to INPROGRESS
      console.log('Updating run status to INPROGRESS...');
      await this.updateRunStatus(ws, runId, ws.userId, 'INPROGRESS', [], null, null);

      // Initialize agent
      console.log('Initializing AI Browser Agent...');
      const agent = new AIBrowserAgent();
      this.activeAgents.set(runId, agent);

      try {
        await agent.initialize();
        console.log('Agent initialized successfully');

        // Override the agent's executeAction method to send updates to the client
        const originalExecuteAction = agent['executeAction'].bind(agent);
        agent['executeAction'] = async (toolCall: any, stepCount: number) => {
          console.log(`Executing action step ${stepCount}:`, toolCall.function.name);
          const screenshot = await originalExecuteAction(toolCall, stepCount);
          if (screenshot) {
            const parsedArgs = JSON.parse(toolCall.function.arguments);
            console.log('Sending step update to client');
            ws.send(JSON.stringify({
              type: 'step_update',
              stepNumber: stepCount,
              screenshot: screenshot,
              action: parsedArgs.action || 'Action being performed',
              explanation: parsedArgs.explanation || ' '
            }));
          }
          return screenshot;
        };

        // Store the original getExecutedCommands method
        const originalGetExecutedCommands = agent['getExecutedCommands'].bind(agent);

        // Perform the task
        console.log('Starting task execution:', runData.run_objective);
        const result = await agent.performTask(runData.run_objective);
        const executedCommands = await originalGetExecutedCommands();
        const commandStrings = executedCommands.map(cmd => JSON.stringify(cmd));

        // Update status to COMPLETED and send completion message
        console.log('Task completed successfully, updating status...');
        await this.updateRunStatus(
          ws, 
          runId, 
          ws.userId, 
          'COMPLETED', 
          result.steps, 
          result.finalAnswer,
          commandStrings
        );

        // Send completion message
        console.log('Sending completion message to client');
        ws.send(JSON.stringify({
          type: 'completion',
          status: 'completed',
          finalAnswer: result.finalAnswer,
          steps: result.steps,
          commands: commandStrings
        }));

      } catch (error) {
        console.error('Agent execution error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        const executedCommands = await agent['getExecutedCommands']();
        const commandStrings = executedCommands.map(cmd => JSON.stringify(cmd));
        await this.updateRunStatus(
          ws, 
          runId, 
          ws.userId, 
          'FAILED', 
          [], 
          errorMessage,
          commandStrings
        );
        ws.send(JSON.stringify({
          type: 'completion',
          status: 'failed',
          finalAnswer: errorMessage,
          commands: commandStrings
        }));
      } finally {
        // Cleanup
        console.log('Cleaning up agent resources...');
        await agent.close();
        this.activeAgents.delete(runId);
      }

    } catch (error) {
      console.error('Error in handleAgentStart:', error);
      const errorMessage = 'Failed to start agent';
      await this.updateRunStatus(ws, runId, ws.userId, 'FAILED', [], null, null);
      ws.send(JSON.stringify({
        type: 'completion',
        status: 'failed',
        finalAnswer: errorMessage
      }));
    }
  }

  private async updateRunStatus(
    ws: AuthenticatedClient, 
    runId: string, 
    userId: string, 
    status: AgentRunStatus,
    steps: { number: number; action: string; explanation: string; }[] | null,
    finalAnswer: string | null,
    commands: string[] | null = null
  ) {
    if (!ws.supabase) {
      console.error('No authenticated Supabase client available');
      return;
    }

    console.log(`Updating run ${runId} status to ${status}`);
    const updateData: any = {
      status,
      completed_at: status !== 'INPROGRESS' ? new Date().toISOString() : null
    };

    if (status === 'COMPLETED' || status === 'FAILED') {
      updateData.steps = {
        steps: steps || [],
        finalAnswer: finalAnswer || ''
      };
      updateData.commands = commands;
    }

    const { error } = await ws.supabase
      .from('agent_runs')
      .update(updateData)
      .eq('id', runId)
      .eq('user_id', userId);

    if (error) {
      console.error('Failed to update run status:', error);
    } else {
      console.log('Run status updated successfully');
    }
  }

  public close() {
    console.log('Shutting down AgentWebSocketServer...');
    clearInterval(this.heartbeatInterval);
    
    // Close all active agents
    console.log(`Closing ${this.activeAgents.size} active agents...`);
    for (const agent of this.activeAgents.values()) {
      agent.close().catch(console.error);
    }
    this.activeAgents.clear();

    // Close WebSocket server
    this.wss.close();
    console.log('AgentWebSocketServer shutdown complete');
  }
} 