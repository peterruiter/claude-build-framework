// Azure AI Speech: where to send requests and how to sign them.
//
//   auth: "key"    the key is read from the environment variable `narration.keyEnv` (default
//                  AZURE_SPEECH_KEY) at run time; requests go to the region's endpoints, or to
//                  `narration.endpoint` (a custom subdomain) when it is set.
//   auth: "entra"  a Microsoft Entra token from the signed-in Azure CLI (`az login`), for a
//                  resource with local (key) authentication switched off. Needs
//                  `narration.endpoint` (the resource's custom subdomain) and the Cognitive Services
//                  Speech User role. `narration.subscription` is passed to az when set.
//
// The key and the token live in this process only: never printed, logged or written anywhere.
import { exec } from 'node:child_process';
import { config } from './config.mjs';

let cached = null;

function az(command) {
  return new Promise((done, fail) => {
    exec(`az ${command}`, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) fail(new Error(`az ${command.split(' ').slice(0, 3).join(' ')} failed: ${String(stderr).split('\n')[0]}`));
      else done(stdout);
    });
  });
}

async function entraToken() {
  if (cached && cached.expires - Date.now() > 5 * 60 * 1000) return cached.token;
  const sub = config().narration.subscription;
  const out = await az(`account get-access-token --resource https://cognitiveservices.azure.com${sub ? ` --subscription ${sub}` : ''} -o json`);
  const parsed = JSON.parse(out);
  const expires = parsed.expires_on ? parsed.expires_on * 1000 : Date.parse(parsed.expiresOn);
  cached = { token: parsed.accessToken, expires };
  return cached.token;
}

export function forgetToken() { cached = null; }

/** The headers that sign a Speech request. */
export async function speechHeaders() {
  const n = config().narration;
  if (n.auth === 'entra') {
    if (!n.endpoint) throw new Error('narration.auth "entra" needs narration.endpoint (the resource\'s custom subdomain, https://<name>.cognitiveservices.azure.com)');
    return { Authorization: `Bearer ${await entraToken()}` };
  }
  const key = process.env[n.keyEnv];
  if (!key) throw new Error(`No Speech key: set the environment variable ${n.keyEnv} (never put it in the config), or render with --no-voice.`);
  return { 'Ocp-Apim-Subscription-Key': key };
}

export function ttsUrl() {
  const n = config().narration;
  if (n.endpoint) return `${n.endpoint.replace(/\/$/, '')}/tts/cognitiveservices/v1`;
  if (!n.region) throw new Error('narration.region (e.g. westeurope) or narration.endpoint is needed for Azure Speech');
  return `https://${n.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

export function transcribeUrl() {
  const n = config().narration;
  const host = n.endpoint ? n.endpoint.replace(/\/$/, '') : `https://${n.region}.api.cognitive.microsoft.com`;
  return `${host}/speechtotext/transcriptions:transcribe?api-version=2024-11-15`;
}
