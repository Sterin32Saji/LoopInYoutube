const toggle = document.querySelector("#toggle");
const status = document.querySelector("#status");
const tabs = [...document.querySelectorAll(".mode-tab")];
const sectionTools = document.querySelector("#section-tools");
const sectionList = document.querySelector("#section-list");
const sectionCount = document.querySelector("#section-count");
const message = document.querySelector("#section-message");
let selectedMode = "video";
let videoInfo = null;

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function parseTime(value) {
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return NaN;
  const values = parts.map(Number);
  if (values.at(-1) > 59 || (values.length === 3 && values[1] > 59)) return NaN;
  return values.length === 3 ? values[0] * 3600 + values[1] * 60 + values[2] : values[0] * 60 + values[1];
}

function renderSections(sections = []) {
  sectionList.replaceChildren();
  sectionCount.textContent = String(sections.length);
  sections.forEach((section, index) => {
    const row = document.createElement("div");
    row.className = "section-row";
    const number = document.createElement("span");
    number.className = "section-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const times = document.createElement("span");
    times.className = "section-times";
    times.textContent = `${formatTime(section.start)} – ${formatTime(section.end)}`;
    const duration = document.createElement("span");
    duration.className = "section-duration";
    duration.textContent = formatTime(section.end - section.start);
    const remove = document.createElement("button");
    remove.className = "remove-section";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove section ${index + 1}`);
    remove.addEventListener("click", () => send({ type: "REMOVE_SECTION", index }));
    row.append(number, times, duration, remove);
    sectionList.append(row);
  });
}

function render(reply) {
  if (!reply?.supported) {
    toggle.disabled = true;
    toggle.setAttribute("aria-checked", "false");
    status.textContent = "Open a YouTube video to set up a loop.";
    status.classList.add("error");
    tabs.forEach((tab) => { tab.disabled = true; });
    return;
  }

  videoInfo = reply;
  toggle.disabled = false;
  tabs.forEach((tab) => { tab.disabled = false; });
  if (reply.mode) selectedMode = reply.mode === "off" ? selectedMode : reply.mode;
  toggle.setAttribute("aria-checked", String(reply.looping));
  document.querySelector("#mode-title").textContent = selectedMode === "video" ? "Whole video" : "Loop sections";
  document.querySelector("#mode-description").textContent = selectedMode === "video"
    ? "Start the video again whenever it finishes."
    : "Play your saved parts in order, then start over.";
  sectionTools.hidden = selectedMode !== "sections";
  tabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.mode === selectedMode)));
  renderSections(reply.sections);
  status.textContent = reply.mode === "off"
    ? "Loop is off. Pick a mode and switch it on when you’re ready."
    : reply.mode === "video"
      ? "The whole video will start again automatically."
      : reply.sections.length
        ? `Playing ${reply.sections.length} saved ${reply.sections.length === 1 ? "section" : "sections"} on repeat.`
        : "Add a section to start repeating a part of the video.";
  status.classList.remove("error");
}

function isYouTubeUrl(url = "") {
  return /^https:\/\/(www\.|music\.)?youtube\.com\//.test(url);
}

function send(payload, onReply = () => {}) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id || !isYouTubeUrl(tab.url)) {
      render({ supported: false });
      onReply(null);
      return;
    }
    chrome.tabs.sendMessage(tab.id, payload, (reply) => {
      if (chrome.runtime.lastError) {
        // An already-open YouTube page may predate the extension (or its last
        // reload). Inject on demand so the popup works without a page refresh.
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }, () => {
          if (chrome.runtime.lastError) {
            render({ supported: false });
            onReply(null);
            return;
          }
          chrome.tabs.sendMessage(tab.id, payload, (injectedReply) => {
            if (chrome.runtime.lastError) {
              render({ supported: false });
              onReply(null);
            } else {
              render(injectedReply);
              onReply(injectedReply);
            }
          });
        });
        return;
      }
      if (reply?.error) {
        message.textContent = reply.error;
        message.classList.add("error");
      } else {
        message.textContent = "";
        message.classList.remove("error");
      }
      render(reply);
      onReply(reply);
    });
  });
}

tabs.forEach((tab) => tab.addEventListener("click", () => {
  selectedMode = tab.dataset.mode;
  if (videoInfo?.looping) send({ type: "SET_LOOP", enabled: true, mode: selectedMode });
  else render({ ...videoInfo, mode: "off", sections: videoInfo?.sections || [] });
}));

toggle.addEventListener("click", () => {
  const enabled = toggle.getAttribute("aria-checked") !== "true";
  send({ type: "SET_LOOP", enabled, mode: selectedMode });
});

function markCurrent(inputId) {
  send({ type: "LOOP_STATUS" }, (response) => {
  if (!response?.supported) return;
  document.querySelector(`#${inputId}`).value = formatTime(response.currentTime);
  });
}

document.querySelector("#mark-start").addEventListener("click", () => markCurrent("start-time"));
document.querySelector("#mark-end").addEventListener("click", () => markCurrent("end-time"));
document.querySelector("#add-section").addEventListener("click", () => {
  const start = parseTime(document.querySelector("#start-time").value);
  const end = parseTime(document.querySelector("#end-time").value);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !videoInfo?.duration || end > videoInfo.duration) {
    message.textContent = `Enter valid times between 0:00 and ${formatTime(videoInfo?.duration || 0)}.`;
    message.classList.add("error");
    return;
  }
  selectedMode = "sections";
  send({ type: "ADD_SECTION", start, end });
});

send({ type: "LOOP_STATUS" });
