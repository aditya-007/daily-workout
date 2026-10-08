// dashboard.js — private read-only analytics for the workout app.
// Reads workout_sessions / exercise_events via the admin-only RLS policy (see migrations).
// Reuses EXERCISES / WEEKLY_SCHEDULE from the parent app's static data files (read-only).

(function () {
  const LOOKBACK_DAYS = 400;
  const IST_TZ = "Asia/Kolkata";
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

  const EX_MAP = {};
  (typeof EXERCISES !== "undefined" ? EXERCISES : []).forEach((e) => {
    EX_MAP[e.id] = e;
  });

  let client = null;
  let sessions = [];
  let events = [];
  let calendarYear = null;
  let calendarMonth = null; // 1-12, IST
  let refreshTimer = null;
  let selectedUserId = "";
  let lastUpdatedAt = null;

  // ---------- IST-aware date helpers ----------
  // All "which day/week/month did this happen" logic is anchored to India time,
  // since that's where the tracked usage actually happens, not the viewer's timezone.
  const istFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });

  function istParts(dateInput) {
    const parts = {};
    istFormatter.formatToParts(new Date(dateInput)).forEach((p) => {
      parts[p.type] = p.value;
    });
    const hour = parts.hour === "24" ? 0 : parseInt(parts.hour, 10);
    return {
      year: parseInt(parts.year, 10),
      month: parseInt(parts.month, 10),
      day: parseInt(parts.day, 10),
      hour: hour,
      minute: parseInt(parts.minute, 10),
      weekday: parts.weekday,
      dateKey: parts.year + "-" + parts.month + "-" + parts.day,
    };
  }

  function istDowIndex(weekdayShort) {
    // Matches JS Date#getDay(): 0=Sun..6=Sat, same convention WEEKLY_SCHEDULE uses.
    const order = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return order[weekdayShort];
  }

  function formatIstTime(dateInput) {
    const p = istParts(dateInput);
    const hh = String(p.hour).padStart(2, "0");
    const mm = String(p.minute).padStart(2, "0");
    return hh + ":" + mm;
  }

  function formatIstDateLabel(dateInput) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: IST_TZ,
      day: "2-digit",
      month: "short",
    }).format(new Date(dateInput));
  }

  function formatDuration(ms) {
    if (ms == null) return "—";
    const totalMin = Math.round(ms / 60000);
    return totalMin + " min";
  }

  function relativeDayLabel(dateInput) {
    const today = istParts(Date.now());
    const then = istParts(dateInput);
    const todayUtcMidnight = Date.UTC(today.year, today.month - 1, today.day);
    const thenUtcMidnight = Date.UTC(then.year, then.month - 1, then.day);
    const diffDays = Math.round((todayUtcMidnight - thenUtcMidnight) / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays > 1) return diffDays + " days ago";
    return formatIstDateLabel(dateInput);
  }

  function buildProfiles(sessionData) {
    const byUser = {};
    sessionData.forEach((session) => {
      if (!session.user_id) return;
      if (!byUser[session.user_id]) byUser[session.user_id] = [];
      byUser[session.user_id].push(session);
    });

    return Object.entries(byUser)
      .map(([userId, list]) => {
        const started = list.map((session) => new Date(session.started_at).getTime());
        return {
          userId,
          count: list.length,
          firstSeen: Math.min(...started),
          lastSeen: Math.max(...started),
        };
      })
      .sort((a, b) => a.firstSeen - b.firstSeen || a.userId.localeCompare(b.userId))
      .map((profile, index) => ({
        ...profile,
        label: "Device " + (index + 1),
      }));
  }

  function renderProfileFilter(profiles) {
    const select = document.getElementById("profile-filter");
    select.innerHTML = "";

    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All profiles (" + sessions.length + " workouts)";
    select.appendChild(allOption);

    profiles.forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.userId;
      option.textContent = profile.label + " (" + profile.count + " workouts)";
      select.appendChild(option);
    });

    select.value = selectedUserId;
    select.disabled = profiles.length === 0;

    const selectedProfile = profiles.find((profile) => profile.userId === selectedUserId);
    document.getElementById("scope-label").textContent = selectedProfile
      ? "Showing " + selectedProfile.label + " · " + selectedProfile.count + " workouts"
      : "Showing all profiles · " + sessions.length + " workouts";

    document.getElementById("last-updated").textContent = lastUpdatedAt
      ? "Last updated " + formatIstDateLabel(lastUpdatedAt) + " " + formatIstTime(lastUpdatedAt) + " IST"
      : "";
  }

  function getVisibleSessions() {
    return selectedUserId ? sessions.filter((session) => session.user_id === selectedUserId) : sessions;
  }

  function getVisibleEvents(visibleSessions) {
    const sessionIds = new Set(visibleSessions.map((session) => session.id));
    return events.filter((event) => sessionIds.has(event.session_id));
  }

  function renderVisibleDashboard(now, profiles) {
    const visibleSessions = getVisibleSessions();
    const visibleEvents = getVisibleEvents(visibleSessions);
    renderProfileFilter(profiles);

    if (visibleSessions.length === 0) {
      setStatus(
        selectedUserId ? "No workout activity recorded for this profile." : "No workout activity recorded yet.",
        false
      );
      document.getElementById("dashboard-content").classList.add("hidden");
      return;
    }

    setStatus(null);
    document.getElementById("dashboard-content").classList.remove("hidden");
    renderSummaryCards(now, visibleSessions);
    renderWeek(now, visibleSessions);
    renderCalendar(calendarYear, calendarMonth, visibleSessions, visibleEvents);
    renderRecent(visibleSessions);
    renderDurationStats(visibleSessions);
    renderHistogram(visibleSessions);
    renderExerciseInsights(visibleEvents);
    renderDevices(profiles, selectedUserId);
  }

  function setSelectedUser(userId) {
    selectedUserId = userId;
    const profiles = buildProfiles(sessions);
    renderVisibleDashboard(istParts(Date.now()), profiles);
  }

  // ---------- Auth ----------
  function showLogin() {
    document.getElementById("login-view").classList.remove("hidden");
    document.getElementById("dashboard-view").classList.add("hidden");
  }

  function showDashboard() {
    document.getElementById("login-view").classList.add("hidden");
    document.getElementById("dashboard-view").classList.remove("hidden");
  }

  async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const errorEl = document.getElementById("login-error");
    errorEl.classList.add("hidden");
    errorEl.textContent = "";

    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      errorEl.textContent = "Sign in failed. Check your email and password.";
      errorEl.classList.remove("hidden");
      return;
    }
    showDashboard();
    loadData();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadData, REFRESH_INTERVAL_MS);
  }

  async function handleLogout() {
    if (refreshTimer) clearInterval(refreshTimer);
    await client.auth.signOut();
    selectedUserId = "";
    sessions = [];
    events = [];
    lastUpdatedAt = null;
    showLogin();
  }

  // ---------- Data loading ----------
  function setStatus(message, isError) {
    const el = document.getElementById("status-banner");
    if (!message) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.textContent = message;
    el.classList.toggle("error", !!isError);
    el.classList.remove("hidden");
  }

  async function loadData() {
    setStatus("Loading…", false);
    document.getElementById("dashboard-content").classList.add("hidden");

    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();

    try {
      const [sessionsRes, eventsRes] = await Promise.all([
        client.from("workout_sessions").select("*").gte("started_at", cutoff).order("started_at", { ascending: false }),
        client.from("exercise_events").select("*").gte("occurred_at", cutoff),
      ]);

      if (sessionsRes.error || eventsRes.error) {
        throw sessionsRes.error || eventsRes.error;
      }

      sessions = sessionsRes.data || [];
      events = eventsRes.data || [];
      const profiles = buildProfiles(sessions);

      if (selectedUserId && !profiles.some((profile) => profile.userId === selectedUserId)) {
        selectedUserId = "";
      }

      lastUpdatedAt = Date.now();

      if (sessions.length === 0) {
        setStatus("No workout activity recorded yet.", false);
        document.getElementById("dashboard-content").classList.add("hidden");
        renderProfileFilter(profiles);
        return;
      }

      const now = istParts(Date.now());
      if (calendarYear == null) {
        calendarYear = now.year;
        calendarMonth = now.month;
      }

      renderVisibleDashboard(now, profiles);
    } catch (err) {
      setStatus("Unable to load workout data. Please try again.", true);
      document.getElementById("dashboard-content").classList.add("hidden");
    }
  }

  // ---------- Summary cards ----------
  function renderSummaryCards(now, sessionData) {
    const weekStartUtcMid = mondayOfIstWeek(now);
    const inCurrentWeek = sessionData.filter((s) => {
      const d = istParts(s.started_at);
      const dUtcMid = Date.UTC(d.year, d.month - 1, d.day);
      return dUtcMid >= weekStartUtcMid && dUtcMid < weekStartUtcMid + 7 * 86400000;
    });
    const inCurrentMonth = sessionData.filter((s) => {
      const d = istParts(s.started_at);
      return d.year === now.year && d.month === now.month;
    });

    const weekCompleted = inCurrentWeek.filter((s) => s.completed).length;
    const monthCompleted = inCurrentMonth.filter((s) => s.completed).length;
    const completionRate = inCurrentMonth.length
      ? Math.round((monthCompleted / inCurrentMonth.length) * 100) + "%"
      : "—";
    const monthDurations = inCurrentMonth.filter((s) => s.completed && s.duration_ms != null).map((s) => s.duration_ms);
    const avgDuration = monthDurations.length
      ? formatDuration(monthDurations.reduce((a, b) => a + b, 0) / monthDurations.length)
      : "—";

    const cards = [
      { value: weekCompleted, label: "This Week" },
      { value: monthCompleted, label: "This Month" },
      { value: completionRate, label: "Completion Rate" },
      { value: avgDuration, label: "Avg Duration" },
    ];

    const container = document.getElementById("summary-cards");
    container.innerHTML = "";
    cards.forEach((c) => {
      const card = document.createElement("div");
      card.className = "summary-card";
      const value = document.createElement("div");
      value.className = "value";
      value.textContent = c.value;
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = c.label;
      card.appendChild(value);
      card.appendChild(label);
      container.appendChild(card);
    });
  }

  function mondayOfIstWeek(nowParts) {
    const todayUtcMid = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day);
    const dow = istDowIndex(nowParts.weekday); // 0=Sun..6=Sat
    const daysSinceMonday = (dow + 6) % 7;
    return todayUtcMid - daysSinceMonday * 86400000;
  }

  // ---------- This Week ----------
  function latestSessionForDate(sessionData, dayUtcMid) {
    return sessionData
      .filter((session) => {
        const d = istParts(session.started_at);
        return Date.UTC(d.year, d.month - 1, d.day) === dayUtcMid;
      })
      .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))[0] || null;
  }

  function renderWeek(now, sessionData) {
    const weekStart = mondayOfIstWeek(now);
    const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const container = document.getElementById("week-list");
    container.innerHTML = "";

    for (let i = 0; i < 7; i++) {
      const dayUtcMid = weekStart + i * 86400000;
      const dowIndex = (i + 1) % 7; // Monday=1 .. Sunday=0, matches WEEKLY_SCHEDULE keys
      const schedule = typeof WEEKLY_SCHEDULE !== "undefined" ? WEEKLY_SCHEDULE[dowIndex] : null;

      const match = latestSessionForDate(sessionData, dayUtcMid);

      const row = document.createElement("div");
      row.className = "week-row" + (match && match.completed ? " done" : "");

      const dayName = document.createElement("span");
      dayName.className = "day-name";
      dayName.textContent = dayNames[i];
      row.appendChild(dayName);

      const workoutName = document.createElement("span");
      workoutName.className = "workout-name";
      if (schedule && schedule.rest) {
        workoutName.textContent = "Rest";
      } else if (match && match.completed) {
        workoutName.textContent = match.name_en || match.name_hi;
      } else {
        const label = schedule ? schedule.nameEn || schedule.nameHi : "";
        workoutName.textContent = "— " + label;
      }
      row.appendChild(workoutName);

      const duration = document.createElement("span");
      duration.className = "duration";
      duration.textContent = match && match.completed ? formatDuration(match.duration_ms) : "";
      row.appendChild(duration);

      container.appendChild(row);
    }
  }

  // ---------- Calendar ----------
  function renderCalendar(year, month, sessionData, eventData) {
    document.getElementById("calendar-title").textContent = new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
    }).format(new Date(Date.UTC(year, month - 1, 1)));

    const container = document.getElementById("calendar");
    container.innerHTML = "";

    ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].forEach((d) => {
      const el = document.createElement("div");
      el.className = "cal-dow";
      el.textContent = d;
      container.appendChild(el);
    });

    const firstOfMonthUtc = Date.UTC(year, month - 1, 1);
    const firstWeekday = new Date(firstOfMonthUtc).getUTCDay(); // 0=Sun..6=Sat
    const leadingBlanks = (firstWeekday + 6) % 7; // convert to Monday-first
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const today = istParts(Date.now());

    const byDate = {};
    sessionData.forEach((s) => {
      const d = istParts(s.started_at);
      if (d.year === year && d.month === month) {
        const existing = byDate[d.day];
        if (!existing || new Date(s.started_at) > new Date(existing.started_at)) {
          byDate[d.day] = s;
        }
      }
    });

    for (let i = 0; i < leadingBlanks; i++) {
      const el = document.createElement("div");
      el.className = "cal-day empty";
      container.appendChild(el);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const el = document.createElement("div");
      const session = byDate[day];
      let cls = "cal-day";
      if (session) cls += session.completed ? " completed" : " abandoned";
      if (today.year === year && today.month === month && today.day === day) cls += " today";
      el.className = cls;
      el.textContent = String(day);
      if (session) {
        el.setAttribute("role", "button");
        el.setAttribute("tabindex", "0");
        el.setAttribute("aria-label", "View workout details for day " + day);
        el.addEventListener("click", () => renderDayDetail(session, eventData));
        el.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            renderDayDetail(session, eventData);
          }
        });
      }
      container.appendChild(el);
    }
  }

  function renderDayDetail(session, eventData) {
    const el = document.getElementById("day-detail");
    const completeCount = eventData.filter((e) => e.session_id === session.id && e.event_type === "complete").length;

    el.innerHTML = "";
    const dl = document.createElement("dl");
    const rows = [
      ["Workout", session.name_en || session.name_hi],
      ["Start", formatIstDateLabel(session.started_at) + " " + formatIstTime(session.started_at)],
      ["Finish", session.completed_at ? formatIstTime(session.completed_at) : "—"],
      ["Duration", formatDuration(session.duration_ms)],
      ["Status", session.completed ? "Completed" : session.abandoned_at ? "Abandoned" : "Incomplete"],
      ["Exercises completed", completeCount + " / " + session.total_exercises],
    ];
    rows.forEach(([label, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    el.appendChild(dl);
    el.classList.remove("hidden");
  }

  function changeMonth(delta) {
    calendarMonth += delta;
    if (calendarMonth < 1) {
      calendarMonth = 12;
      calendarYear -= 1;
    } else if (calendarMonth > 12) {
      calendarMonth = 1;
      calendarYear += 1;
    }
    document.getElementById("day-detail").classList.add("hidden");
    const visibleSessions = getVisibleSessions();
    renderCalendar(calendarYear, calendarMonth, visibleSessions, getVisibleEvents(visibleSessions));
  }

  // ---------- Recent workouts ----------
  function renderRecent(sessionData) {
    const container = document.getElementById("recent-list");
    container.innerHTML = "";
    sessionData.slice(0, 10).forEach((s) => {
      const row = document.createElement("div");
      row.className = "recent-row";

      const date = document.createElement("span");
      date.textContent = formatIstDateLabel(s.started_at);
      const name = document.createElement("span");
      name.textContent = s.name_en || s.name_hi;
      const start = document.createElement("span");
      start.textContent = formatIstTime(s.started_at);
      const duration = document.createElement("span");
      duration.textContent = s.completed ? formatDuration(s.duration_ms) : "—";
      const status = document.createElement("span");
      status.className = "status " + (s.completed ? "ok" : "abandoned");
      status.textContent = s.completed ? "✓" : s.abandoned_at ? "!" : "…";

      row.appendChild(date);
      row.appendChild(name);
      row.appendChild(start);
      row.appendChild(duration);
      row.appendChild(status);
      container.appendChild(row);
    });
  }

  // ---------- Duration stats ----------
  function renderDurationStats(sessionData) {
    const durations = sessionData.filter((s) => s.completed && s.duration_ms != null).map((s) => s.duration_ms);
    const container = document.getElementById("duration-stats");
    container.innerHTML = "";

    if (durations.length === 0) {
      const note = document.createElement("p");
      note.className = "empty-note";
      note.textContent = "No completed workouts yet.";
      container.appendChild(note);
      return;
    }

    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    const min = Math.min(...durations);
    const max = Math.max(...durations);

    [
      ["Average", formatDuration(avg)],
      ["Shortest", formatDuration(min)],
      ["Longest", formatDuration(max)],
    ].forEach(([label, value]) => {
      const stat = document.createElement("div");
      stat.className = "stat";
      const v = document.createElement("div");
      v.className = "value";
      v.textContent = value;
      const l = document.createElement("div");
      l.className = "label";
      l.textContent = label;
      stat.appendChild(v);
      stat.appendChild(l);
      container.appendChild(stat);
    });
  }

  // ---------- Workout time histogram ----------
  function renderHistogram(sessionData) {
    const counts = {};
    sessionData.forEach((s) => {
      const hour = istParts(s.started_at).hour;
      counts[hour] = (counts[hour] || 0) + 1;
    });

    const container = document.getElementById("time-histogram");
    container.innerHTML = "";

    const hours = Object.keys(counts).map(Number).sort((a, b) => a - b);
    if (hours.length === 0) {
      const note = document.createElement("p");
      note.className = "empty-note";
      note.textContent = "Not enough data yet.";
      container.appendChild(note);
      return;
    }

    const maxCount = Math.max(...hours.map((h) => counts[h]));
    hours.forEach((h) => {
      const row = document.createElement("div");
      row.className = "hist-row";

      const label = document.createElement("span");
      label.textContent = String(h).padStart(2, "0") + ":00–" + String((h + 1) % 24).padStart(2, "0") + ":00";

      const track = document.createElement("div");
      track.className = "hist-bar-track";
      const bar = document.createElement("div");
      bar.className = "hist-bar";
      bar.style.width = Math.round((counts[h] / maxCount) * 100) + "%";
      track.appendChild(bar);

      const count = document.createElement("span");
      count.textContent = String(counts[h]);

      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(count);
      container.appendChild(row);
    });
  }

  // ---------- Exercise insights ----------
  function exerciseLabel(exerciseId) {
    const ex = EX_MAP[exerciseId];
    return ex ? ex.titleHi : exerciseId;
  }

  function renderExerciseInsights(eventData) {
    const skipCounts = {};
    const completeDurations = {};

    eventData.forEach((e) => {
      if (e.event_type === "skip") {
        skipCounts[e.exercise_id] = (skipCounts[e.exercise_id] || 0) + 1;
      } else if (e.event_type === "complete" && e.time_spent_ms != null) {
        if (!completeDurations[e.exercise_id]) completeDurations[e.exercise_id] = [];
        completeDurations[e.exercise_id].push(e.time_spent_ms);
      }
    });

    const topSkipped = Object.entries(skipCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const topLongest = Object.entries(completeDurations)
      .map(([id, arr]) => [id, arr.reduce((a, b) => a + b, 0) / arr.length])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    renderInsightList("skipped-list", topSkipped, (v) => v + "×");
    renderInsightList("longest-list", topLongest, (v) => formatDuration(v));
  }

  function renderInsightList(containerId, entries, formatValue) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    if (entries.length === 0) {
      const note = document.createElement("p");
      note.className = "empty-note";
      note.textContent = "Not enough data yet.";
      container.appendChild(note);
      return;
    }
    entries.forEach(([exerciseId, value]) => {
      const row = document.createElement("div");
      row.className = "insight-row";
      const name = document.createElement("span");
      name.textContent = exerciseLabel(exerciseId);
      const metric = document.createElement("span");
      metric.className = "metric";
      metric.textContent = formatValue(value);
      row.appendChild(name);
      row.appendChild(metric);
      container.appendChild(row);
    });
  }

  // ---------- Devices ----------
  function renderDevices(profiles, activeUserId) {
    const container = document.getElementById("device-list");
    container.innerHTML = "";
    profiles.forEach((profile) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "device-card" + (profile.userId === activeUserId ? " selected" : "");
      card.setAttribute("aria-pressed", String(profile.userId === activeUserId));
      card.addEventListener("click", () => setSelectedUser(profile.userId));
      const name = document.createElement("div");
      name.className = "device-name";
      name.textContent = profile.label;
      const meta = document.createElement("div");
      meta.className = "device-meta";
      meta.textContent = profile.count + " workouts · Last active: " + relativeDayLabel(profile.lastSeen);
      card.appendChild(name);
      card.appendChild(meta);
      container.appendChild(card);
    });
  }

  // ---------- Init ----------
  function init() {
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "workoutDashboard:supabaseAuth" },
    });

    document.getElementById("login-form").addEventListener("submit", handleLogin);
    document.getElementById("logout-btn").addEventListener("click", handleLogout);
    document.getElementById("refresh-btn").addEventListener("click", loadData);
    document.getElementById("profile-filter").addEventListener("change", (event) => {
      setSelectedUser(event.target.value);
    });
    document.getElementById("cal-prev").addEventListener("click", () => changeMonth(-1));
    document.getElementById("cal-next").addEventListener("click", () => changeMonth(1));

    client.auth.getSession().then(({ data }) => {
      if (data.session) {
        showDashboard();
        loadData();
        refreshTimer = setInterval(loadData, REFRESH_INTERVAL_MS);
      } else {
        showLogin();
      }
    });
  }

  init();
})();
