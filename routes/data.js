import express from 'express';
import { google } from 'googleapis';
import { getNextAuth } from '../lib/serviceAccountPool.js';
import { getSheetId } from '../lib/sheetMap.js';

const router = express.Router();

// Utility to get auth + token debug info
function getAuthWithDebug() {
    const { auth, wasCached } = getNextAuth();
    return { auth, tokenUsed: wasCached ? 'cached' : 'new' };
}

function columnNumberToLetter(colNum) {
    let letter = '';
    while (colNum > 0) {
        let remainder = (colNum - 1) % 26;
        letter = String.fromCharCode(65 + remainder) + letter;
        colNum = Math.floor((colNum - 1) / 26);
    }
    return letter;
}

// GET /api/data?sheet=xyz&last_col=F&last_sync=timestamp
router.get('/data', async (req, res) => {
    console.log("called /api/data... ")
    try {
        const { workbook, sheet, last_col_number, last_sync } = req.query;
        if (!workbook) return res.status(400).json({ error: 'Missing workbook alias' });
        if (!sheet) { return res.status(400).json({ error: 'Missing sheet alias' }); }
        if (!last_col_number) return res.status(400).json({ error: 'Missing last_col' });

        const spreadsheetId = getSheetId(workbook);
        const { auth, tokenUsed } = getAuthWithDebug();
        const sheets = google.sheets({ version: 'v4', auth });
        const latest_n_changes = 20;

        const last_col_number_int = parseInt(last_col_number, 10)
        const db_start_col = columnNumberToLetter(last_col_number_int + 2)
        const db_end_col = columnNumberToLetter(last_col_number_int + 1 + last_col_number_int)
        const range = `${sheet}!${db_start_col}1:${db_end_col}${latest_n_changes}`;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
        });

        // Later we can filter based on `last_sync`
        res.json({ data: response.data.values, tokenUsed });
    } catch (err) {
        console.error('❌ Error in GET /data:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/update?sheet=xyz
// Body: { updates: [{ dbrow, dbcol, values }] }
router.post('/update', async (req, res) => {
    console.log("called /api/update... ")
    try {
        const { workbook, sheet } = req.query;

        const { updates } = req.body;
        if (!workbook || !sheet || !updates || !Array.isArray(updates)) {
            return res.status(400).json({ error: `Missing or invalid parameters ${updates}` });
        }

        const spreadsheetId = getSheetId(workbook);
        const { auth, tokenUsed } = getAuthWithDebug();
        const sheets = google.sheets({ version: 'v4', auth });

        const data = updates.map(update => ({
            range: `${sheet}!${update.dbcol}${update.dbrow}`,
            values: [[update.value]],
        }));

        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
                valueInputOption: 'RAW',
                data,
            },
        });

        res.json({ success: true, updated: updates.length, tokenUsed });
    } catch (err) {
        console.error('❌ Error in POST /update:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/push?sheet=xyz
// Body: { entries: [[...], [...]] } or array of arrays
router.post('/push', async (req, res) => {
    console.log("called /api/push... ")
    try {
        const { workbook, sheet, last_col_letter } = req.query;
        const { entries } = req.body;
        if (!workbook || !sheet || !last_col_letter || !entries || !Array.isArray(entries)) {
            return res.status(400).json({ error: 'Missing or invalid parameters' });
        }

        const spreadsheetId = getSheetId(workbook);
        const { auth, tokenUsed } = getAuthWithDebug();
        const sheets = google.sheets({ version: 'v4', auth });

        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheet}!$A1:$${last_col_letter}`, // Or use dynamic range
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
                values: entries,
            },
        });

        res.json({ success: true, inserted: entries.length, tokenUsed });
    } catch (err) {
        console.error('❌ Error in POST /push:', err.message);
        res.status(500).json({ error: err.message });
    }
});

export default router;




// GET /api/data?sheet=alias&last_sync=timestamp
// router.get('/data', async (req, res) => {
//     try {
//         const sheetAlias = req.query.sheet;
//         const lastSync = req.query.last_sync;

//         if (!sheetAlias) {
//             return res.status(400).json({ error: 'Missing sheet alias' });
//         }

//         const spreadsheetId = getSheetId(sheetAlias);
//         const auth = getNextAuth();
//         const sheets = google.sheets({ version: 'v4', auth });

//         const range = 'Sheet1!A1:C5'; // assuming headers in row 1

//         const response = await sheets.spreadsheets.values.get({
//             spreadsheetId,
//             range,
//         });

//         const rows = response.data.values || [];

//         // Optional: filter based on last_sync timestamp (client does it for now)
//         const data = rows.map((row) => ({
//             version: row[0],
//             last_modified: row[1],
//             data: row[2],
//             metadata: row[3],
//             status: row[4],
//             id: row[5], // assuming ID in column F
//         }));

//         res.json({ rows: data });
//     } catch (err) {
//         console.error('❌ Error in GET /data:', err.message);
//         res.status(500).json({ error: err.message });
//     }
// });

