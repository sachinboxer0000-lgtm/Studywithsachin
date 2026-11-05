/* ============================================================
   Sachin Study — Notifications Engine (v2)
   हर subject का अगला chapter notification में दिखाएगा
   ============================================================ */
(function () {
  "use strict";

  const STORAGE_KEY = "sachinStudyApp12v2";
  const SESSIONS_KEY = "studySessions_v1";

  let LocalNotifications = null;
  let capacitorReady = false;
  let rescheduling = false;

  /* ---------- SESSIONS ---------- */
  function loadSessions() {
    try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function saveSessions(sessions) {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }

  /* ---------- CHAPTER DATA ---------- */
  function loadStudyData() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
    catch (e) { return []; }
  }

  /* ---------- PER SUBJECT NEXT CHAPTER ---------- */
  function getNextChaptersPerSubject() {
    const data = loadStudyData();
    if (!Array.isArray(data) || data.length === 0) return [];

    const subjects = [...new Set(data.map(b => b.subject))];
    const result = [];

    subjects.forEach(subj => {
      const books = data.filter(b => b.subject === subj);
      const allCh = [];
      books.forEach(b => {
        (b.chapters || []).forEach(c => {
          allCh.push({ title: c.title, status: c.status });
        });
      });
      let next = allCh.find(c => c.status === "doing");
      if (!next) next = allCh.find(c => c.status === "todo");
      if (next) {
        result.push({
          subject: subj,
          chapter: next.title,
          status: next.status
        });
      }
    });

    return result;
  }

  /* ---------- BUILD BODY ---------- */
  function buildNotificationBody() {
    const list = getNextChaptersPerSubject();
    if (list.length === 0) return "🎉 सभी chapters पूरे! अब revision करो।";

    return list.map(item => {
      const icon = item.status === "doing" ? "🔄" : "📖";
      const ch = item.chapter.length > 32
        ? item.chapter.substring(0, 32) + "..."
        : item.chapter;
      return `${icon} ${item.subject}: ${ch}`;
    }).join("\n");
  }

  /* ---------- CAPACITOR INIT ---------- */
  async function initCapacitor() {
    if (window.Capacitor && window.Capacitor.Plugins &&
        window.Capacitor.Plugins.LocalNotifications) {
      LocalNotifications = window.Capacitor.Plugins.LocalNotifications;
      capacitorReady = true;
      console.log("✅ LocalNotifications ready (global)");
      return true;
    }
    try {
      const mod = await import("@capacitor/local-notifications");
      LocalNotifications = mod.LocalNotifications;
      capacitorReady = true;
      console.log("✅ LocalNotifications ready (module)");
      return true;
    } catch (e) {
      console.log("ℹ️ Browser mode — notifications disabled");
      capacitorReady = false;
      return false;
    }
  }

  /* ---------- PERMISSIONS + CHANNEL ---------- */
  async function setupPermissions() {
    if (!capacitorReady || !LocalNotifications) return;
    try {
      try {
        await LocalNotifications.createChannel({
          id: "study-channel",
          name: "Study Reminders",
          description: "Padhai ke reminders",
          importance: 5,
          visibility: 1,
          vibration: true
        });
      } catch (e) { console.log("Channel:", e); }

      let perm = await LocalNotifications.checkPermissions();
      if (perm.display !== "granted") {
        perm = await LocalNotifications.requestPermissions();
      }
      console.log("Permission:", perm.display);
    } catch (e) {
      console.log("Setup error:", e);
    }
  }

  /* ---------- RESCHEDULE ---------- */
  async function rescheduleAllNotifications() {
    if (!capacitorReady || !LocalNotifications) return;
    if (rescheduling) return;
    rescheduling = true;

    try {
      try {
        const pending = await LocalNotifications.getPending();
        if (pending.notifications.length > 0) {
          await LocalNotifications.cancel({ notifications: pending.notifications });
        }
      } catch (e) { console.log("Cancel:", e); }

      const sessions = loadSessions();
      if (sessions.length === 0) {
        console.log("No sessions to schedule");
        return;
      }

      const body = buildNotificationBody();
      const title = "📚 पढ़ाई का समय!";
      const DAYS_AHEAD = 7;
      const notifications = [];
      const now = new Date();

      sessions.forEach((session, idx) => {
        if (!session.time) return;
        const [h, m] = session.time.split(":").map(Number);
        const firstDay = new Date();
        firstDay.setHours(h, m, 0, 0);
        if (firstDay.getTime() <= now.getTime()) {
          firstDay.setDate(firstDay.getDate() + 1);
        }

        for (let d = 0; d < DAYS_AHEAD; d++) {
          const fireAt = new Date(firstDay);
          fireAt.setDate(fireAt.getDate() + d);
          notifications.push({
            title: title,
            body: body,
            id: (idx + 1) * 100 + d,
            schedule: { at: fireAt, allowWhileIdle: true },
            channelId: "study-channel"
          });
        }
      });

      if (notifications.length > 0) {
        await LocalNotifications.schedule({ notifications });
        console.log(`✅ ${notifications.length} notifications scheduled`);
      }
    } catch (e) {
      console.log("Schedule error:", e);
    } finally {
      rescheduling = false;
    }
  }

  /* ---------- UI ---------- */
  function injectUI() {
    if (document.getElementById("remFab")) return;

    const fab = document.createElement("button");
    fab.id = "remFab";
    fab.innerHTML = "⏰";
    fab.title = "Study Reminders";
    fab.style.cssText =
      "position:fixed;bottom:20px;right:20px;width:56px;height:56px;" +
      "border-radius:50%;background:linear-gradient(135deg,#7c3aed,#8b5cf6);" +
      "border:none;color:#fff;font-size:26px;cursor:pointer;" +
      "box-shadow:0 4px 16px rgba(139,92,246,.5);z-index:500;" +
      "display:grid;place-items:center;transition:transform .2s;";
    fab.onmouseenter = () => fab.style.transform = "scale(1.1)";
    fab.onmouseleave = () => fab.style.transform = "scale(1)";
    fab.onclick = openModal;
    document.body.appendChild(fab);

    const modal = document.createElement("div");
    modal.id = "remModal";
    modal.style.cssText =
      "display:none;position:fixed;top:0;left:0;right:0;bottom:0;" +
      "background:rgba(0,0,0,.75);z-index:1000;padding:20px;overflow-y:auto;";
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    modal.innerHTML = `
      <div style="max-width:500px;margin:20px auto;background:linear-gradient(135deg,#14142a,#1a1a35);border:1px solid #2a2a44;border-radius:18px;padding:20px;color:#e8e8f2;font-family:'Segoe UI',system-ui,sans-serif;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h2 style="margin:0;font-size:18px;">⏰ Study Reminders</h2>
          <button id="remCloseBtn" style="background:rgba(255,255,255,.1);border:none;color:#fff;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:16px;">✕</button>
        </div>
        <p style="font-size:12.5px;color:#8a8aa8;margin:0 0 16px;line-height:1.5;">
          जो समय यहाँ सेट करोगे, उस समय हर दिन notification आएगी। Notification में <b style="color:#c4b5fd">हर subject का अगला chapter</b> दिखेगा।
        </p>
        <div id="sessList" style="margin-bottom:16px;"></div>
        <div style="background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.3);border-radius:12px;padding:14px;">
          <div style="font-size:12px;color:#8a8aa8;margin-bottom:6px;font-weight:600;">नया समय जोड़ें</div>
          <input type="time" id="newSessTime" value="20:00"
            style="width:100%;padding:10px;border-radius:10px;border:1px solid #2a2a44;background:#0f0f1e;color:#e8e8f2;font-size:14px;margin-bottom:8px;">
          <input type="text" id="newSessLabel" placeholder="Label (जैसे: Evening Study)"
            style="width:100%;padding:10px;border-radius:10px;border:1px solid #2a2a44;background:#0f0f1e;color:#e8e8f2;font-size:14px;margin-bottom:10px;">
          <button id="addSessBtn"
            style="width:100%;padding:12px;border-radius:11px;border:none;background:linear-gradient(135deg,#7c3aed,#8b5cf6);color:#fff;font-weight:700;font-size:14px;cursor:pointer;">
            ➕ Session जोड़ें
          </button>
        </div>
        <div style="margin-top:16px;font-size:11px;color:#8a8aa8;text-align:center;">
          Notification permission: <span id="permStatus">checking...</span>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById("remCloseBtn").onclick = closeModal;

    document.getElementById("addSessBtn").onclick = async () => {
      const time = document.getElementById("newSessTime").value;
      const label = document.getElementById("newSessLabel").value.trim() || "Study";
      if (!time) { alert("समय चुनें"); return; }

      const sessions = loadSessions();
      if (sessions.some(s => s.time === time)) {
        if (!confirm("इस समय पर पहले से session है। फिर भी जोड़ें?")) return;
      }
      sessions.push({ id: "s" + Date.now(), time, label });
      saveSessions(sessions);

      await setupPermissions();
      await rescheduleAllNotifications();
      renderSessionsList();
      document.getElementById("newSessLabel").value = "";
      if (window.toast) window.toast("✅ Session जोड़ा गया");
      else alert("✅ Session जोड़ा गया");
    };
  }

  function renderSessionsList() {
    const container = document.getElementById("sessList");
    if (!container) return;
    const sessions = loadSessions();

    if (sessions.length === 0) {
      container.innerHTML =
        '<div style="text-align:center;padding:16px;background:rgba(255,255,255,.03);' +
        'border-radius:12px;color:#8a8aa8;font-size:13px;">' +
        'अभी कोई session नहीं। नीचे से add करें।</div>';
      return;
    }
    container.innerHTML = sessions.map(s => `
      <div style="display:flex;align-items:center;gap:10px;padding:12px;background:#0f0f1e;border:1px solid #2a2a44;border-radius:10px;margin-bottom:8px;">
        <div style="flex:1;">
          <div style="font-size:16px;font-weight:700;color:#c4b5fd;">${s.time}</div>
          <div style="font-size:11px;color:#8a8aa8;margin-top:2px;">${escapeHtml(s.label)}</div>
        </div>
        <button data-del-sess="${s.id}" style="width:32px;height:32px;border-radius:8px;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);color:#fca5a5;cursor:pointer;font-size:14px;">🗑</button>
      </div>
    `).join("");

    container.querySelectorAll("[data-del-sess]").forEach(btn => {
      btn.onclick = async () => {
        if (!confirm("यह session हटाएँ?")) return;
        const id = btn.dataset.delSess;
        saveSessions(loadSessions().filter(x => x.id !== id));
        await rescheduleAllNotifications();
        renderSessionsList();
        if (window.toast) window.toast("🗑 Session हटाया");
      };
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function closeModal() {
    document.getElementById("remModal").style.display = "none";
  }

  async function openModal() {
    renderSessionsList();
    document.getElementById("remModal").style.display = "block";

    const statusEl = document.getElementById("permStatus");
    if (capacitorReady && LocalNotifications) {
      try {
        const perm = await LocalNotifications.checkPermissions();
        statusEl.textContent = perm.display === "granted" ? "✅ Allowed" : "⚠️ Not allowed";
        statusEl.style.color = perm.display === "granted" ? "#34d399" : "#f59e0b";
      } catch (e) { statusEl.textContent = "Error"; }
    } else {
      statusEl.textContent = "Browser mode (disabled)";
      statusEl.style.color = "#8a8aa8";
    }
  }

  /* ---------- DATA CHANGE DETECTION ---------- */
  let lastHash = "";
  function checkDataChange() {
    const raw = localStorage.getItem(STORAGE_KEY) || "";
    if (raw !== lastHash) {
      lastHash = raw;
      rescheduleAllNotifications();
    }
  }

  /* ---------- BOOT ---------- */
  async function boot() {
    await initCapacitor();
    await setupPermissions();
    injectUI();
    await rescheduleAllNotifications();
    lastHash = localStorage.getItem(STORAGE_KEY) || "";

    setInterval(checkDataChange, 5000);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) checkDataChange();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
