// video.js — tap-to-fullscreen viewer for the exercise videos.
//
// Tapping either the front or side video opens a fullscreen overlay showing
// that same video large, still looping/muted, with a big "वापस जाएँ" (Back)
// button that returns to the normal exercise layout. Only one modal <video>
// element is reused so an older phone never has to decode more than two
// videos (the two thumbnails) plus one modal video at a time.

function openVideoFullscreen(sourceVideoEl) {
  const modal = document.getElementById("video-modal");
  const modalVideo = document.getElementById("video-modal-player");
  modalVideo.src = sourceVideoEl.currentSrc || sourceVideoEl.src;
  modal.classList.remove("hidden");
  modalVideo.play().catch(() => {
    // Autoplay can be blocked in rare cases; the video still has controls
    // via user tap on the (now enlarged) element itself.
  });
}

function closeVideoFullscreen() {
  const modal = document.getElementById("video-modal");
  const modalVideo = document.getElementById("video-modal-player");
  modalVideo.pause();
  modalVideo.removeAttribute("src");
  modalVideo.load();
  modal.classList.add("hidden");
}

function initVideoModal() {
  document.getElementById("video-modal-back").addEventListener("click", closeVideoFullscreen);
  document.getElementById("video-front").addEventListener("click", (e) => openVideoFullscreen(e.currentTarget));
  document.getElementById("video-side").addEventListener("click", (e) => openVideoFullscreen(e.currentTarget));
}
