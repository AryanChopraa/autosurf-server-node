import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config/index';
import routes from './routes/index';
import { errorHandler } from './middleware/errorHandler';
import { createServer } from 'http';
import { AgentWebSocketServer } from './websocket/agentSocket';
import { ScriptRunnerWebSocketServer } from './websocket/scriptRunnerSocket';

const app = express();

// Logging middleware
app.use(morgan('dev')); // Logs: :method :url :status :response-time ms - :res[content-length]

// Regular middleware
app.use(express.json());
app.use(cors({
  origin: config.clientUrl,
  credentials: true
}));

// Routes
app.use('/api', routes);
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Create HTTP server
const server = createServer(app);

// Initialize WebSocket servers without paths
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
    // Reject unhandled upgrade requests
    socket.destroy();
  }
});

// Error handling
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  errorHandler(err, req, res, next);
});

// Handle server shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  agentWss.close();
  scriptRunnerWss.close();
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

// Start server
const PORT = config.port;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;