// Invisible telemetry: anonymous session/exercise event tracking, wired to the existing workout state machine in app.js.
// Never blocks or breaks the workout UI — every call is fire-and-forget and fails silently if Supabase is unreachable.
(function () {
  const FUNCTION_URL = SUPABASE_URL + "/functions/v1/telemetry";
  const QUEUE_KEY = "workoutApp:telemetryQueue:v1";
  const MAX_QUEUE = 200;

  let client = null;
  let accessToken = null;
  let currentSessionId = null;
  let currentExerciseStartedAt = null;

  function safeUUID() {
    try {
      return crypto.randomUUID();
    } catch (err) {
      return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    }
  }

  function readQueue() {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      return [];
    }
  }

  function writeQueue(queue) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
    } catch (err) {
      // Best-effort only — a full/blocked localStorage must never affect the workout UI.
    }
  }

  function enqueue(body) {
    const queue = readQueue();
    queue.push(body);
    writeQueue(queue);
  }

  async function send(body, useKeepalive) {
    if (!accessToken) {
      enqueue(body);
      return;
    }
    try {
      const resp = await fetch(FUNCTION_URL, {
        method: "POST",
        keepalive: !!useKeepalive,
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: "Bearer " + accessToken,
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) enqueue(body);
    } catch (err) {
      enqueue(body);
    }
  }

  async function flushQueue() {
    if (!accessToken) return;
    const queue = readQueue();
    if (queue.length === 0) return;
    writeQueue([]);
    for (const body of queue) {
      await send(body, false);
    }
  }

  async function init() {
    try {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: "workoutApp:supabaseAuth" },
      });

      let session = (await client.auth.getSession()).data.session;
      if (!session) {
        session = (await client.auth.signInAnonymously()).data.session;
      }
      accessToken = session ? session.access_token : null;

      client.auth.onAuthStateChange((_event, nextSession) => {
        accessToken = nextSession ? nextSession.access_token : null;
      });

      flushQueue();
      window.addEventListener("online", flushQueue);
    } catch (err) {
      // Analytics must never break the workout experience.
    }
  }

  function trackWorkoutStart(daySchedule) {
    currentSessionId = safeUUID();
    send({
      type: "session_start",
      sessionId: currentSessionId,
      dayKey: daySchedule.dayKey,
      nameHi: daySchedule.nameHi,
      nameEn: daySchedule.nameEn,
      totalExercises: daySchedule.exerciseIds.length,
    });
  }

  function trackExerciseView(exerciseId, sequenceIndex) {
    currentExerciseStartedAt = Date.now();
    if (!currentSessionId) return;
    send({
      type: "exercise_event",
      eventId: safeUUID(),
      sessionId: currentSessionId,
      exerciseId: exerciseId,
      sequenceIndex: sequenceIndex,
      eventType: "view",
    });
  }

  function trackExerciseOutcome(exerciseId, sequenceIndex, eventType) {
    if (!currentSessionId) return;
    const timeSpentMs = currentExerciseStartedAt ? Date.now() - currentExerciseStartedAt : null;
    send({
      type: "exercise_event",
      eventId: safeUUID(),
      sessionId: currentSessionId,
      exerciseId: exerciseId,
      sequenceIndex: sequenceIndex,
      eventType: eventType,
      timeSpentMs: timeSpentMs,
    });
  }

  function trackWorkoutComplete(durationMs) {
    if (!currentSessionId) return;
    send({ type: "session_complete", sessionId: currentSessionId, durationMs: durationMs });
  }

  function trackWorkoutAbandon() {
    if (!currentSessionId) return;
    send({ type: "session_abandon", sessionId: currentSessionId }, true);
  }

  // Backgrounding/closing the tab is the reliable mobile signal — more robust than beforeunload/unload.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") trackWorkoutAbandon();
  });

  window.Telemetry = {
    trackWorkoutStart: trackWorkoutStart,
    trackExerciseView: trackExerciseView,
    trackExerciseOutcome: trackExerciseOutcome,
    trackWorkoutComplete: trackWorkoutComplete,
    trackWorkoutAbandon: trackWorkoutAbandon,
  };

  init();
})();
