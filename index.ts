import 'dotenv/config';
import express, { Request, Response, NextFunction, Application } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config/index';
import routes from './routes/index';
import { errorHandler } from './middleware/errorHandler';
import { createServer } from 'http';
import { AgentWebSocketServer } from './websocket/agentSocket';
import { ScriptRunnerWebSocketServer } from './websocket/scriptRunnerSocket';

const app: Application = express();

// Simplified CORS setup
app.use(cors());

// Other middleware
app.use(morgan('dev'));
app.use(express.json());

// Routes
app.use('/api', routes);
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).send('OK');
});

// Create HTTP server
const server = createServer(app);

// Initialize WebSocket servers
const agentWss = new AgentWebSocketServer(server);
const scriptRunnerWss = new ScriptRunnerWebSocketServer(server);

// Handle WebSocket upgrade requests
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;

  if (pathname === '/agent') {
    agentWss.handleUpgrade(request, socket, head);
  } else if (pathname === '/automation') {
    scriptRunnerWss.handleUpgrade(request, socket, head);
  } else {
    socket.destroy();
  }
});

// Error handling
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  errorHandler(err, req, res, next);
});

// Server shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received: closing server');
  agentWss.close();
  scriptRunnerWss.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Start server
const PORT = config.port;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

export default app;
