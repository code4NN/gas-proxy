import express, { json } from 'express';
import { google } from 'googleapis';
import { getNextAuth } from '../lib/serviceAccountPool.js';
import { getSheetId } from '../lib/sheetMap.js';
import { clearCache, getCache, setCache } from '../cache.js';

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


        // FETCHER-1 Logic to fetch latest 50 changes from sheet
        const cid_sheetdata = `${get_db_id(workbook, sheet)}_data`
        let response = getCache(cid_sheetdata)

        if (!response) {
            console.log(`fetching ${cid_sheetdata}`)
            const latest_n_changes = 50;
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
        else if (last_synced_at > latest_modified_date) {
            res.json({ error: "mismatch range" })
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

            // cell is stored as json with keys as a, v, 
            const currentVersion = cell === '' ? 0 : JSON.parse(cell)['a'];

            if ((parseInt(update.expectedVersion, 10) + 1) !== parseInt(update.value['a'], 10)) {
                return {
                    update,
                    status: 'conflict',
                    conflict: 'payload version should be exacly +1 of expected version',
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
                    conflict: 'target version different from expected target version',
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
            
            const cid_sheetdata = `${get_db_id(workbook, sheet)}_data`
            clearCache(cid_sheetdata);
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
});


// POST
// --------------- must have
// workbook
// sheet
// ---------------  BODY
// {colinfo}
// {last_modified}
// 
router.post('/db/insert-col', async (req, res) => {
    console.log("called /api/db/insert-col ................................................... ")
    try {
        const { workbook, sheet } = req.query;
        const { colinfo, last_modified } = req.body;
        if (!workbook || !sheet) {
            return res.status(400).json({ error: 'Missing or invalid parameters' });
        }

        const spreadsheetId = getSheetId(workbook);
        const { auth, tokenUsed } = getAuthWithDebug();

        const sheets = google.sheets({ version: 'v4', auth });

        // some performance params

        // ====================== fetch the sheet-id
        let sheetId = ''
        let colIndex = ''

        // ================================================
        // ==================  Fetch the fresh sheetID and last column number
        const id_res = await sheets.spreadsheets.get({
            spreadsheetId,
            ranges: [`${sheet}!1:1`],       // fetch first row values
            includeGridData: true,              // actually return cell values
            fields: "sheets.properties,sheets.data.rowData.values.formattedValue"
        });

        const target_sheet = id_res.data.sheets.find(
            s => s.properties.title === sheet
        );

        if (!target_sheet) {
            throw new Error(`Sheet "${sheet}" not found`);
        }

        sheetId = target_sheet.properties.sheetId;
        const firstRow = target_sheet.data[0]?.rowData[0]?.values?.map(v => v.formattedValue) || [];
        // const firstRow = response.data.values[0];
        const firstBlankIndex = firstRow.findIndex(cell => !cell || cell.trim() === "");
        colIndex = firstBlankIndex;


        // Clear the cached sheet data
        const cid_sheetdata = `${get_db_id(workbook, sheet)}_data`
        const cid_last_col = `${get_db_id(workbook, sheet)}_last_col`
        clearCache(cid_sheetdata);
        clearCache(cid_last_col);
        // ================================================
        // ==================  Fetch the fresh sheetID and last column number


        const requests = [
            // 1️⃣ Insert new column
            {
                insertDimension: {
                    range: {
                        sheetId,
                        dimension: "COLUMNS",
                        startIndex: colIndex - 1,
                        endIndex: colIndex,
                    },
                    inheritFromBefore: false,
                },
            },
            // 2️⃣ Update values in that column
            {
                updateCells: {
                    range: {
                        sheetId,
                        startRowIndex: 0,             // Row 1 (0-based)
                        endRowIndex: 3,               // Row 3 (exclusive)
                        startColumnIndex: colIndex - 1,
                        endColumnIndex: colIndex,
                    },
                    rows: [
                        {
                            values: [
                                { userEnteredValue: { stringValue: `${colIndex - 4}-column` } }
                            ]
                        },
                        {
                            values: [
                                { userEnteredValue: { stringValue: "" } }
                            ]
                        },
                        {
                            values: [
                                { userEnteredValue: { stringValue: JSON.stringify(colinfo) } }
                            ]
                        }
                    ],
                    fields: "userEnteredValue",
                },
            },
            {
                updateCells: {
                    range: {
                        sheetId,
                        startRowIndex: 2,             // Row 1 (0-based)
                        endRowIndex: 3,               // Row 3 (exclusive)
                        startColumnIndex: 0, // first column is last_modified
                        endColumnIndex: 1,
                    },
                    rows: [
                        {
                            values: [
                                { userEnteredValue: { stringValue: `${last_modified}` } }
                            ]
                        }
                    ],
                    fields: "userEnteredValue",
                },
            }
        ];

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests }
        });


        res.json({ success: true, tokenUsed });
    } catch (err) {
        console.error('❌ Error in POST /push:', err.message);
        res.status(500).json({ error: err.message });
    }
});





router.post('/db/insert-row', async (req, res) => {
    console.log("called /api/db/insert-row ................................................... ");

    try {
        const { workbook, sheet } = req.query;
        const { entries } = req.body;

        // 1) Basic validation
        if (!workbook || !sheet || !entries || !Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ error: `Missing or invalid parameters` });
        }

        // Validate structure & dtype
        entries.forEach((e, i) => {
            if (typeof e.last_modified === "undefined" || e.last_modified === null) {
                throw new Error(`Entry[${i}] missing last_modified`);
            }
            if (!e.dtype || !["data", "view"].includes(String(e.dtype).toLowerCase())) {
                throw new Error(`Entry[${i}] dtype must be "data" or "view"`);
            }
            if (!Array.isArray(e.data) || e.data.length === 0) {
                throw new Error(`Entry[${i}] must have non-empty data array`);
            }
            e.data.forEach((d, j) => {
                if (!d.dbcol || typeof d.value === "undefined") {
                    throw new Error(`Entry[${i}].data[${j}] must have dbcol and value`);
                }
                // Optional: sanity-check dbcol looks like a Sheets column (A, B, AA, etc.)
                if (!/^[A-Z]+$/.test(String(d.dbcol).toUpperCase())) {
                    throw new Error(`Entry[${i}].data[${j}].dbcol "${d.dbcol}" is not a valid column ref`);
                }
            });
        });

        const spreadsheetId = getSheetId(workbook);
        const { auth, tokenUsed } = getAuthWithDebug();
        const sheetsApi = google.sheets({ version: 'v4', auth });

        // 2) Batch append A:C → [ last_modified, "", dtypeCell ]
        const dtypeToCell = (t) => (String(t).toLowerCase() === "data" ? "d" : "view");

        const appendValues = entries.map(e => [
            e.last_modified,   // A: last_modified
            null,                // B: leave blank so ARRAYFORMULA can fill dbrow
            dtypeToCell(e.dtype) // C: 'd' for data, 'view' for view
        ]);

        const appendRes = await sheetsApi.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheet}!A:C`,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: appendValues }
        });

        const updatedRange = appendRes.data?.updates?.updatedRange; // e.g. "Sheet1!A10:C12" or "Sheet1!A5:C5" or "Sheet1!A5"
        if (!updatedRange) {
            throw new Error("Could not determine appended rows (missing updatedRange)");
        }

        // Handle both single-cell and range responses
        // Matches: !A10, !A10:C10, !A10:C12
        const m = updatedRange.match(/![A-Z]+(\d+)(?::[A-Z]+(\d+))?$/);
        if (!m) throw new Error(`Failed to parse row range from updatedRange: ${updatedRange}`);

        const startRow = parseInt(m[1], 10);
        const endRow = m[2] ? parseInt(m[2], 10) : startRow;
        const appendedCount = endRow - startRow + 1;

        if (appendedCount !== entries.length) {
            // Not fatal, but good to know; proceed by assuming sequential rows from startRow
            console.warn(`append count mismatch: expected ${entries.length}, got ${appendedCount}`);
        }

        // 3) Build sparse batch updates for JSON-wrapped cell values: { a:1, v:<value> }
        const batchData = entries.flatMap((entry, i) =>
            entry.data.map(d => ({
                range: `${sheet}!${String(d.dbcol).toUpperCase()}${startRow + i}`,
                values: [[JSON.stringify({ a: 1, v: d.value })]]
            }))
        );

        if (batchData.length > 0) {
            await sheetsApi.spreadsheets.values.batchUpdate({
                spreadsheetId,
                requestBody: {
                    valueInputOption: 'RAW',
                    data: batchData
                }
            });

            const cid_sheetdata = `${get_db_id(workbook, sheet)}_data`
            const cid_last_col = `${get_db_id(workbook, sheet)}_last_col`
            clearCache(cid_sheetdata);
            clearCache(cid_last_col);

        }

        // 4) Response
        const results = entries.map((e, i) => ({
            row: startRow + i,
            last_modified: e.last_modified,
            dtype: dtypeToCell(e.dtype),
            updatedCols: e.data.map(d => String(d.dbcol).toUpperCase())
        }));

        res.json({
            insertedCount: entries.length,
            firstRow: startRow,
            results,
            tokenUsed
        });

    } catch (err) {
        console.error('❌ Error in POST /insert-row:', err);
        res.status(500).json({ error: err.message });
    }
});


export default router;
