import { google } from 'googleapis';

// 🛡️ Import your service account credentials
const account1 = {
    "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDdFhDDVQ7T6b5q\nik0wtfiH6FOfJ3fIPjnZdfWCIeiICn5Tj8k3/kV5dUMGpKIx+dOKcNcOnhL999UL\nXJF12Kskqjlo2tZ/q14XgGjn09m9E0s1/o957+/SUt0LU7ATA8aPkgi951xmkUhB\n5+1Qpw3W1Brr951YBb+P3vQBpXwgtWUP/D0W32DMWSlVJbnMYvkA7J5uC+Of+pAX\ndm+CGIdgfFQxpE2MVAONvmtf8Vp/6Mdc6xJW1z40kdtpvZWa8Q40azB2hYCMWmNI\nxZTRyixIyeHDc7UGp0HSzz52dxzeWBV7OmPMCD6wLj4cnybax4hMKQewiTQfFV40\nRYALGzdJAgMBAAECggEAKcBnhQP0q2dqmuMoZakP2NayqA1DjTDXKu6gYSV3LO3S\nYoR2axkdVK0k7cW8jbSQ0wWxT2Th0E1z0dP28mrrEx8EfX1KYczilYyeAx3acl8I\n5pb+0HfT8gPNE70HtOeTIXziIr7lD8ei/jNG+WK69dWTifl2oO9g+FISAZeXY/OT\n2W8yIwgb7Gc4eGVlRq/ylaTwsy9ndLIJAahIhVJq1P41jzxP0BYZNqVhiF7Bcgpk\noagy1DpyB9CT06wamohpxf431fZczZkZDGPKSKU2qX8wpzg/DnH2w+mavSgsdDwl\n8NwJdbND0I0YDJEgBQWXuRjcD+WoKkI44lFtHFQMKwKBgQDu5mnQ+TZSXRVYHO/6\nwXQuoIVK7HvuODn1QDHxRyuJPdElKuQOqgDRfIWx/SP/U5YpfeSKElFneaNgs5Yb\neQ64yHJcHo6Krf0vAt3c7aCxo4CEtrOCz6Qrcv2OsTt4ovJXYZrM3YDPj2w1V6eW\n1s5s+OovFbMj431SbPQ1NTKwfwKBgQDs6Tt5YVL9XAPfyg7jGqtAHtLGOrS2OQwZ\nPTGv9AVjAStlBidd1HqH8ZU4jv0ESEft/bQ1dZc9RH2cuMhVai+ap33Na8QPob2B\n7sk0jqcmobtfYPAtm9EetnADDPUy2kL1S9CAYYI99Gb4IscBFWMRUgNYIQLYAQyW\nzsSRV+K0NwKBgEGeVjhJC2uqF5/BKwVUN6ZK/vGqbQvss7aycEVWiBXFPfoYgtWo\nSls/+bT+0/FgsyEobCqkh2mFlqOMEFHxeWK14/t7hSmASser4Oa6+mVwhG9vg3UN\ntYkdp5mXAr/K+geYTp2wxZ29RjqMngKnc8GoySIvsqnL5XNLa/RlbUvfAoGAaiyA\nrf5TDh790X6hu2AJXZwyxAotUPkyFeGZ8gw/mcY9Z3IhlGiUXXaEdKuIczHdoqgv\n6kF//UJDtUgO6FDFct8bf0OLw6Gt55xXagmAmcyjx7QPD7GkP8ptWsCk5xxwI7TN\nhautjgyJVS1o2HB4TJvfydBJkPqvZKrX53dmr3MCgYBgYMzwB//BvN2+Yzngb7Sf\npY22HTU1O9Py7JD8Wt7hKvua0aPDWQ980OZY6SlQV2rSWk/N3SOw1XoQQgzCr8LJ\nvF7x/l84R9bWTrqd08CPygoF+339tKk4DCusmqCOjjfQoDr/xuald+opipVuUACB\nXmPrUTIudkfa6zMDoIVONQ==\n-----END PRIVATE KEY-----\n",
    "client_email": "ssnn-primary@bdvcentral.iam.gserviceaccount.com",
};
const account2 = {};
// Add more as needed...

const accountCreds = [
    account1,
    // account2
]; // Expand as needed
const jwtClients = new Array(accountCreds.length); // Cache initialized
let current = 0;

/**
 * Returns a JWT client using round-robin strategy.
 * Also returns a flag whether it was cached or freshly created.
 */
export function getNextAuth() {
    const index = current;
    current = (current + 1) % accountCreds.length;

    if (jwtClients[index]) {
        console.log(`✅ Using cached JWT client for account ${index}`);
        return { auth: jwtClients[index], wasCached: true };
    }

    const creds = accountCreds[index];
    if (!creds.client_email || !creds.private_key) {
        throw new Error(`❌ Invalid service account credentials at index ${index}`);
    }

    const client = new google.auth.JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    jwtClients[index] = client;
    console.log(`🚀 Created new JWT client for account ${index}`);
    return { auth: client, wasCached: false };
}