// ==UserScript==
// @name         Movoa AI Video Generator: turn selected text into a video with sound
// @namespace    https://movoa.ai
// @version      0.1.0
// @description  Unlimited AI video generator with sound: on paid plans the tenth take of a shot costs what the first did, and your first clip is free to make right now. Turn selected text on any page into a video clip with sound using your Movoa API key.
// @author       Movoa
// @homepageURL  https://movoa.ai/?utm_source=greasyfork&utm_medium=userscript
// @supportURL   https://github.com/hanshs474/movoa-userscript/issues
// @license      MIT
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      movoa.ai
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const BASE = 'https://movoa.ai';
  const SITE = BASE + '/?utm_source=greasyfork&utm_medium=userscript';
  const KEYS_URL = BASE + '/settings/apikeys';
  const KEY_STORAGE = 'movoa_api_key';

  function getApiKey() {
    return (GM_getValue(KEY_STORAGE, '') || '').trim();
  }

  function promptForApiKey() {
    const current = getApiKey();
    const val = window.prompt(
      'Enter your Movoa API key (create one at ' + KEYS_URL + '):',
      current
    );
    if (val === null) return '';
    const trimmed = val.trim();
    GM_setValue(KEY_STORAGE, trimmed);
    return trimmed;
  }

  function call(method, path, apiKey, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: BASE + path,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 60000,
        onload: (r) => {
          if (r.status === 401) {
            reject(new Error('Invalid Movoa API key. Set a new key from ' + KEYS_URL));
            return;
          }
          try {
            resolve(JSON.parse(r.responseText));
          } catch (e) {
            reject(new Error('Unexpected response from Movoa (HTTP ' + r.status + ')'));
          }
        },
        onerror: () => reject(new Error('Network error reaching Movoa')),
        ontimeout: () => reject(new Error('Request to Movoa timed out')),
      });
    });
  }

  async function generate(promptText, onStatus) {
    let apiKey = getApiKey();
    if (!apiKey) {
      apiKey = promptForApiKey();
      if (!apiKey) throw new Error('Movoa API key is required.');
    }

    const env = await call('POST', '/api/ai/generate', apiKey, {
      provider: 'auto',
      mediaType: 'video',
      model: 'minimax-h3',
      scene: 'text-to-video',
      prompt: promptText,
      options: {
        duration: 6,
        resolution: '480p',
        aspect_ratio: '16:9',
        sound: true,
      },
    });

    if (env.code === -2) throw new Error('Prompt rejected by content check. Try rewording it.');
    if (env.code === -3) throw new Error('Cooling down. Please wait a moment and try again.');
    if (env.code !== 0) {
      const d = env.data || {};
      if (d.reason === 'insufficient_credits') throw new Error('Insufficient Movoa credits.');
      if (d.reason === 'plan_required') throw new Error('This model or quality requires a Movoa plan.');
      if (d.reason === 'concurrency') throw new Error('Too many concurrent runs on this account.');
      throw new Error(env.message || 'Request refused');
    }

    const d = env.data || {};
    if (!d.id) throw new Error('No task id returned.');
    onStatus('Queued on Movoa…');

    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10000));
      let p;
      try {
        p = await call('POST', '/api/ai/query', apiKey, { taskId: d.id });
      } catch (e) {
        continue;
      }
      if (p.code !== 0) continue;
      const q = p.data || {};
      if (q.status === 'success' && q.videos && q.videos.length) return q.videos[0];
      if (q.status === 'failed' || q.status === 'canceled') {
        throw new Error(q.errorMessage || 'Video generation failed.');
      }
      if (q.queued && q.queueEta) {
        onStatus('Queued (~' + q.queueEta + 's)…');
      } else {
        onStatus('Generating video with sound…');
      }
    }
    throw new Error('Timed out waiting for video (task ' + d.id + ').');
  }

  let panel;
  function showPanel(promptText) {
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:320px;padding:12px;' +
      'background:#111;color:#eee;font:13px/1.4 system-ui,sans-serif;border-radius:10px;' +
      'box-shadow:0 6px 24px rgba(0,0,0,.45)';
    const status = document.createElement('div');
    status.textContent = 'Sending to Movoa…';
    const close = document.createElement('button');
    close.textContent = '×';
    close.style.cssText =
      'float:right;background:none;border:0;color:#aaa;font-size:18px;cursor:pointer;line-height:1';
    close.onclick = () => panel.remove();
    panel.append(close, status);
    document.body.appendChild(panel);

    generate(promptText, (s) => {
      status.textContent = s;
    })
      .then((url) => {
        status.textContent = '';
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.autoplay = true;
        video.loop = true;
        video.style.cssText = 'display:block;width:100%;border-radius:6px;margin:6px 0';
        const links = document.createElement('div');
        const open = document.createElement('a');
        open.href = url;
        open.target = '_blank';
        open.textContent = 'Open MP4';
        const more = document.createElement('a');
        more.href = SITE;
        more.target = '_blank';
        more.textContent = 'More models on Movoa';
        [open, more].forEach((a) => {
          a.style.cssText = 'color:#8ab4ff;margin-right:12px;text-decoration:none';
        });
        links.append(open, more);
        panel.append(video, links);
      })
      .catch((e) => {
        status.textContent = e.message + ' ';
        const link = document.createElement('a');
        link.href = e.message.includes('API key') ? KEYS_URL : SITE;
        link.target = '_blank';
        link.textContent = e.message.includes('API key') ? 'Get API key' : 'Open Movoa';
        link.style.color = '#8ab4ff';
        status.append(link);
      });
  }

  function selected() {
    return String(window.getSelection() || '').trim().slice(0, 1000);
  }

  let button;
  document.addEventListener('mouseup', (e) => {
    if (button && e.target === button) return;
    if (button) {
      button.remove();
      button = null;
    }
    const text = selected();
    if (text.length < 3) return;
    button = document.createElement('button');
    button.textContent = '🎬 Video';
    button.title = 'Turn the selected text into an AI video with sound on Movoa';
    button.style.cssText =
      'position:fixed;z-index:2147483647;padding:4px 8px;border:0;border-radius:6px;' +
      'background:#111;color:#fff;font:12px system-ui,sans-serif;cursor:pointer;' +
      'left:' + Math.min(e.clientX + 8, window.innerWidth - 90) + 'px;' +
      'top:' + Math.max(e.clientY - 34, 4) + 'px';
    button.addEventListener('mousedown', (ev) => ev.preventDefault());
    button.addEventListener('click', () => {
      const t = selected();
      button.remove();
      button = null;
      if (t) showPanel(t);
    });
    document.body.appendChild(button);
  });

  GM_registerMenuCommand('Generate an AI video from a prompt…', () => {
    const t = window.prompt('Describe the video:', selected());
    if (t && t.trim()) showPanel(t.trim());
  });

  GM_registerMenuCommand('Set Movoa API key…', () => {
    promptForApiKey();
  });
})();
