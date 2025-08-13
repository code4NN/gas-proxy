import express, { json } from 'express';
import { google } from 'googleapis';
import { getNextAuth } from '../lib/serviceAccountPool.js';
import { getSheetId } from '../lib/sheetMap.js';
import { getCache, setCache } from '../cache.js';

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

function get_db_id(workbook, sheet_name) {
    return `${workbook}_${sheet_name}`
}

router.get("/pong", async (req, res) => {
    res.status(200).send('pong')
})


// GET
// -----------------must have
// workbook
// sheet
// -----------------optional
// last_sync: UNIX timestamp returns full sheet if empty or older than 20 updates
router.get('/db/get', async (req, res) => {
    console.log("called /api/db/get................................................... ")
    try {
        const { workbook, sheet, last_sync } = req.query;
        if (!workbook) return res.status(400).json({ error: 'Missing workbook alias' });
        if (!sheet) { return res.status(400).json({ error: 'Missing sheet alias' }); }

        // ======================= get sheets_auth
        const spreadsheetId = getSheetId(workbook);
        const { auth, tokenUsed } = getAuthWithDebug();
        const sheets = google.sheets({ version: 'v4', auth });
        // ======================= get sheets_auth END

        // additional flags
        let is_cached_colnum = true;
        let is_cached_sheetdata = true;
        let is_fullfetch = false;
        let all_synced = false;


        const cid_last_col = `${get_db_id(workbook, sheet)}_last_col`
        let last_col_number = getCache(cid_last_col);

        if (!last_col_number) {
            console.log(`fetching ${cid_last_col}`)
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${sheet}!1:1`
            });
            const firstRow = response.data.values[0];
            const firstBlankIndex = firstRow.findIndex(cell => !cell || cell.trim() === "");
            setCache(cid_last_col, firstBlankIndex)
            last_col_number = firstBlankIndex;

            is_cached_colnum = false;
        }


        // FETCHER-1 Logic to fetch latest 20 changes from sheet
        const cid_sheetdata = `${workbook}_${sheet}_data`
        let response = getCache(cid_sheetdata)

        if (!response) {
            console.log(`fetching ${cid_sheetdata}`)
            const latest_n_changes = 20;
            const last_col_number_int = parseInt(last_col_number, 10)

            const db_start_col = columnNumberToLetter(last_col_number_int + 2)
            const db_end_col = columnNumberToLetter(last_col_number_int + 1 + last_col_number_int)
            const range = `${sheet}!${db_start_col}1:${db_end_col}${latest_n_changes}`;

            response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range,
            });
            response = response.data.values;

            setCache(cid_sheetdata, response)
            is_cached_sheetdata = false
        }
        // END FETCHER-1 Logic to fetch latest 20 changes from sheet

        // filtering for the last sync
        const oldest_modified_date = Number(response[response.length - 1][0]);
        const latest_modified_date = Number(response[1][0])
        const last_synced_at = last_sync ? Number(last_sync) : 0;

        if (latest_modified_date === last_synced_at) {
            response = response.slice(0, 1);
            all_synced = true;
        }

        else if (last_synced_at < oldest_modified_date) {
            // fetch whole sheet
            console.log(`fetching full sheet ${last_synced_at} < ${oldest_modified_date}`)

            const last_col_number_int = parseInt(last_col_number, 10)
            const db_start_col = columnNumberToLetter(last_col_number_int + 2)
            const db_end_col = columnNumberToLetter(last_col_number_int + 1 + last_col_number_int)
            const range = `${sheet}!${db_start_col}:${db_end_col}`;

            response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range,
            });
            response = response.data.values;

            is_fullfetch = true;
        }

        res.json({ data: response, all_synced, is_fullfetch, is_cached_colnum, is_cached_sheetdata, tokenUsed });
    } catch (err) {
        console.error('❌ Error in GET /db/get:', err.message);
        res.status(500).json({ error: err.message });
    }
});


// POST
// -----------------must have
// workbook
// sheet
// ----------------- in the body
// { updates: [{ dbrow, dbcol, value, last_modified, expectedVersion }] }
// value must be {} with keys 
// 
// a: age (version)
// v: value
// 
router.post('/db/update', async (req, res) => {
    console.log("called /api/db/update................................................... ")
    try {
        const { workbook, sheet } = req.query;
        const { updates } = req.body;

        if (!workbook || !sheet || !updates || !Array.isArray(updates)) {
            return res.status(400).json({ error: `Missing or invalid parameters` });
        }

        const spreadsheetId = getSheetId(workbook);
        const { auth, tokenUsed } = getAuthWithDebug();
        const sheetsApi = google.sheets({ version: 'v4', auth });

        // Fetch current cell values for all update targets
        const ranges = updates.map(u => `${sheet}!${u.dbcol}${u.dbrow}`);

        const batchRes = await sheetsApi.spreadsheets.values.batchGet({
            spreadsheetId,
            ranges
        });

        const valueRanges = batchRes.data.valueRanges || [];

        const results = updates.map((update, i) => {
            const cell = valueRanges[i]?.values?.[0]?.[0] || ''; // empty -> ''

            // Assume cell is stored like: "123|data" where "123" is version
            const currentVersion = cell === '' ? 0 : JSON.parse(cell)['a'];
            if ((parseInt(update.expectedVersion,10) + 1) !== parseInt(update.value['a'],10)) {
                return {
                    update,
                    status: 'conflict',
                    target_version: update.expectedVersion,
                    payload_version: update.value['a']
                }
            }
            else if (Number(currentVersion) === Number(update.expectedVersion)) {
                return { update, status: 'ok' };
            } else {
                return {
                    update,
                    status: 'conflict',
                    currentValue: cell,
                    currentVersion
                };
            }
        });

        // Separate successful updates from conflicts
        const okUpdates = results.filter(r => r.status === 'ok').map(r => r.update);
        const conflicts = results.filter(r => r.status === 'conflict');

        // Perform batch update only for OK updates
        const rowTimestamps = {};

        // Build the update requests for changed cells
        const batchData = okUpdates.map(update => {
            const row = parseInt(update.dbrow, 10);

            // Track the latest timestamp for this row
            const ts = parseInt(update.last_modified, 10); // assuming it's numeric UNIX timestamp
            if (!rowTimestamps[row] || ts > rowTimestamps[row]) {
                rowTimestamps[row] = ts;
            }

            return {
                range: `${sheet}!${update.dbcol}${row}`,
                values: [[JSON.stringify(update.value)]]
            };
        });

        // Add updates for the last_modified column (A) for each affected row
        Object.entries(rowTimestamps).forEach(([row, ts]) => {
            batchData.push({
                range: `${sheet}!A${row}`,
                values: [[ts]]
            });
        });

        // Send all updates in a single batch
        if (batchData.length > 0) {
            await sheetsApi.spreadsheets.values.batchUpdate({
                spreadsheetId,
                requestBody: {
                    valueInputOption: 'RAW',
                    data: batchData
                }
            });
        }

        // Return conflict info
        res.json({
            updatedCount: okUpdates.length,
            conflicts,
            tokenUsed
        });


    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }

    // try {
    //     const { workbook, sheet } = req.query;

    //     const { updates } = req.body;
    //     if (!workbook || !sheet || !updates || !Array.isArray(updates)) {
    //         return res.status(400).json({ error: `Missing or invalid parameters ${updates}` });
    //     }

    //     const spreadsheetId = getSheetId(workbook);
    //     const { auth, tokenUsed } = getAuthWithDebug();
    //     const sheets = google.sheets({ version: 'v4', auth });

    //     const data = updates.map(update => ({
    //         range: `${sheet}!${update.dbcol}${update.dbrow}`,
    //         values: [[update.value]],
    //     }));

    //     await sheets.spreadsheets.values.batchUpdate({
    //         spreadsheetId,
    //         requestBody: {
    //             valueInputOption: 'RAW',
    //             data,
    //         },
    //     });

    //     res.json({ success: true, updated: updates.length, tokenUsed });
    // } catch (err) {
    //     console.error('❌ Error in POST /update:', err.message);
    //     res.status(500).json({ error: err.message });
    // }
});


// POST /api/push?sheet=xyz
// Body: { entries: [[...], [...]] } or array of arrays
router.post('/db/insert-col', async (req, res) => {
    console.log("called /api/db/insert-col... ")
    try {
        const { workbook, sheet_id } = req.query;
        const { } = req.body;
        if (!workbook || !sheet_id) {
            return res.status(400).json({ error: 'Missing or invalid parameters' });
        }

        const spreadsheetId = getSheetId(workbook);
        const { auth, tokenUsed } = getAuthWithDebug();

        const sheets = google.sheets({ version: 'v4', auth });

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [
                    {
                        insertDimension: {
                            range: {
                                sheetId: sheet_id,
                                dimension: 'COLUMNS',
                                startIndex: 4,
                                endIndex: 5,
                            },
                            inheritFromBefore: false
                        }
                    }
                ]
            }
        });


        res.json({ success: true, tokenUsed });
    } catch (err) {
        console.error('❌ Error in POST /push:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post('/db/insert-row', async (req, res) => {
    console.log("called /api/db/insert-row... ")
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
