import express from 'express';
import { google } from 'googleapis';
import { getNextAuth } from '../lib/serviceAccountPool.js';
import { getSheetId } from '../lib/sheetMap.js';

const router = express.Router();

router.get('/data', async (req, res) => {
    try {
        const sheetAlias = req.query.sheet;
        if (!sheetAlias) return res.status(400).json({ error: 'Missing sheet alias' });

        const spreadsheetId = getSheetId(sheetAlias);
        const auth = getNextAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        const range = 'Sheet1!A2:F'; // Modify as needed

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
        });

        res.json(response.data);
    } catch (err) {
        console.error('❌ Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});
