(() => {
  if (globalThis.__loopInYoutubeContentLoaded) return;
  globalThis.__loopInYoutubeContentLoaded = true;

  let mode = "off";
  let sections = [];
  let activeVideo = null;
  let lastJumpAt = 0;

  function getVideo() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }

  function snapshot() {
    const video = getVideo();
    return {
      supported: Boolean(video),
      looping: mode !== "off",
      mode,
      sections: sections.map((section) => ({ ...section })),
      currentTime: video?.currentTime ?? 0,
      duration: Number.isFinite(video?.duration) ? video.duration : 0,
      paused: video?.paused ?? true,
    };
  }

  function applyMode() {
    const video = getVideo();
    if (!video) return false;

    if (activeVideo !== video) {
      activeVideo = video;
      video.addEventListener("ended", handleEnded);
    }
    // Native whole-video looping and our A–B section loop are mutually exclusive.
    video.loop = mode === "video";
    return true;
  }

  function handleEnded() {
    if (mode !== "sections" || !sections.length || !activeVideo) return;
    lastJumpAt = Date.now();
    activeVideo.currentTime = sections[0].start;
    void activeVideo.play().catch(() => {});
  }

  function handleTimeUpdate() {
    if (mode !== "sections" || sections.length === 0) return;
    const video = getVideo();
    if (!video || video.paused || video.seeking || Date.now() - lastJumpAt < 250) return;

    const index = sections.findIndex((section) => video.currentTime >= section.start && video.currentTime < section.end);
    if (index === -1) {
      lastJumpAt = Date.now();
      video.currentTime = sections[0].start;
      return;
    }

    const section = sections[index];
    if (video.currentTime >= section.end - 0.08) {
      const next = sections[(index + 1) % sections.length];
      lastJumpAt = Date.now();
      video.currentTime = next.start;
    }
  }

  document.addEventListener("timeupdate", handleTimeUpdate, true);

  const observer = new MutationObserver(() => {
    if (mode !== "off") applyMode();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("yt-navigate-finish", () => {
    activeVideo = null;
    mode = "off";
    sections = [];
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "LOOP_STATUS") {
      sendResponse(snapshot());
      return;
    }

    if (message?.type === "SET_LOOP") {
      mode = message.enabled ? (message.mode || "video") : "off";
      if (mode === "sections" && sections.length) {
        const video = getVideo();
        if (video) video.currentTime = sections[0].start;
      }
      applyMode();
      sendResponse(snapshot());
      return;
    }

    if (message?.type === "ADD_SECTION") {
      const video = getVideo();
      const start = Number(message.start);
      const end = Number(message.end);
      if (!video || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > video.duration) {
        sendResponse({ ...snapshot(), error: "Choose a valid start and end within the video." });
        return;
      }
      if (sections.some((section) => start < section.end && end > section.start)) {
        sendResponse({ ...snapshot(), error: "Sections can’t overlap. Adjust the times or remove the other section." });
        return;
      }

      sections.push({ start, end });
      sections.sort((a, b) => a.start - b.start);
      mode = "sections";
      applyMode();
      video.currentTime = sections[0].start;
      sendResponse(snapshot());
      return;
    }

    if (message?.type === "REMOVE_SECTION") {
      sections.splice(message.index, 1);
      if (!sections.length && mode === "sections") mode = "off";
      applyMode();
      sendResponse(snapshot());
    }
  });
})();
