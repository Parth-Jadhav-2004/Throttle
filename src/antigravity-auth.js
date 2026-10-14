const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const OAUTH_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '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';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const B64_PREFIX = 'go-keyring-base64:';
const REFRESH_SKEW_MS = 60 * 1000;

const WINDOWS_CREDENTIAL_SCRIPT = `$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$sig=@'
using System;
using System.Runtime.InteropServices;
public class ThrottleCredentialApi {
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);
  [StructLayout(LayoutKind.Sequential)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;
  }
  public static byte[] Read(string target) {
    IntPtr p; if (!CredRead(target, 1, 0, out p)) return null;
    try {
      var c=(CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      var b=new byte[c.CredentialBlobSize];
      if (c.CredentialBlobSize > 0) Marshal.Copy(c.CredentialBlob, b, 0, c.CredentialBlobSize);
      return b;
    } finally { CredFree(p); }
  }
}
'@
Add-Type -TypeDefinition $sig | Out-Null
$b=[ThrottleCredentialApi]::Read('gemini:antigravity')
if ($b -eq $null) { exit 1 }
[Console]::Out.Write([Convert]::ToBase64String($b))`;

function decodeCredential(raw) {
  const text = String(raw || '').trim();
  const payload = text.startsWith(B64_PREFIX)
    ? Buffer.from(text.slice(B64_PREFIX.length), 'base64').toString('utf8')
    : text;
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('Stored Antigravity credential is not valid JSON');
  }
  const token = parsed.token || parsed;
  if (typeof token.access_token !== 'string' || !token.access_token) {
    throw new Error('Stored Antigravity credential has no access token');
  }
  return {
    accessToken: token.access_token,
    refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : null,
    expiresAt: token.expiry ? Date.parse(token.expiry) : null
  };
}

function readWindowsCredential({
  platform = process.platform,
  execFile = execFileSync
} = {}) {
  if (platform !== 'win32') return null;
  try {
    const encoded = Buffer.from(WINDOWS_CREDENTIAL_SCRIPT, 'utf16le').toString('base64');
    const output = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { encoding: 'utf8', windowsHide: true }
    ).trim();
    if (!output) return null;
    const bytes = Buffer.from(output, 'base64');
    const utf8 = bytes.toString('utf8');
    if (utf8.startsWith(B64_PREFIX) || utf8.trimStart().startsWith('{')) return utf8;
    return bytes.toString('utf16le');
  } catch {
    return null;
  }
}

function readFileCredential({
  tokenPath = process.env.AGY_OAUTH_TOKEN_FILE ||
    path.join(os.homedir(), '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
  readFile = filePath => fs.readFileSync(filePath, 'utf8')
} = {}) {
  try {
    return readFile(tokenPath).trim() || null;
  } catch {
    return null;
  }
}

async function refreshAccessToken(refreshToken, {
  fetchFn = globalThis.fetch.bind(globalThis)
} = {}) {
  const response = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET
    }).toString()
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || 'Antigravity login required');
  }
  return payload.access_token;
}

async function getAntigravityAccessToken({
  now = () => Date.now(),
  readWindows = readWindowsCredential,
  readFile = readFileCredential,
  fetchFn = globalThis.fetch.bind(globalThis)
} = {}) {
  const raw = readWindows() || readFile();
  if (!raw) throw new Error('Antigravity login required');
  const credential = decodeCredential(raw);
  const expiring = Number.isFinite(credential.expiresAt) &&
    credential.expiresAt - now() < REFRESH_SKEW_MS;
  if (expiring && credential.refreshToken) {
    return refreshAccessToken(credential.refreshToken, { fetchFn });
  }
  return credential.accessToken;
}

module.exports = {
  decodeCredential,
  readWindowsCredential,
  readFileCredential,
  refreshAccessToken,
  getAntigravityAccessToken
};
