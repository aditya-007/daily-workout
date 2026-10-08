// Browser-scoped homepage progress loaded through the authenticated user's RLS scope.
(function () {
  const LOOKBACK_DAYS = 400;
  const REQUEST_TIMEOUT_MS = 6000;
  let inFlight = null;

  function startOfDay(date) {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    return value;
  }

  function dateKey(dateInput) {
    const date = new Date(dateInput);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function dateFromKey(key) {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function mondayOfWeek(date) {
    const monday = startOfDay(date);
    const daysSinceMonday = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - daysSinceMonday);
    return monday;
  }

  function scheduledDateKeys(startDate, endDate) {
    const keys = [];
    const cursor = startOfDay(startDate);
    const end = startOfDay(endDate);

    while (cursor <= end) {
      const schedule = WEEKLY_SCHEDULE[cursor.getDay()];
      if (schedule && !schedule.rest) keys.push(dateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return keys;
  }

  function latestSessionPerDate(sessions) {
    const latest = new Map();
    sessions.forEach((session) => {
      const key = dateKey(session.started_at);
      const existing = latest.get(key);
      if (!existing || new Date(session.started_at) > new Date(existing.started_at)) {
        latest.set(key, session);
      }
    });
    return [...latest.values()].sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  }

  function relativeDateLabel(dateInput, today) {
    const currentKey = dateKey(today);
    const workoutKey = dateKey(dateInput);
    const current = dateFromKey(currentKey);
    const workout = dateFromKey(workoutKey);
    const difference = Math.round((current - workout) / 86400000);
    if (difference === 0) return "आज";
    if (difference === 1) return "कल";
    return new Intl.DateTimeFormat("hi-IN", { day: "numeric", month: "short" }).format(workout);
  }

  function formatDuration(durationMs) {
    if (durationMs == null) return "";
    return Math.max(0, Math.round(Number(durationMs) / 60000)) + " मिनट";
  }

  function buildMetrics(rows, totalCompleted) {
    const today = startOfDay(new Date());
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const weekStart = mondayOfWeek(today);
    const uniqueSessions = latestSessionPerDate(rows);
    const completedDates = new Set(uniqueSessions.map((session) => dateKey(session.started_at)));
    const weekDates = scheduledDateKeys(weekStart, today);
    const monthDates = scheduledDateKeys(currentMonthStart, today);
    const monthStartKey = dateKey(currentMonthStart);

    const monthSessions = uniqueSessions.filter((session) => {
      const key = dateKey(session.started_at);
      return key >= monthStartKey && key <= dateKey(today);
    });
    const monthMinutes = monthSessions.reduce(
      (total, session) => total + (Number(session.duration_ms) || 0),
      0
    );
    const lastWorkout = uniqueSessions[0] || null;

    return {
      weekCompleted: weekDates.filter((key) => completedDates.has(key)).length,
      weekScheduled: weekDates.length,
      monthCompleted: monthDates.filter((key) => completedDates.has(key)).length,
      monthScheduled: monthDates.length,
      totalCompleted,
      monthMinutes: Math.max(0, Math.round(monthMinutes / 60000)),
      lastWorkout: lastWorkout
        ? {
            name: lastWorkout.name_hi || lastWorkout.name_en || "वर्कआउट",
            date: relativeDateLabel(lastWorkout.started_at, today),
            duration: formatDuration(lastWorkout.duration_ms),
          }
        : null,
    };
  }

  async function load() {
    if (inFlight) return inFlight;

    const request = (async () => {
      try {
        const client = await window.WorkoutAuth.getAuthenticatedClient();
        const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
        const recentQuery = client
          .from("workout_sessions")
          .select("day_key, name_hi, name_en, started_at, duration_ms, completed")
          .eq("completed", true)
          .gte("started_at", cutoff)
          .order("started_at", { ascending: false })
          .limit(400);
        const totalQuery = client
          .from("workout_sessions")
          .select("id", { count: "exact", head: true })
          .eq("completed", true);
        const [recentResult, totalResult] = await Promise.all([recentQuery, totalQuery]);

        if (recentResult.error) throw recentResult.error;
        if (totalResult.error) throw totalResult.error;
        if (typeof totalResult.count !== "number") throw new Error("Completed workout count was unavailable.");
        return { status: "ready", metrics: buildMetrics(recentResult.data || [], totalResult.count) };
      } catch (error) {
        return { status: "unavailable", metrics: null };
      }
    })();

    inFlight = Promise.race([
      request,
      new Promise((resolve) => {
        setTimeout(() => resolve({ status: "unavailable", metrics: null }), REQUEST_TIMEOUT_MS);
      }),
    ])
      .catch(() => ({ status: "unavailable", metrics: null }))
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  window.Progress = { load };
})();
