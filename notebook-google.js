/* Google Drive / Calendar integration for 我的記事簿 (GitHub Pages). */
(() => {
  const CLIENT_ID = '834974194833-onn2a51uddmjf458ced478ivis0fb5f1.apps.googleusercontent.com';
  const SCOPES = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar.events.readonly';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  let token = '';

  const state = () => eval('({ notes, selected })');
  const dayIso = () => `2026-09-${String(state().selected || 13).padStart(2, '0')}`;
  const minguoDay = () => `115-09-${String(state().selected || 13).padStart(2, '0')}`;
  const authHeaders = () => ({ Authorization: `Bearer ${token}` });
  const safe = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error?.message || 'Google 服務暫時無法完成要求');
    return response.status === 204 ? null : response.json();
  }

  async function findOrCreateFolder(name, parentId) {
    const q = [`name = '${name.replace(/'/g, "\\'")}'`, `mimeType = '${FOLDER_MIME}'`, 'trashed = false'];
    if (parentId) q.push(`'${parentId}' in parents`);
    const found = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q.join(' and '))}&fields=files(id,name)&pageSize=20`);
    if (found.files?.length) return found.files[0].id;
    const body = { name, mimeType: FOLDER_MIME };
    if (parentId) body.parents = [parentId];
    return (await api('https://www.googleapis.com/drive/v3/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).id;
  }

  async function dateFolder() {
    const root = await findOrCreateFolder('我的記事簿');
    return findOrCreateFolder(minguoDay(), root);
  }

  async function uploadFile(folderId, file, title = file.name) {
    const boundary = `notebook_${Date.now()}`;
    const meta = { name: title, parents: [folderId] };
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`, file, `\r\n--${boundary}--`
    ], { type: `multipart/related; boundary=${boundary}` });
    return api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  }

  async function saveToDrive(note) {
    const folderId = await dateFolder();
    const markdown = `# ${note.title}\n\n日期：民國 ${minguoDay()}\n時間：${note.time || '未設定'}\n重要性：${note.kind || '一般'}\n\n${note.detail || ''}\n`;
    await uploadFile(folderId, new File([markdown], `${note.title}.md`, { type: 'text/markdown;charset=utf-8' }));
    const files = [...document.getElementById('file').files];
    for (const file of files) await uploadFile(folderId, file);
  }

  async function importCalendar() {
    const start = new Date(`${dayIso()}T00:00:00+08:00`).toISOString();
    const end = new Date(`${dayIso()}T23:59:59+08:00`).toISOString();
    const data = await api(`https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(start)}&timeMax=${encodeURIComponent(end)}`);
    const target = state().selected || 13;
    const old = (state().notes[target] || []).filter(n => !n.calendarImport);
    const events = (data.items || []).map(event => ({
      title: event.summary || '未命名行程',
      time: event.start?.dateTime ? new Date(event.start.dateTime).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }) : '全天',
      kind: 'blue', detail: event.description || event.location || 'Google 日曆行程', tags: '日曆匯入', calendarImport: true
    }));
    state().notes[target] = [...old, ...events];
    window.renderCalendar(); window.renderAgenda();
    window.showToast(events.length ? `已匯入 ${events.length} 筆 Google 日曆行程` : '這天沒有 Google 日曆行程');
  }

  async function searchDrive(query) {
    const q = `fullText contains '${query.replace(/'/g, "\\'")}' and trashed = false`;
    const result = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&pageSize=10`);
    return result.files || [];
  }

  window.connectDrive = () => {
    if (!window.google?.accounts?.oauth2) { window.showToast('Google 授權元件載入中，請稍後再試'); return; }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPES,
      callback: async response => {
        if (response.error) { window.showToast('Google 授權未完成'); return; }
        token = response.access_token;
        document.getElementById('driveState').textContent = 'Google Drive 已連結';
        try { await importCalendar(); } catch (error) { window.showToast(`已連結，但日曆匯入失敗：${error.message}`); }
      }
    });
    client.requestAccessToken({ prompt: 'consent' });
  };

  const originalPick = window.pick;
  window.pick = async d => { originalPick(d); if (token) { try { await importCalendar(); } catch (_) {} } };
  const originalSave = window.saveNote;
  window.saveNote = async () => {
    const title = document.getElementById('title').value.trim();
    if (!title) return originalSave();
    if (!token) { window.showToast('請先連結 Google Drive，再儲存記事'); return; }
    const note = { title, time: document.getElementById('time').value, kind: document.getElementById('priority').value, detail: document.getElementById('detail').value };
    const button = document.querySelector('#editor button:last-child');
    if (button) button.disabled = true;
    try {
      await saveToDrive(note);
      const target = state().selected || 13;
      state().notes[target] ??= [];
      state().notes[target].push({ ...note, file: [...document.getElementById('file').files].map(f => f.name).join('、'), tags: '記事' });
      window.closeEditor(); window.renderCalendar(); window.renderAgenda();
      document.getElementById('title').value = ''; document.getElementById('detail').value = ''; document.getElementById('file').value = '';
      window.showToast(`已同步到 Google Drive／我的記事簿／${minguoDay()}`);
    } catch (error) { window.showToast(`儲存失敗：${error.message}`); }
    finally { if (button) button.disabled = false; }
  };
  const originalSearch = window.searchNotes;
  window.searchNotes = async () => {
    const query = document.getElementById('search').value.trim();
    if (query.length < 2) return originalSearch();
    if (!token) { window.showToast('請先連結 Google Drive，才能搜尋雲端記事'); return; }
    try {
      const files = await searchDrive(query);
      window.showToast(files.length ? `雲端找到：${files.map(f => safe(f.name)).join('、')}` : '雲端沒有符合的記事');
    } catch (error) { window.showToast(`搜尋失敗：${error.message}`); }
  };
})();

