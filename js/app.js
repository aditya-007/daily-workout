// app.js — bootstraps the app and holds the small in-memory workout state
// machine (which day/exercise is currently shown, when the workout started).
// Persisted data lives in storage.js; DOM building lives in render.js.

const App = (() => {
  let currentDaySchedule = null;
  let currentIndex = 0;
  let workoutStartedAt = null;

  function showView(viewId) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById(viewId).classList.add("active");
  }

  /** Begin a workout for the given day-of-week (0=Sun..6=Sat). */
  function startWorkout(dow) {
    const schedule = WEEKLY_SCHEDULE[dow];
    if (!schedule || schedule.rest || schedule.exerciseIds.length === 0) return;

    currentDaySchedule = schedule;
    currentIndex = 0;
    workoutStartedAt = Date.now();
    renderExercise(currentDaySchedule, currentIndex);
    showView("view-workout");
  }

  function goPrev() {
    if (currentIndex > 0) {
      currentIndex -= 1;
      renderExercise(currentDaySchedule, currentIndex);
    }
  }

  function goNext() {
    if (currentIndex < currentDaySchedule.exerciseIds.length - 1) {
      currentIndex += 1;
      renderExercise(currentDaySchedule, currentIndex);
    }
  }

  /** Mark Complete: flags progress and auto-advances to the next exercise,
   * or finishes the workout if this was the last one. */
  function markComplete() {
    const isLast = currentIndex === currentDaySchedule.exerciseIds.length - 1;
    if (isLast) {
      finishWorkout();
    } else {
      currentIndex += 1;
      renderExercise(currentDaySchedule, currentIndex);
    }
  }

  function finishWorkout() {
    const durationMs = Date.now() - workoutStartedAt;
    markWorkoutComplete(
      currentDaySchedule.dayKey,
      currentDaySchedule.nameHi,
      currentDaySchedule.nameEn,
      durationMs
    );
    renderComplete(durationMs);
    showView("view-complete");
  }

  function goHome() {
    renderHome();
    showView("view-home");
  }

  function init() {
    initVideoModal();
    document.getElementById("btn-prev").addEventListener("click", goPrev);
    document.getElementById("btn-next").addEventListener("click", goNext);
    document.getElementById("btn-complete").addEventListener("click", markComplete);
    document.getElementById("btn-home-from-workout").addEventListener("click", goHome);
    document.getElementById("btn-home").addEventListener("click", goHome);
    renderHome();
  }

  return { init, startWorkout, goHome };
})();

window.App = App;
document.addEventListener("DOMContentLoaded", () => App.init());
