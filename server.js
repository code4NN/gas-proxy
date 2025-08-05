import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';

import { requireToken } from './middleware/requireToken.js';
import dataRoutes from './routes/data.js';

dotenv.config();

const app = express();
app.use(cors());

app.use(express.json());

// 🔐 Protect all /api routes
app.use('/api', requireToken, dataRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});
