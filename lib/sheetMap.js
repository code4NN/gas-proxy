// lib/sheetMap.js
export const SHEET_MAP = {
    users: 'your-sheet-id-1',
    tasks: 'your-sheet-id-2',
    // Add more as needed
};

export function getSheetId(alias) {
    const id = SHEET_MAP[alias];
    if (!id) throw new Error(`Unknown sheet alias: ${alias}`);
    return id;
}
