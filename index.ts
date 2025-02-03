import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';

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

// Error handling
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  errorHandler(err, req, res, next);
});

const PORT = config.port;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default app;