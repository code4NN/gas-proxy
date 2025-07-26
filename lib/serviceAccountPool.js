import { google } from 'googleapis';
import account1 from '../creds/account1.json' assert { type: 'json' };
import account2 from '../creds/account2.json' assert { type: 'json' };
// Add more as needed...

const accounts = [account1, account2];
let current = 0;

export function getNextAuth() {
    const creds = accounts[current];
    current = (current + 1) % accounts.length;

    return new google.auth.JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}
