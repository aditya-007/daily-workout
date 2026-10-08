// render.js — builds/updates the DOM for the three views (home, workout,
// complete). These functions read from the global EXERCISES / WEEKLY_SCHEDULE
// data and the storage.js helpers; state mutation (which day/exercise is
// "current") lives in app.js.

/** Fast lookup: exercise id -> exercise object. */
// Override: change any exercise that currently has 2 sets to 3 sets
// so the app shows 3 sets per exercise without regenerating data files.
if (typeof EXERCISES !== "undefined") {
  EXERCISES.forEach((ex) => {
    if (typeof ex.sets !== "undefined" && ex.sets === 2) ex.sets = 3;
  });
}
const EXERCISES_BY_ID = Object.fromEntries(EXERCISES.map((ex) => [ex.id, ex]));

/** Order to display the weekly list in, Monday first. */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const DAY_LABELS_HI = {
  0: "रविवार",
  1: "सोमवार",
  2: "मंगलवार",
  3: "बुधवार",
  4: "गुरुवार",
  5: "शुक्रवार",
  6: "शनिवार",
};

const ENCOURAGEMENTS_HI = [
  "बहुत बढ़िया! आपने आज कमाल कर दिया।",
  "शानदार मेहनत! अपने आप को शाबाशी दें।",
  "वाह! आपकी सेहत के लिए यह एक और कदम है।",
  "बहुत खूब! कल फिर मिलते हैं।",
];

/** Rough per-exercise time in seconds, used only to estimate the total
 * workout duration shown on the home screen. Seniors move at a gentle
 * pace: ~6s per rep, 30s rest between sets, 45s to read instructions and
 * get positioned for the next exercise. */
function estimateExerciseSeconds(ex) {
  const REST_BETWEEN_SETS = 30;
  const TRANSITION = 45;
  if (ex.holdSeconds) {
    return ex.sets * (ex.holdSeconds + REST_BETWEEN_SETS) + TRANSITION;
  }
  return ex.sets * (ex.reps * 6 + REST_BETWEEN_SETS) + TRANSITION;
}

function estimateWorkoutMinutes(exerciseIds) {
  const totalSeconds = exerciseIds
    .map((id) => EXERCISES_BY_ID[id])
    .filter(Boolean)
    .reduce((sum, ex) => sum + estimateExerciseSeconds(ex), 0);
  return Math.max(1, Math.round(totalSeconds / 60));
}

function formatRepsOrHold(ex) {
  if (ex.holdSeconds) {
    return `${ex.holdSeconds} सेकंड × ${ex.sets} सेट`;
  }
  return `${ex.reps} बार × ${ex.sets} सेट`;
}

function getGreetingHi() {
  const hour = new Date().getHours();
  if (hour < 12) return "सुप्रभात";
  if (hour < 17) return "नमस्ते";
  return "शुभ संध्या";
}

function renderProgressLoading() {
  document.getElementById("progress-week").textContent = "...";
  document.getElementById("progress-month").textContent = "...";
  document.getElementById("progress-total").textContent = "...";
  document.getElementById("progress-minutes").textContent = "...";
  document.getElementById("progress-last-name").textContent = "लोड हो रहा है...";
  document.getElementById("progress-last-meta").textContent = "";
  document.getElementById("progress-status").textContent = "";
}

function renderProgressUnavailable() {
  document.getElementById("progress-week").textContent = "—";
  document.getElementById("progress-month").textContent = "—";
  document.getElementById("progress-total").textContent = "—";
  document.getElementById("progress-minutes").textContent = "—";
  document.getElementById("progress-last-name").textContent = "प्रगति अभी उपलब्ध नहीं है";
  document.getElementById("progress-last-meta").textContent = "वर्कआउट फिर भी शुरू कर सकते हैं";
  document.getElementById("progress-status").textContent = "प्रगति बाद में सिंक होगी";
}

function renderProgressMetrics(metrics) {
  document.getElementById("progress-week").textContent = `${metrics.weekCompleted} / ${metrics.weekScheduled}`;
  document.getElementById("progress-month").textContent = `${metrics.monthCompleted} / ${metrics.monthScheduled}`;
  document.getElementById("progress-total").textContent = String(metrics.totalCompleted);
  document.getElementById("progress-minutes").textContent = String(metrics.monthMinutes);

  if (metrics.lastWorkout) {
    document.getElementById("progress-last-name").textContent = metrics.lastWorkout.name;
    document.getElementById("progress-last-meta").textContent = [
      metrics.lastWorkout.date,
      metrics.lastWorkout.duration,
    ].filter(Boolean).join(" • ");
  } else {
    document.getElementById("progress-last-name").textContent = "अभी कोई पूरा वर्कआउट नहीं";
    document.getElementById("progress-last-meta").textContent = "आज से शुरुआत करें";
  }
  document.getElementById("progress-status").textContent = "";
}

function refreshProgress() {
  renderProgressLoading();
  if (!window.Progress) {
    renderProgressUnavailable();
    return;
  }
  window.Progress.load()
    .then((result) => {
      if (result.status === "ready") {
        renderProgressMetrics(result.metrics);
      } else {
        renderProgressUnavailable();
      }
    })
    .catch(() => renderProgressUnavailable());
}

window.WorkoutProgressUI = {
  refresh: refreshProgress,
};

/** Monday 00:00 of the week containing `date`. */
function mostRecentMonday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Render the home screen: greeting, streak, today's workout card, and the
 * tappable weekly list with today highlighted + green checks for done days. */
function renderHome() {
  const state = loadState();
  const today = new Date();
  const todayDow = today.getDay();
  const todaySchedule = WEEKLY_SCHEDULE[todayDow];

  document.getElementById("greeting").textContent = getGreetingHi();

  const streakLine = document.getElementById("streak-line");
  if (state.streak > 1) {
    streakLine.textContent = `🔥लगातार ${state.streak} दिन का वर्कआउट   अपनी स्ट्रीक बनाए रखें!`;
    streakLine.classList.remove("hidden");
  } else {
    streakLine.classList.add("hidden");
  }

  const card = document.getElementById("today-card");
  const startBtn = document.getElementById("start-workout-btn");

  if (todaySchedule.rest) {
    card.innerHTML = `
      <p class="today-label">आज का दिन</p>
      <h2 class="today-name">आराम का दिन</h2>
      <p class="today-sub">आज आराम करें और कल फिर से मिलें।</p>
    `;
    startBtn.classList.add("hidden");
    startBtn.onclick = null;
  } else {
    const minutes = estimateWorkoutMinutes(todaySchedule.exerciseIds);
    const count = todaySchedule.exerciseIds.length;
    card.innerHTML = `
      <p class="today-label">आज का वर्कआउट</p>
      <h2 class="today-name">${todaySchedule.nameHi}</h2>
      <p class="today-sub">लगभग ${minutes} मिनट • ${count} व्यायाम</p>
    `;
    startBtn.classList.remove("hidden");
    startBtn.onclick = () => window.App.startWorkout(todayDow);
  }

  renderWeeklyList(state, todayDow);
  if (window.WorkoutProgressUI) window.WorkoutProgressUI.refresh();
}

function renderWeeklyList(state, todayDow) {
  const list = document.getElementById("weekly-list");
  list.innerHTML = "";

  const monday = mostRecentMonday(new Date());

  WEEKDAY_ORDER.forEach((dow) => {
    const entry = WEEKLY_SCHEDULE[dow];
    const isToday = dow === todayDow;
    const done = isDayKeyCompletedThisWeek(state, entry.dayKey, monday);

    const item = document.createElement("button");
    item.type = "button";
    item.className = "day-row" + (isToday ? " day-row--today" : "");
    item.innerHTML = `
      <span class="day-row__name">${DAY_LABELS_HI[dow]}</span>
      <span class="day-row__workout">${entry.rest ? "आराम" : entry.nameHi}</span>
      ${done ? '<span class="day-row__check" aria-label="पूरा हुआ">✔</span>' : ""}
    `;
    if (!entry.rest) {
      item.addEventListener("click", () => window.App.startWorkout(dow));
    } else {
      item.disabled = true;
    }
    list.appendChild(item);
  });
}

/** Render a single exercise inside the workout view. */
function renderExercise(daySchedule, index) {
  const exId = daySchedule.exerciseIds[index];
  const ex = EXERCISES_BY_ID[exId];
  const total = daySchedule.exerciseIds.length;

  document.getElementById("exercise-progress").textContent = `व्यायाम ${index + 1} / ${total}`;
  document.getElementById("exercise-title").textContent = ex.titleHi;
  document.getElementById("exercise-meta").textContent = formatRepsOrHold(ex);

  const videoFront = document.getElementById("video-front");
  const videoSide = document.getElementById("video-side");
  videoFront.src = ex.videoFront;
  videoSide.src = ex.videoSide;
  videoFront.load();
  videoSide.load();

  const list = document.getElementById("instructions-list");
  list.innerHTML = "";
  ex.instructionsHi.forEach((step) => {
    const li = document.createElement("li");
    li.textContent = step;
    list.appendChild(li);
  });

  document.getElementById("btn-prev").disabled = index === 0;

  const isLast = index === total - 1;
  document.getElementById("btn-next").disabled = isLast;
  document.getElementById("btn-complete").textContent = isLast ? "वर्कआउट पूरा करें" : "पूरा हुआ";
}

/** Render the workout-complete celebration screen. */
function renderComplete(durationMs) {
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.round((durationMs % 60000) / 1000);
  document.getElementById("complete-time").textContent = `${minutes} मिनट ${seconds} सेकंड`;
  const message = ENCOURAGEMENTS_HI[Math.floor(Math.random() * ENCOURAGEMENTS_HI.length)];
  document.getElementById("complete-message").textContent = message;
}
