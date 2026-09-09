/**
 * One-time script to get a Gmail OAuth refresh token.
 *
 * Run: npx tsx scripts/get-gmail-token.ts
 *
 * 1. Opens your browser to Google sign-in
 * 2. You sign in with sean@sololawyerai.com
 * 3. Grant Gmail access
 * 4. Paste the redirect URL back here
 * 5. Script prints the refresh token to add to .env
 */

import http from 'node:http';
import { URL } from 'node:url';

const CLIENT_ID = process.env.GMAIL_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || '';
if (!CLIENT_ID || !CLIENT_SECRET) {
  throw new Error('Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in your environment (.env) before running this script.');
}
const REDIRECT_URI = 'http://localhost:3333/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

// Build the auth URL
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES.join(' '));
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

console.log('\n========================================');
console.log('Gmail OAuth Setup for Riley');
console.log('========================================\n');
console.log('Opening your browser...\n');
console.log('If it doesn\'t open, go to this URL:\n');
console.log(authUrl.toString());
console.log('\nWaiting for callback on http://localhost:3333 ...\n');

// Open browser
const openCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
import { exec } from 'node:child_process';
exec(`${openCmd} "${authUrl.toString()}"`);

// Start a local server to catch the callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:3333`);

  if (url.pathname !== '/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400);
    res.end('No code received');
    return;
  }

  // Exchange code for tokens
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenRes.json() as Record<string, unknown>;

    if (tokens.error) {
      console.error('\nError:', tokens.error, tokens.error_description);
      res.writeHead(500);
      res.end('Token exchange failed. Check the terminal.');
      server.close();
      return;
    }

    console.log('\n========================================');
    console.log('SUCCESS! Add these to your .env file:');
    console.log('========================================\n');
    console.log(`GMAIL_CLIENT_ID=${CLIENT_ID}`);
    console.log(`GMAIL_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`GMAIL_DELEGATED_USER=sean@sololawyerai.com`);
    console.log('\n========================================\n');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Done! Go back to the terminal.</h1><p>You can close this tab.</p>');
    server.close();
  } catch (err) {
    console.error('Token exchange failed:', err);
    res.writeHead(500);
    res.end('Error — check terminal');
    server.close();
  }
});

server.listen(3333);
