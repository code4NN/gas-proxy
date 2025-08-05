
// lib/sheetMap.js
export const SHEET_MAP = {
    dev: '1n09MID5pijku-IiijcPIO0p_c79n6XecfpQBzkJnQpE',
    users: 'your-sheet-id-1',
    tasks: 'your-sheet-id-2',
    // Add more as needed
};

export function getSheetId(alias) {
    const id = SHEET_MAP[alias];
    // console.log(id, alias)
    if (!id) throw new Error(`Unknown sheet alias: ${alias}`);
    return id;
}
