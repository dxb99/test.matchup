const API_URL = "https://script.google.com/macros/s/AKfycbzozBYQ-jcCf0zoJTo5RMoL4fTl3_IkJKTKMdnjML2IrzPTkXN8oEt1KRbgFTEEpLwCSw/exec";

let allPlayers = [];
let adminLoaded = false;
let countdownTimer = null;
let lastMatchTimestamp = null;
let lastGeneratedMatchups = [];
let generatedMatchupSelectionPending = false;
let selectedMatchKey = null;
let matchHistory = [];
let lastSelectedPlayers = [];
let lastSelectedMatchMaker = "";
let currentMatchKeyFromServer = null;
let blitzEnabled = false;
let currentHistorySort = {
  key: "date",
  direction: "desc"
};
let historyShowingAll = false;
let historyPlayedMapsHasUnsavedChanges = false;
let matchupPickCounts = null;
let matchupPickCountsPromise = null;
let mapListLoaded = false;
let mapListLoadPromise = null;
let globalMapMatchMaker = "";
let globalMapList = {
  elimination: [],
  blitz: [],
  ctf: [],
  bonus: []
};
let adminHasUnsavedChanges = false;
let currentAdminSort = {
  key: "name",
  direction: "asc"
};
let customSessionActive = false;
let customSessionHasUnsavedChanges = false;
let sessionProgressHasUnsavedChanges = false;
let sessionProgressSnapshot = null;
let sessionProgressDraftMaps = null;
let sessionProgressSkippedMaps = {
  elimination: [],
  blitz: [],
  ctf: [],
  bonus: []
};
let sessionMapsNeedSelection = false;
let customSessionData = {
  elimination: [],
  blitz: [],
  ctf: [],
  bonus: []
};
let currentSessionMaps = {
  elimination: [],
  blitz: [],
  ctf: [],
  bonus: []
};
let currentSessionLastPlayed = {
  elimination: "",
  blitz: "",
  ctf: "",
  bonus: ""
};
const API_TIMEOUT_MS = 30000;
const APP_VERSION = "2026.05.16.2";

async function ensureLatestAppVersion(){
  try{
    const res = await fetch("version.json?v=" + Date.now(), {
      cache: "no-store"
    });

    if(!res.ok) return true;

    const data = await res.json();
    const latestVersion = String(data.version || "").trim();

    if(latestVersion && latestVersion !== APP_VERSION){
      const reloadKey = "dxb99MatchupReloadedVersion";

      if(sessionStorage.getItem(reloadKey) !== latestVersion){
        sessionStorage.setItem(reloadKey, latestVersion);

        const url = new URL(window.location.href);
        url.searchParams.set("appVersion", latestVersion);
        window.location.replace(url.toString());
        return false;
      }
    }

    sessionStorage.removeItem("dxb99MatchupReloadedVersion");
  }catch(err){
    console.log("Version check skipped");
  }

  return true;
}

function normalizeSkillValue(value){
  const numeric = Number(value);
  if(Number.isNaN(numeric)) return 0;
  return Math.round(numeric * 10) / 10;
}

function formatSkillValue(value){
  return normalizeSkillValue(value).toFixed(1);
}

function getGapBucket(value){
  const numeric = normalizeSkillValue(value);
  return Math.max(0, Math.min(4, Math.floor(numeric)));
}

function formatGapValue(value){
  return formatSkillValue(value);
}
let armedMatchKey = null; // 🔥 tracks first click before confirm

/* 🔥 GLOBAL MODAL SYSTEM */

function escapeModalText(value){
  return value
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setModalMessage(msg, message){
  const text = message === null || typeof message === "undefined"
    ? ""
    : message.toString();

  if(text.trim().startsWith("⚠")){
    const cleanText = text.trim().replace(/^⚠\s*/, "");
    msg.innerHTML = `
      <span class="modalWarningSymbol">⚠</span>
      <span>${escapeModalText(cleanText)}</span>
    `;
    return;
  }

  msg.innerText = text;
}

function showModal(message, type = "alert", confirmText = "Confirm", cancelText = "Cancel", withInput = false, inputType = "password", inputPlaceholder = "Enter password"){

  return new Promise((resolve)=>{

    const modal = document.getElementById("customModal");
    const msg = document.getElementById("modalMessage");
    const confirmBtn = document.getElementById("modalConfirm");
    const cancelBtn = document.getElementById("modalCancel");
    const input = document.getElementById("modalInput");

    setModalMessage(msg, message);

    confirmBtn.textContent = confirmText === "Confirm"
      ? (type === "alert" ? "OK" : (withInput ? "CONFIRM" : "YES"))
      : confirmText;

    cancelBtn.textContent = cancelText === "Cancel" ? (withInput ? "CANCEL" : "NO") : cancelText;

    input.style.display = withInput ? "block" : "none";
    input.type = inputType;
    input.placeholder = inputPlaceholder;
    input.value = "";

    modal.style.display = "flex";

    if(type === "alert"){
      cancelBtn.style.display = "none";
    }else{
      cancelBtn.style.display = "inline-flex";
    }

    const cleanup = () => {
      modal.style.display = "none";
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
    };

    confirmBtn.onclick = () => {
      const value = withInput ? input.value : true;
      cleanup();
      resolve(value);
    };

    cancelBtn.onclick = () => {
      cleanup();
      resolve(null);
    };

  });

}

/* 🔓 ADMIN UNLOCK SYSTEM */

async function getAdminPassword(){

  let stored = sessionStorage.getItem("adminPass");

  // ✅ If already unlocked → reuse
  if(stored){
    return stored;
  }

  while(true){

let pass = await showModal(
  "Enter Admin Password",
  "confirm",
  "Confirm",
  "Cancel",
  true
);    

// ❌ user cancelled
if(!pass) return null;

showBusy("VERIFYING PASSWORD");

let test = null;

try{

  test = await api({
    action:"verifyAdminPassword",
    password: pass
  });

}finally{

  hideBusy();

}

if(test && test.ok){
  sessionStorage.setItem("adminPass", pass);
  updateAdminBar();
  return pass;
}

await showModal("Wrong password. Try again.", "alert");
  }
}

// 🔥 lock function (for later button)
function clearAdminSession(){
  sessionStorage.removeItem("adminPass");
  updateAdminBar();
}

function updateAdminBar(){

  const status = document.getElementById("adminStatus");
  const lockBtn = document.getElementById("adminLockBtn");

  if(!status || !lockBtn) return;

  const pass = sessionStorage.getItem("adminPass");

if(pass){
  status.textContent = "🔓 ADMIN MODE ACTIVE";
  lockBtn.style.display = "inline-flex";

  document.body.classList.remove("admin-locked");
  document.body.classList.add("admin-unlocked");

}else{
  status.textContent = "🔒 LOCKED";
  lockBtn.style.display = "none";

  document.body.classList.remove("admin-unlocked");
  document.body.classList.add("admin-locked");
}
  
// 🔥 disable session buttons when locked
const generateBtn = document.getElementById("generateSessionMapsBtn");
const saveBtn = document.getElementById("saveSessionProgressBtn");
const clearSessionBtn = document.getElementById("clearSessionMapsBtn");
const buildCustomBtn = document.getElementById("buildCustomSessionBtn");
const mapMakerSelect = document.getElementById("mapMatchMakerSelect");

const protectedSessionButtons = [
  generateBtn,
  saveBtn,
  clearSessionBtn,
  buildCustomBtn
].filter(Boolean);

if(protectedSessionButtons.length){

  protectedSessionButtons.forEach(btn => {

    if(pass){

      btn.classList.remove("disabled");
      btn.removeAttribute("data-tooltip");

    }else{

      btn.classList.add("disabled");
      btn.setAttribute("data-tooltip", "🔒 Admin mode required");

    }

  });

}

if(mapMakerSelect){

  mapMakerSelect.disabled = false;

  if(pass){

    mapMakerSelect.classList.remove("disabled");

  }else{

    mapMakerSelect.classList.add("disabled");

  }

}

// 🔥 CLICK LOCK STATUS TO UNLOCK
status.onclick = async () => {

  // only allow unlock when locked
  if(sessionStorage.getItem("adminPass")) return;

  const pass = await getAdminPassword();
  if(!pass) return;

  sessionStorage.setItem("adminPass", pass);
  updateAdminBar();

};
  
}

function isAdminUnlocked(){
  return !!sessionStorage.getItem("adminPass");
}

function setupHelpGuide(){

  const searchInput = document.getElementById("helpSearchInput");
  const countEl = document.getElementById("helpSearchCount");
  const sections = Array.from(document.querySelectorAll(".helpSection"));
  const topicButtons = Array.from(document.querySelectorAll(".helpTopicBtn"));
  const sectionWrap = document.querySelector(".helpSections");
  let activeHelpTarget = topicButtons[0] ? topicButtons[0].dataset.helpTarget : "";

  if(!sectionWrap || sections.length === 0) return;

  sections.forEach(section => {
    section.dataset.originalHtml = section.innerHTML;
  });

  let noResults = document.getElementById("helpNoResults");

  if(!noResults){
    noResults = document.createElement("div");
    noResults.id = "helpNoResults";
    noResults.className = "helpNoResults hidden";
    noResults.textContent = "No help topics found. Try a simpler word.";
    sectionWrap.appendChild(noResults);
  }

  topicButtons.forEach(btn => {
    btn.onclick = () => {
      activeHelpTarget = btn.dataset.helpTarget;

      if(searchInput){
        searchInput.value = "";
      }

      renderHelpGuide("");
    };
  });

  function escapeRegExp(value){
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlightHelpTerm(section, term){
    section.innerHTML = section.dataset.originalHtml || section.innerHTML;

    if(!term) return;

    const regex = new RegExp(`(${escapeRegExp(term)})`, "gi");
    const walker = document.createTreeWalker(
      section,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node){
          if(!node.nodeValue || !regex.test(node.nodeValue)){
            regex.lastIndex = 0;
            return NodeFilter.FILTER_REJECT;
          }

          regex.lastIndex = 0;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];

    while(walker.nextNode()){
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach(node => {
      const fragment = document.createDocumentFragment();
      const parts = node.nodeValue.split(regex);

      parts.forEach(part => {
        if(part.toLowerCase() === term.toLowerCase()){
          const mark = document.createElement("mark");
          mark.className = "helpSearchHighlight";
          mark.textContent = part;
          fragment.appendChild(mark);
        }else{
          fragment.appendChild(document.createTextNode(part));
        }
      });

      node.parentNode.replaceChild(fragment, node);
    });
  }

  function renderHelpGuide(rawTerm){
    const term = rawTerm.trim();
    const normalizedTerm = term.toLowerCase();
    let visibleCount = 0;
    let firstMatchId = "";

    sections.forEach(section => {
      highlightHelpTerm(section, term);

      const haystack = [
        section.innerText,
        section.dataset.helpKeywords || ""
      ].join(" ").toLowerCase();

      const isMatch = !normalizedTerm || haystack.includes(normalizedTerm);
      const isActive = section.id === activeHelpTarget;
      const shouldShow = term ? isMatch : isActive;

      section.classList.toggle("hidden", !shouldShow);

      if(isMatch){
        visibleCount++;

        if(!firstMatchId){
          firstMatchId = section.id;
        }
      }
    });

    topicButtons.forEach(btn => {
      const target = document.getElementById(btn.dataset.helpTarget);
      const haystack = target
        ? [target.innerText, target.dataset.helpKeywords || ""].join(" ").toLowerCase()
        : "";
      const isMatch = !normalizedTerm || haystack.includes(normalizedTerm);

      btn.classList.toggle("hidden", !isMatch);
      btn.classList.toggle("active", !term && btn.dataset.helpTarget === activeHelpTarget);
    });

    noResults.classList.toggle("hidden", !term || visibleCount !== 0);

    if(countEl){
      countEl.textContent = term
        ? `${visibleCount} help ${visibleCount === 1 ? "topic" : "topics"} found`
        : "Select a help topic";
    }

    if(term && firstMatchId){
      activeHelpTarget = firstMatchId;
    }
  }

  if(searchInput){
    searchInput.oninput = () => renderHelpGuide(searchInput.value);
  }

  renderHelpGuide("");

}

window.addEventListener("load", async () => {

const isLatestAppVersion = await ensureLatestAppVersion();
if(!isLatestAppVersion) return;

sessionStorage.removeItem("selectedGeneratorMatchMaker");
sessionStorage.removeItem("selectedPlayers");
sessionStorage.removeItem("adminPass");

  try {

    await loadInitialData();
    setupHelpGuide();

/* 🔥 HIDE BLITZ ON LOAD */

const blitzContainer = document.querySelector(".blitzToggle");
if(blitzContainer){
  blitzContainer.style.display = "none";
}

    document.getElementById("loadingScreen").style.display = "none";
    document.getElementById("app").classList.remove("hidden");
    updateAdminBar();

window.scrollTo(0, 0);

    document.querySelectorAll('input[name="gapFilter"]').forEach(radio => {
      radio.addEventListener("change", applyGapFilter);
    });

const blitzToggle = document.getElementById("blitzToggle");

if(blitzToggle){

blitzToggle.addEventListener("change", () => {

  blitzEnabled = blitzToggle.checked;

  updateGapCounts(); /* 🔥 ADD THIS */
  applyGapFilter();

});

}

    setupMapListButtons();

    document.getElementById("adminLockBtn").onclick = clearAdminSession;
    
    startMatchAutoRefresh();

  } catch (err) {

    console.error(err);
    await showModal("Startup error. Open console (F12).", "alert");

  }

});

async function api(data){

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try{

    const res = await fetch(API_URL,{
      method:"POST",
      headers:{
        "Content-Type":"text/plain;charset=utf-8"
      },
      body:JSON.stringify(data),
      signal: controller.signal
    });

    if(!res.ok){
      throw new Error(`Request failed with status ${res.status}`);
    }

    const text = await res.text();

    try{
      return JSON.parse(text);
    }catch(err){
      throw new Error("Server returned an unreadable response");
    }

  }catch(err){

    if(err && err.name === "AbortError"){
      throw new Error("Request timed out. The action may have completed. Refresh and check before trying again.");
    }

    throw err;

  }finally{

    clearTimeout(timeoutId);

  }

}

function showBusy(message = "LOADING"){

  const overlay = document.getElementById("savingOverlay");

  if(!overlay) return;

  const text = overlay.querySelector(".generatingText");

  if(text){
    text.innerHTML = `${message}<span class="dots"></span>`;
  }

  overlay.style.display = "flex";

}

function hideBusy(){

  const overlay = document.getElementById("savingOverlay");

  if(!overlay) return;

  overlay.style.display = "none";

  const text = overlay.querySelector(".generatingText");

  if(text){
    text.innerHTML = "SAVING<span class=\"dots\"></span>";
  }

}

function getActionErrorMessage(err, fallback = "Action failed."){

  const message = err && err.message ? err.message : "";

  if(message.includes("timed out")){
    return message;
  }

  if(message){
    return `${fallback} ${message}`;
  }

  return fallback;

}

async function canLeaveCurrentTab(nextTab){

  const activeTab = document.querySelector(".tabContent.active");
  const activeTabId = activeTab ? activeTab.id : "";

  if(!activeTabId || activeTabId === nextTab) return true;

  if(historyPlayedMapsHasUnsavedChanges){
    const leave = await showModal(
      "You have unsaved played-map changes. Leave without saving?",
      "confirm"
    );

    if(leave){
      closeHistoryPlayedMapsEditor(true);
      return true;
    }

    return false;
  }

  if(activeTabId === "generatorTab" && generatedMatchupSelectionPending){
    const leave = await showModal(
      "Leave without selecting matchup?\nNo matchup will be saved.",
      "confirm"
    );

    if(leave){
      resetGeneratedMatchups();
      generatedMatchupSelectionPending = false;
      return true;
    }

    return false;
  }

  if(activeTabId === "adminTab" && adminHasUnsavedChanges){
    const leave = await showModal(
      "You have unsaved player changes. Leave without saving?",
      "confirm"
    );

    if(leave){
      markAdminDirty(false);
      return true;
    }

    return false;
  }

  if(activeTabId === "mapListTab" && customSessionActive && customSessionHasUnsavedChanges){
    const leave = await showModal(
      "You have unsaved custom session changes. Leave without saving?",
      "confirm"
    );

    if(leave){
      customSessionActive = false;
      customSessionHasUnsavedChanges = false;
      customSessionData = normalizeSessionData(currentSessionMaps);
      updateCustomSessionButtons();
      renderAllSessionViews();
      return true;
    }

    return false;
  }

  if(activeTabId === "mapListTab" && sessionProgressHasUnsavedChanges){
    const leave = await showModal(
      "You removed session maps but have not saved session progress. Leave without saving progress?",
      "confirm"
    );

    if(leave){
      if(sessionProgressSnapshot){
        currentSessionMaps = normalizeSessionData(sessionProgressSnapshot);
      }

      sessionProgressHasUnsavedChanges = false;
      sessionProgressSnapshot = null;
      sessionProgressDraftMaps = null;
      sessionProgressSkippedMaps = {
        elimination: [],
        blitz: [],
        ctf: [],
        bonus: []
      };
      renderAllSessionViews();
      return true;
    }

    return false;
  }

  if(activeTabId === "mapListTab" && sessionMapsNeedSelection){
    const leave = await showModal(
      "Session maps are empty. Leave without generating or saving a custom session?",
      "confirm"
    );

    if(leave){
      return true;
    }

    return false;
  }

  return true;

}

window.canLeaveCurrentTab = canLeaveCurrentTab;

function hasProtectedUnsavedWork(){

  const activeTab = document.querySelector(".tabContent.active");
  const activeTabId = activeTab ? activeTab.id : "";

  return (
    generatedMatchupSelectionPending ||
    adminHasUnsavedChanges ||
    customSessionHasUnsavedChanges ||
    sessionProgressHasUnsavedChanges ||
    sessionMapsNeedSelection ||
    historyPlayedMapsHasUnsavedChanges
  );

}

window.addEventListener("beforeunload", (event) => {

  if(!hasProtectedUnsavedWork()) return;

  event.preventDefault();
  event.returnValue = "";

});

async function loadInitialData(){

const data = await api({action:"getStartupData"});

if(!data.ok){
  throw new Error("Failed loading data");
}

allPlayers = data.players || [];
globalMapMatchMaker = data.mapMatchMaker || "";

populatePlayers(allPlayers);

if(lastGeneratedMatchups.length === 0){

  document.querySelectorAll('input[name="gapFilter"]').forEach(r=>{
    r.disabled = true;
    r.parentElement.classList.add("disabled");
  });

}else{

  // Re-apply correct radio states based on matchups
  updateGapCounts();

  // Re-render filtered matchups
  applyGapFilter();

}

renderMatchup(data.currentMatchup);

if(data.sessionMaps && data.sessionMaps.ok){
  syncSessionStateFromResponse(data.sessionMaps);
}

if(data.customSession && data.customSession.ok){
  customSessionActive = false;
  customSessionHasUnsavedChanges = false;
  customSessionData = normalizeSessionData(data.customSession.session);
}

updateCustomSessionButtons();
renderAllSessionViews();

}

async function ensureMatchupPickCounts(){

  if(matchupPickCounts){
    return matchupPickCounts;
  }

  if(matchupPickCountsPromise){
    return matchupPickCountsPromise;
  }

  matchupPickCountsPromise = api({
    action:"getMatchupPickCounts"
  }).then(data => {
    matchupPickCounts = data && data.ok ? (data.counts || {}) : {};
    return matchupPickCounts;
  }).catch(() => {
    matchupPickCounts = {};
    return matchupPickCounts;
  }).finally(() => {
    matchupPickCountsPromise = null;
  });

  return matchupPickCountsPromise;

}

function resetMatchupPickCounts(){
  matchupPickCounts = null;
  matchupPickCountsPromise = null;
}

function getMatchupPickCountKey(redNames, blueNames){

  const red = (Array.isArray(redNames) ? redNames : [])
    .filter(Boolean)
    .slice()
    .sort()
    .join(",");

  const blue = (Array.isArray(blueNames) ? blueNames : [])
    .filter(Boolean)
    .slice()
    .sort()
    .join(",");

  const first = red < blue ? red : blue;
  const second = red < blue ? blue : red;

  return first + "||" + second;

}

function populatePlayers(players){

  window.allPlayers = [...players].sort((a,b)=>a.name.localeCompare(b.name));

  renderPlayers(window.allPlayers);

  document.getElementById("playerSort").onchange = function(){

    let type = this.value;

    let sorted = [...window.allPlayers];

    if(type === "alpha"){

      sorted.sort((a,b)=>a.name.localeCompare(b.name));

    }else{

      sorted.sort((a,b)=>{

        if(b.skill !== a.skill) return b.skill - a.skill;

        return a.name.localeCompare(b.name);

      });

    }

    renderPlayers(sorted);

  };

}

function renderMatchup(match){

const el=document.getElementById("matchupContent");
const countdown=document.getElementById("matchCountdown");
const upcomingSessionMaker = document.getElementById("upcomingSessionMaker");

// 🔥 RESET server key if no matchup
currentMatchKeyFromServer = null;
  
if(!match){

  if(countdownTimer){
    clearInterval(countdownTimer);
    countdownTimer = null;
  }

  if(upcomingSessionMaker) upcomingSessionMaker.style.display = "";

  el.innerHTML=`

  <div class="matchCard">
    <div class="matchHeader">
      NO CURRENT MATCHUP
    </div>

    <button id="getStartedBtn" class="getStartedBtn">
      CLICK TO GET STARTED
    </button>

  </div>

  `;

  countdown.innerHTML = "MATCHUP EXPIRES IN --:--:--";

/* 🔥 GET STARTED BUTTON CLICK */
setTimeout(() => {
  const btn = document.getElementById("getStartedBtn");
  if(btn){
    btn.onclick = () => {
      const generatorBtn = document.querySelector('.tabButton[onclick*="generatorTab"]');
      showTab("generatorTab", generatorBtn);
    };
  }
}, 0);

return;
  return;

}

el.innerHTML=`

<div class="matchCard">

<div class="matchHeader">
  Match Maker: <strong>${match.matchMaker}</strong>

<span class="midTag">
  ${match.MID ? "MID_" + String(match.MID).replace("MID_","").padStart(4,"0") : "----"}
</span>
</div>

  <div class="teamsRow">

    <div class="team red">
  <div class="teamTitle">
    RED TEAM <span class="teamBadge">${formatSkillValue(match.redSkill)}</span>
  </div>
      <div class="teamPlayers">
        ${match.redTeam.map(name => {

  const player = allPlayers.find(p => p.name === name);

  return `
    <div class="playerRow">
      ${name}
      <span class="skillMedal">${player ? formatSkillValue(player.skill) : ""}</span>
    </div>
  `;

}).join("")}
      </div>
    </div>

    <div class="vs">VS</div>

    <div class="team blue">
  <div class="teamTitle">
    BLUE TEAM <span class="teamBadge">${formatSkillValue(match.blueSkill)}</span>
  </div>
      <div class="teamPlayers">
        ${match.blueTeam.map(name => {

  const player = allPlayers.find(p => p.name === name);

  return `
    <div class="playerRow">
      ${name}
      <span class="skillMedal">${player ? formatSkillValue(player.skill) : ""}</span>
    </div>
  `;

}).join("")}
      </div>
    </div>

  </div>

  <div class="matchFooter">
    <span class="diff diff-${getGapBucket(match.skillGap)}">
  Difference: ${formatGapValue(match.skillGap)}
</span>
  </div>

</div>

`;

const expiry = new Date(match.expiresAt);
const now = new Date();

if(expiry <= now){

  // 🔥 CLEAR SERVER MATCH KEY (THIS FIXES YOUR ISSUE)
  currentMatchKeyFromServer = null;

  if(upcomingSessionMaker) upcomingSessionMaker.style.display = "";

  el.innerHTML=`

  <div class="matchCard">
    <div class="matchHeader">
      NO CURRENT MATCHUP
    </div>

    <button id="getStartedBtn" class="getStartedBtn">
      CLICK TO GET STARTED
    </button>

  </div>

  `;

  countdown.innerHTML = "MATCHUP EXPIRES IN --:--:--";

  /* 🔥 GET STARTED BUTTON CLICK */
  setTimeout(() => {
    const btn = document.getElementById("getStartedBtn");
    if(btn){
      btn.onclick = () => {
        const generatorBtn = document.querySelector('.tabButton[onclick*="generatorTab"]');
        showTab("generatorTab", generatorBtn);
      };
    }
  }, 0);

  return;

}

// 🔥 BUILD KEY FROM SERVER MATCH (ONLY IF NOT EXPIRED)
const redKey = match.redTeam.slice().sort().join("|");
const blueKey = match.blueTeam.slice().sort().join("|");

currentMatchKeyFromServer = redKey + "-" + blueKey;

if(upcomingSessionMaker) upcomingSessionMaker.style.display = "none";

if(match.selectedAt !== lastMatchTimestamp){

  lastMatchTimestamp = match.selectedAt;

  startCountdown(expiry);

}

}

document.getElementById("generateButton").onclick = generateMatchups;

async function generateMatchups(){

  const selectedPlayers=[];

  const maker = document.getElementById("matchMakerSelect").value;

if(!maker){
  showModal("Select Match Maker first.", "alert");
  return;
}

  document.querySelectorAll("#playersCheckboxes input:checked").forEach(x=>{
    selectedPlayers.push(x.value);
  });
  
  if(selectedPlayers.length < 2){
    showModal("Select at least 2 players.", "alert");
    return;
  }

  document.getElementById("generatingOverlay").style.display = "flex";

  const gap = document.querySelector('input[name="gapFilter"]:checked').value;

try{
  await ensureMatchupPickCounts();
}catch(err){
  document.getElementById("generatingOverlay").style.display = "none";
  showModal(getActionErrorMessage(err, "Could not load matchup pick counts."), "alert");
  return;
}

const matchups = generateMatchupsLocal(selectedPlayers, gap);

/* 🔥 CONTROL BLITZ VISIBILITY AFTER GENERATE */

const blitzToggle = document.getElementById("blitzToggle");
const blitzContainer = document.querySelector(".blitzToggle");

if(blitzToggle && blitzContainer){

  if(selectedPlayers.length % 2 !== 0){

    /* SHOW with animation */
    blitzContainer.style.display = "flex";

requestAnimationFrame(() => {
  blitzContainer.classList.add("show");
});

  }else{

    /* HIDE */
    blitzContainer.classList.remove("show");

    setTimeout(()=>{
      blitzContainer.style.display = "none";
    },300);

    blitzToggle.checked = false;
    blitzEnabled = false;

  }

}

/* Sort matchups by skill gap */

matchups.sort((a,b)=>a.skillGap - b.skillGap);

lastGeneratedMatchups = matchups;
generatedMatchupSelectionPending = matchups.length > 0;
lastSelectedPlayers = selectedPlayers.slice();

/* Force overlay to stay visible for 1 seconds */

  setTimeout(() => {

  document.querySelectorAll('input[name="gapFilter"]').forEach(r=>{
  r.disabled = false;
  r.parentElement.classList.remove("disabled");
});

  updateGapCounts();

  applyGapFilter();

  document.getElementById("generatingOverlay").style.display = "none";

}, 1000);

}

function renderGeneratedMatchups(matchups){

  const container=document.getElementById("generatedMatchups");

  armedMatchKey = null; // 🔥 reset when rendering new matchups

  container.innerHTML="";

  matchups.forEach(m=>{

    const div=document.createElement("div");

    div.className="matchOption";

div.innerHTML=`

<div class="matchCompact">

<div class="teamLine">

<span class="redTeam"><strong><span class="skillMedal">${formatSkillValue(m.redSkill)}</span> RED TEAM :</strong></span>

<span class="teamPlayers">
${m.redTeam.map(p=>p.name).join(", ")}
</span>

</div>

<div class="teamLine">

<span class="blueTeam"><strong><span class="skillMedal">${formatSkillValue(m.blueSkill)}</span> BLUE TEAM :</strong></span>

<span class="teamPlayers">
${m.blueTeam.map(p=>p.name).join(", ")}
</span>

</div>

<div class="badges">

<span class="badge gap-${getGapBucket(m.skillGap)}">
Difference ${formatGapValue(m.skillGap)}
</span>

<span class="badge picks">
Picked ${m.pickCount} ${m.pickCount === 1 ? "time" : "times"}
</span>

<button class="selectMatch">CLICK TO SELECT</button>

</div>

</div>

`;
    
const btn = div.querySelector(".selectMatch");

const redKey = m.redTeam.map(p=>p.name).sort().join("|");
const blueKey = m.blueTeam.map(p=>p.name).sort().join("|");

const key = redKey + "-" + blueKey;

const isServerSelected = currentMatchKeyFromServer === key;

if(isServerSelected){
  div.classList.add("selectedCard");
  btn.classList.add("selected");
  btn.innerText = "SELECTED";

  btn.style.cursor = "not-allowed";
  btn.disabled = true;
}

btn.onclick = () => {

  // 🔥 BLOCK IF THIS IS CURRENT ACTIVE MATCH
  if(currentMatchKeyFromServer === key){
    return;
  }

  const maker = document.getElementById("matchMakerSelect").value;

  if(!maker){
    showModal("Select Match Maker first.", "alert");
    return;
  }

// 🔥 CUSTOM MODAL CONFIRM
showModal("Are you sure you want to select this matchup?", "confirm")
.then(confirmSelection => {

  if(!confirmSelection){
    return;
  }

  // 🔥 SAVE DIRECTLY
  selectMatchup(m, key, btn, div);

});
};

// 🔥 MAKE ENTIRE CARD CLICKABLE (SAME AS BUTTON)
div.onclick = (e) => {

  // prevent double trigger if button itself clicked
  if(e.target.classList.contains("selectMatch")) return;

  btn.click(); // trigger same logic as button

};
    
container.appendChild(div);

  });

}

async function selectMatchup(match, key, btn, div){

  const maker=document.getElementById("matchMakerSelect").value;

  if(!maker){
    showModal("Select Match Maker first.", "alert");
    return;
  }
const overlay = document.getElementById("savingMatchOverlay");

overlay.querySelector(".generatingText").innerHTML = "SAVING<span class=\"dots\"></span>";
overlay.style.display = "flex";

const data = await api({

  action:"saveMatchupDirect",

  matchMaker:maker,

  redTeam:match.redTeam.map(p=>p.name),

  blueTeam:match.blueTeam.map(p=>p.name)

});

  if(!data.ok){

  overlay.style.display = "none";

  showModal(data.error, "alert");

  return;

}

// 🔥 ONLY mark selected AFTER SUCCESS
currentMatchKeyFromServer = key; // 🔥 FORCE SYNC IMMEDIATELY
document.querySelectorAll(".matchOption").forEach(card=>{
  card.classList.remove("armedCard");
  card.classList.remove("selectedCard");
});

document.querySelectorAll(".selectMatch").forEach(b=>{
  b.classList.remove("selected");
  b.classList.remove("confirming"); // 🔥 ADD
  b.innerText = "CLICK TO SELECT";
  b.disabled = false; // 🔥 reset disabled state
  b.style.cursor = "pointer";
});

div.classList.add("selectedCard");
btn.classList.add("selected");
btn.innerText = "SELECTED";
btn.disabled = true;
btn.style.cursor = "not-allowed";

resetGeneratedMatchups();

/* CHANGE OVERLAY TEXT TO SAVED */

overlay.querySelector(".generatingText").innerHTML = "SAVED ✓";

/* WAIT 1 SECOND THEN REDIRECT */

setTimeout(async () => {

  // 🔥 Switch while overlay is still visible, so Generator never flashes back onscreen.
  const matchupBtn = document.querySelector('.tabButton[onclick*="matchupTab"]');
  await showTab("matchupTab", matchupBtn);

  try{

    // 🔥 Refresh only the visible matchup before hiding overlay.
    const data = await api({action:"getCurrentMatchupData"});

    if(data.ok){
      renderMatchup(data.currentMatchup);
      renderUpcomingSessionCard(getActiveSessionMaps());
    }

  }finally{

    overlay.style.display = "none";

  }

  // 🔥 Refresh generator/history details quietly after the user is already on Matchup.
  resetMatchupPickCounts();

}, 1000);

}

function startCountdown(expiry){

  if(countdownTimer){
  clearInterval(countdownTimer);
}

  const el=document.getElementById("matchCountdown");

  el.innerHTML = "MATCHUP EXPIRES IN --:--:--";

  countdownTimer = setInterval(()=>{

    const now=new Date();

    const diff=expiry-now;

    if(diff<=0){

  clearInterval(countdownTimer);
  countdownTimer = null;

  el.innerHTML = "MATCHUP EXPIRES IN --:--:--";

  return;

}

    const hours=Math.floor(diff/3600000);
    const mins=Math.floor((diff%3600000)/60000);
    const secs=Math.floor((diff%60000)/1000);

    el.innerHTML=`MATCHUP EXPIRES IN ${hours}:${mins}:${secs}`;

  },1000);

}

function renderPlayers(players){

  const maker = document.getElementById("matchMakerSelect");
  const mapMaker = document.getElementById("mapMatchMakerSelect");
  const list = document.getElementById("playersCheckboxes");

  maker.innerHTML="";
  if(mapMaker) mapMaker.innerHTML="";
  list.innerHTML="";

  // 🔥 ADD PLACEHOLDER (DEFAULT BLANK OPTION)

const placeholder = document.createElement("option");
placeholder.value = "";
placeholder.textContent = "Select Match Maker";
placeholder.disabled = true;
placeholder.selected = true;

maker.appendChild(placeholder);

if(mapMaker){
  mapMaker.appendChild(placeholder.cloneNode(true));
}

const matchMakerPlayers = players.filter(p => p.matchMaker !== false);
  
players.forEach(p=>{

  const div=document.createElement("div");

const savedPlayers = JSON.parse(sessionStorage.getItem("selectedPlayers") || "null");

const isChecked = !savedPlayers || savedPlayers.includes(p.name);

div.innerHTML=`
  <label>
  <input type="checkbox" ${isChecked ? "checked" : ""} value="${p.name}">
  ${p.name}
  <span class="skillMedal">${formatSkillValue(p.skill)}</span>
  </label>
  `;

  div.querySelector("input").addEventListener("change", () => {

    updateSelectedPlayerCount();

    const currentPlayers = Array.from(
      document.querySelectorAll("#playersCheckboxes input:checked")
    ).map(x => x.value).sort();

    const previousPlayers = [...lastSelectedPlayers].sort();

    const isSame =
      currentPlayers.length === previousPlayers.length &&
      currentPlayers.every((v,i)=>v === previousPlayers[i]);

    if(!isSame){
      resetGeneratedMatchups();
    }

/* 🔥 SAVE PLAYER SELECTION */

sessionStorage.setItem(
  "selectedPlayers",
  JSON.stringify(currentPlayers)
);

  });

  list.appendChild(div);

});

matchMakerPlayers.forEach(p=>{

  const opt=document.createElement("option");

  opt.value=p.name;
  opt.innerText=p.name;

  maker.appendChild(opt);

  if(mapMaker){
    const opt2 = opt.cloneNode(true);
    mapMaker.appendChild(opt2);
  }

});

/* 🔥 ADD THIS BLOCK */

const savedGeneratorMaker = sessionStorage.getItem("selectedGeneratorMatchMaker");

if(savedGeneratorMaker){
  maker.value = savedGeneratorMaker;
}

if(mapMaker && globalMapMatchMaker){
  mapMaker.value = globalMapMatchMaker;
}

/* 🔥 AND THIS BLOCK */

maker.onchange = function(){

  sessionStorage.setItem("selectedGeneratorMatchMaker", this.value);

  resetGeneratedMatchups();
  lastSelectedPlayers = [];
  selectedMatchKey = null;

};

if(mapMaker){

  mapMaker.onmousedown = function(e){

    if(isAdminUnlocked()) return;

    e.preventDefault();
    showModal("Unlock admin mode first.", "alert");

  };

  mapMaker.ontouchstart = function(e){

    if(isAdminUnlocked()) return;

    e.preventDefault();
    showModal("Unlock admin mode first.", "alert");

  };

  mapMaker.onchange = async function(){

    if(!isAdminUnlocked()){
      showModal("Unlock admin mode first.", "alert");
      return;
    }

    const selectedName = this.value;

    showBusy("SAVING MATCH MAKER");

    try{

    const res = await api({
      action:"saveGlobalMapMatchMaker",
      matchMaker: selectedName
    });

    if(!res || !res.ok){
      showModal("Could not save map list match maker", "alert");
      return;
    }

    globalMapMatchMaker = res.matchMaker || "";

    renderUpcomingSessionCard(getActiveSessionMaps());

    }finally{

      hideBusy();

    }

  };

}

updateSelectedPlayerCount();

}

function markAdminDirty(isDirty = true){
  adminHasUnsavedChanges = isDirty;

  const status = document.getElementById("adminDirtyStatus");
  if(!status) return;

  status.style.display = isDirty ? "inline-block" : "none";
}

function createSkillAdjuster(value){

  const wrapper = document.createElement("div");
  wrapper.className = "skillAdjuster";

  const downBtn = document.createElement("button");
  downBtn.className = "skillAdjustBtn";
  downBtn.type = "button";
  downBtn.textContent = "▼";

  const cell = document.createElement("div");
  cell.className = "skillValueCell";
  cell.contentEditable = "true";
  cell.textContent = formatSkillValue(value);

  const upBtn = document.createElement("button");
  upBtn.className = "skillAdjustBtn";
  upBtn.type = "button";
  upBtn.textContent = "▲";

  const clampAndSet = (nextValue) => {
    const numeric = normalizeSkillValue(nextValue);
    cell.textContent = formatSkillValue(numeric);
    markAdminDirty(true);
  };

  downBtn.onclick = () => {
    const current = normalizeSkillValue(cell.textContent.trim());
    cell.textContent = formatSkillValue(current - 0.1);
    markAdminDirty(true);
  };

  upBtn.onclick = () => {
    const current = normalizeSkillValue(cell.textContent.trim());
    cell.textContent = formatSkillValue(current + 0.1);
    markAdminDirty(true);
  };

  cell.addEventListener("input", () => {
    markAdminDirty(true);
  });

  cell.addEventListener("blur", () => {
    clampAndSet(cell.textContent.trim());
  });

  wrapper.appendChild(downBtn);
  wrapper.appendChild(cell);
  wrapper.appendChild(upBtn);

  return wrapper;
}

async function openAdminTab(btn){

  if(document.querySelector("#adminTab.active")) return;

  if(!(await showTab("adminTab", btn))) return;

  /* SHOW LOADING OVERLAY */

  document.getElementById("historyLoadingOverlay").style.display = "flex";

  let data;

  try{
    data = await api({
      action:"getPlayersAdmin"
    });
  }catch(err){
    document.getElementById("historyLoadingOverlay").style.display = "none";
    showModal(getActionErrorMessage(err, "Failed loading players."), "alert");
    return;
  }

  /* HIDE LOADING OVERLAY */

  document.getElementById("historyLoadingOverlay").style.display = "none";

  if(!data.ok){
    showModal("Failed loading players", "alert");
    return;
  }

  const table = document.querySelector("#adminTable tbody");

  table.innerHTML="";

  data.players.forEach(p=>{

    const row=document.createElement("tr");

    row.innerHTML=`

    <td contenteditable="true">${p.name}</td>

    <td class="skillCell"></td>

    <td><input type="checkbox" class="matchMakerEligible" ${p.matchMaker !== false ? "checked" : ""}></td>

    <td><button class="btn btn-red remove">REMOVE</button></td>

    `;

    row.cells[0].addEventListener("input", () => {
      markAdminDirty(true);
    });

    row.querySelector(".skillCell").appendChild(createSkillAdjuster(p.skill));

    row.querySelector(".matchMakerEligible").addEventListener("change", () => {
      markAdminDirty(true);
    });

    row.querySelector(".remove").onclick=()=>{

      row.remove();
      updatePlayerCount();
      markAdminDirty(true);

    };

    table.appendChild(row);

  });

  updatePlayerCount();
  setupAdminSorting();
  sortAdminTableRows();
  markAdminDirty(false);

}

function updatePlayerCount(){

  const rows = document.querySelectorAll("#adminTable tbody tr").length;

  document.getElementById("playerCount").innerText = "Players: " + rows;

}

function sortAdminTableRows(){

  const tbody = document.querySelector("#adminTable tbody");
  if(!tbody || !currentAdminSort.key) return;

  const rows = Array.from(tbody.querySelectorAll("tr"));

  rows.sort((a, b) => {

    let valA = "";
    let valB = "";

    if(currentAdminSort.key === "name"){
      valA = a.cells[0].innerText.trim().toLowerCase();
      valB = b.cells[0].innerText.trim().toLowerCase();
    }

    if(currentAdminSort.key === "skill"){
      valA = normalizeSkillValue(a.querySelector(".skillValueCell")?.innerText.trim() || "0");
      valB = normalizeSkillValue(b.querySelector(".skillValueCell")?.innerText.trim() || "0");
    }

    if(valA < valB) return currentAdminSort.direction === "asc" ? -1 : 1;
    if(valA > valB) return currentAdminSort.direction === "asc" ? 1 : -1;
    return 0;

  });

  rows.forEach(row => tbody.appendChild(row));

}

function updateAdminSortIndicators(){

  const headers = document.querySelectorAll("#adminTable th[data-sort]");

  headers.forEach(th => {
    const key = th.dataset.sort;
    const base = key === "name" ? "Name" : "Skill";

    if(currentAdminSort.key === key){
      th.innerText = base + (currentAdminSort.direction === "asc" ? " ▲" : " ▼");
    }else{
      th.innerText = base + " ▴▾";
    }
  });

}

function setupAdminSorting(){

  const headers = document.querySelectorAll("#adminTable th[data-sort]");

  headers.forEach(th => {
    th.onclick = () => {
      const key = th.dataset.sort;

      if(currentAdminSort.key === key){
        currentAdminSort.direction =
          currentAdminSort.direction === "asc" ? "desc" : "asc";
      }else{
        currentAdminSort.key = key;
        currentAdminSort.direction = "asc";
      }

      sortAdminTableRows();
      updateAdminSortIndicators();
    };
  });

  updateAdminSortIndicators();

}

function addAdminPlayerRow(){

  const table = document.querySelector("#adminTable tbody");

  const row = document.createElement("tr");

  row.innerHTML = `

  <td contenteditable="true"></td>

  <td class="skillCell"></td>

  <td><input type="checkbox" class="matchMakerEligible" checked></td>

  <td><button class="btn btn-red remove">REMOVE</button></td>

  `;

  row.cells[0].addEventListener("input", () => {
    markAdminDirty(true);
  });

  row.querySelector(".skillCell").appendChild(createSkillAdjuster(0));

  row.querySelector(".matchMakerEligible").addEventListener("change", () => {
    markAdminDirty(true);
  });

  row.querySelector(".remove").onclick = () => {

    row.remove();
    updatePlayerCount();
    markAdminDirty(true);

  };

  table.appendChild(row);

  updatePlayerCount();
  markAdminDirty(true);

}

document.getElementById("addPlayer").onclick = addAdminPlayerRow;

document.getElementById("savePlayers").onclick = savePlayers;

async function savePlayers(){

const pass = await getAdminPassword();
if(!pass) return;

  document.getElementById("savingOverlay").style.display = "flex";

  const players = [];

  document.querySelectorAll("#adminTable tbody tr").forEach(row=>{

    const name = row.cells[0].innerText.trim();
    const skillCell = row.querySelector(".skillValueCell");
    const skill = normalizeSkillValue(skillCell ? skillCell.innerText.trim() : "0");
    const matchMakerEligible = row.querySelector(".matchMakerEligible");

    if(!name) return;

    players.push({
      name:name,
      skill:skill,
      matchMaker: matchMakerEligible ? matchMakerEligible.checked : true
    });

  });

  const data = await api({

    action:"savePlayersAdmin",

    password:pass,

    players:players

  });

  document.getElementById("savingOverlay").style.display = "none";

if(!data.ok){

  showModal(data.error, "alert");
  return;

}

// 🔥 ADD THIS
sessionStorage.setItem("adminPass", pass);
updateAdminBar();

markAdminDirty(false);

showModal("Players saved successfully", "alert");

openAdminTab();

}

async function openHistoryTab(btn){

  if(!(await showTab("historyTab", btn))) return;

  historyShowingAll = false;
  await loadHistoryRange(false);

}

async function loadHistoryRange(includeAll){

  historyShowingAll = includeAll;

  const toggleBtn = document.getElementById("toggleHistoryRangeBtn");
  const status = document.getElementById("historyRangeStatus");

  if(toggleBtn){
    toggleBtn.innerText = includeAll ? "SHOW LAST 3 MONTHS" : "LOAD ALL HISTORY";
  }

  if(status){
    status.innerText = includeAll ? "Showing all history" : "Showing last 3 months";
  }

  document.getElementById("historyLoadingOverlay").style.display = "flex";

  let data;

  try{
    data = await api({
      action:"getHistory",
      includeAll:includeAll
    });
  }catch(err){
    document.getElementById("historyLoadingOverlay").style.display = "none";
    showModal(getActionErrorMessage(err, "Could not load history."), "alert");
    return;
  }

  if(!data.ok){

    document.getElementById("historyLoadingOverlay").style.display = "none";

    showModal("Could not load history", "alert");
    return;

  }

  matchHistory = data.history || [];
  renderHistory(matchHistory);

  setupHistorySorting();
  updateSortIndicators();

  document.getElementById("historyLoadingOverlay").style.display = "none";

}

function renderHistory(history){

const tbody = document.getElementById("historyTableBody");

tbody.innerHTML = "";

if(!history || history.length === 0){
  tbody.innerHTML = `<tr><td colspan="5">No match history yet.</td></tr>`;
  return;
}

/* 🔥 COUNT MATCHUP FREQUENCY */

const counts = {};

history.forEach(h => {

  const red = h.redTeam.split(", ").sort().join(",");
  const blue = h.blueTeam.split(", ").sort().join(",");

  const key1 = red + "|" + blue;
  const key2 = blue + "|" + red;

  if(counts[key1] || counts[key2]){
    counts[key1] = (counts[key1] || counts[key2]) + 1;
  }else{
    counts[key1] = 1;
  }

});

/* 🔥 DEFAULT SORT (NEWEST FIRST) */

/* 🔥 APPLY CURRENT SORT */

history.sort((a,b)=>{

  let valA, valB;

  switch(currentHistorySort.key){

    case "date":
      valA = new Date(a.selectedAt);
      valB = new Date(b.selectedAt);
      break;

    case "mid":
      valA = parseInt(a.MID || 0);
      valB = parseInt(b.MID || 0);
      break;

    case "maker":
      valA = a.matchMaker.toLowerCase();
      valB = b.matchMaker.toLowerCase();
      break;

    case "picked":

      const getCount = (m) => {
        const r = m.redTeam.split(", ").sort().join(",");
        const b = m.blueTeam.split(", ").sort().join(",");
        return counts[r+"|"+b] || counts[b+"|"+r] || 0;
      };

      valA = getCount(a);
      valB = getCount(b);
      break;

    case "gap":
      valA = a.skillGap;
      valB = b.skillGap;
      break;

    default:
      valA = 0;
      valB = 0;
  }

  if(valA < valB) return currentHistorySort.direction === "asc" ? -1 : 1;
  if(valA > valB) return currentHistorySort.direction === "asc" ? 1 : -1;
  return 0;

});

history.forEach(match => {

  const row = document.createElement("tr");

  const key1 = match.redTeam.split(", ").sort().join(",") + "|" + match.blueTeam.split(", ").sort().join(",");
  const key2 = match.blueTeam.split(", ").sort().join(",") + "|" + match.redTeam.split(", ").sort().join(",");

  const count = counts[key1] || counts[key2] || 0;

row.innerHTML = `
  <td>
    <span class="historyDateCellContent">
      <span class="expandIcon">▶</span>
      <span class="historyDateText">${formatDate(match.selectedAt)}</span>
    </span>
  </td>
  <td>${match.MID ? "MID_" + String(match.MID).replace("MID_","").padStart(4,"0") : "----"}</td>
  <td>${match.matchMaker}</td>
  <td>${count}</td>
  <td>${formatGapValue(match.skillGap)}</td>
`;

  /* 🔥 DETAIL ROW */

  const detailRow = document.createElement("tr");

  detailRow.className = "historyDetailRow";
  detailRow.style.display = "none";

detailRow.innerHTML = `
  <td colspan="5">

    <div class="matchCard">

      <div class="teamsRow">

        <div class="team red">
          <div class="teamTitle">
            RED TEAM <span class="teamBadge">${formatSkillValue(match.redSkill)}</span>
          </div>

          <div class="teamPlayers">
${match.redTeam
  .split(", ")
  .sort((a,b)=>a.localeCompare(b))
  .map(name => {

  const player = allPlayers.find(p => p.name === name);

  return `
    <div class="playerRow">
      ${name}
      <span class="skillMedal">${player ? formatSkillValue(player.skill) : ""}</span>
    </div>
  `;

}).join("")}
          </div>
        </div>

        <div class="vs">VS</div>

        <div class="team blue">
          <div class="teamTitle">
            BLUE TEAM <span class="teamBadge">${formatSkillValue(match.blueSkill)}</span>
          </div>

          <div class="teamPlayers">
${match.blueTeam
  .split(", ")
  .sort((a,b)=>a.localeCompare(b))
  .map(name => {

  const player = allPlayers.find(p => p.name === name);

  return `
    <div class="playerRow">
      ${name}
      <span class="skillMedal">${player ? formatSkillValue(player.skill) : ""}</span>
    </div>
  `;

}).join("")}
          </div>
        </div>

      </div>

      <div class="matchFooter">
        <span class="diff diff-${getGapBucket(match.skillGap)}">
          Difference: ${formatGapValue(match.skillGap)}
        </span>
      </div>

      ${renderHistorySessionMaps(match)}

    </div>

  </td>
`;

  /* 🔥 CLICK TO TOGGLE */

const editMapsBtn = detailRow.querySelector(".editHistoryMapsBtn");

if(editMapsBtn){
  editMapsBtn.onclick = (event) => {
    event.stopPropagation();
    openHistoryPlayedMapsEditor(match);
  };
}

row.onclick = () => {

  const isOpen = detailRow.style.display === "table-row";

  detailRow.style.display = isOpen ? "none" : "table-row";

  const icon = row.querySelector(".expandIcon");

  if(icon){
    icon.innerText = isOpen ? "▶" : "▼";
  }

};

  tbody.appendChild(row);
  tbody.appendChild(detailRow);

});
}

function renderHistorySessionMaps(match){

  const sections = [
    {
      label: "Elimination",
      className: "eliminationHeader",
      maps: match.playedElimination
    },
    {
      label: "Blitz",
      className: "blitzHeader",
      maps: match.playedBlitz
    },
    {
      label: "CTF",
      className: "ctfHeader",
      maps: match.playedCtf
    },
    {
      label: "Bonus",
      className: "bonusHeader",
      maps: match.playedBonus
    }
  ].filter(section => section.maps);

  if(!sections.length && !isAdminUnlocked()){
    return "";
  }

  return `
    <div class="historySessionMaps">
      <div class="historySessionTitleRow">
        <div class="historySessionTitle">SESSION MAPS PLAYED</div>
        <button type="button" class="btn btn-blue editHistoryMapsBtn">EDIT PLAYED MAPS</button>
      </div>
      <div class="historySessionGrid" style="grid-template-columns:repeat(${sections.length}, minmax(0,1fr));">
        ${sections.map(section => `
          <div class="historySessionSection">
            <div class="historySessionHeader ${section.className}">${section.label}</div>
            <div class="historySessionList">
              ${section.maps.split(",").map(mapName => `
                <div class="historySessionMap">${mapName.trim()}</div>
              `).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;

}

function splitHistoryMapText(value){

  if(!value) return [];

  return String(value)
    .split(",")
    .map(mapName => mapName.trim())
    .filter(Boolean);

}

function escapeHtml(value){

  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

}

function getHistoryPlayedMapsFromMatch(match){

  return {
    elimination: splitHistoryMapText(match.playedElimination),
    blitz: splitHistoryMapText(match.playedBlitz),
    ctf: splitHistoryMapText(match.playedCtf),
    bonus: splitHistoryMapText(match.playedBonus)
  };

}

function getHistoryModeLabel(mode){

  if(mode === "ctf") return "CTF";
  if(mode === "bonus") return "Bonus";

  return mode.charAt(0).toUpperCase() + mode.slice(1);

}

function ensureHistoryPlayedMapsModal(){

  let modal = document.getElementById("historyPlayedMapsModal");

  if(modal) return modal;

  modal = document.createElement("div");
  modal.id = "historyPlayedMapsModal";
  modal.className = "historyPlayedMapsModal";
  modal.innerHTML = `
    <div class="historyPlayedMapsBox">
      <div class="historyPlayedMapsHeader">
        <div>
          <div class="historyPlayedMapsEyebrow">HISTORY</div>
          <div class="historyPlayedMapsTitle">EDIT PLAYED MAPS</div>
        </div>
        <button type="button" class="historyPlayedMapsClose">✕</button>
      </div>
      <div id="historyPlayedMapsBody" class="historyPlayedMapsBody"></div>
      <div class="historyPlayedMapsActions">
        <button type="button" class="btn btn-red" id="cancelHistoryPlayedMapsBtn">CANCEL</button>
        <button type="button" class="btn btn-green" id="saveHistoryPlayedMapsBtn">SAVE PLAYED MAPS</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector(".historyPlayedMapsClose").onclick = () => {
    closeHistoryPlayedMapsEditor();
  };

  modal.querySelector("#cancelHistoryPlayedMapsBtn").onclick = () => {
    closeHistoryPlayedMapsEditor();
  };

  modal.onclick = (event) => {
    if(event.target === modal){
      closeHistoryPlayedMapsEditor();
    }
  };

  return modal;

}

function renderHistoryPlayedMapsEditor(state){

  const body = document.getElementById("historyPlayedMapsBody");

  if(!body) return;

  const modes = ["elimination", "blitz", "ctf", "bonus"];

  body.innerHTML = modes.map(mode => {

    const maps = state.session[mode] || [];
    const masterMaps = mode === "bonus"
      ? (globalMapList.elimination || [])
      : (globalMapList[mode] || []);

    return `
      <div class="historyEditSection" data-mode="${mode}">
        <div class="historyEditHeader ${mode === "elimination" ? "eliminationHeader" : mode === "blitz" ? "blitzHeader" : mode === "bonus" ? "bonusHeader" : "ctfHeader"}">
          ${getHistoryModeLabel(mode)}
        </div>

        <div class="historyEditAddRow">
          <select class="historyEditSelect">
            <option value="">Select map</option>
            ${masterMaps.map(mapName => `
              <option value="${escapeHtml(mapName)}">${escapeHtml(mapName)}</option>
            `).join("")}
          </select>
          <button type="button" class="btn btn-blue historyEditAddBtn">ADD</button>
        </div>

        <div class="historyEditAddRow">
          <input class="historyEditCustomInput" type="text" placeholder="Type custom map name">
          <button type="button" class="btn btn-blue historyEditCustomBtn">ADD CUSTOM</button>
        </div>

        <div class="historyEditRows">
          ${maps.length ? maps.map((mapName, index) => `
            <div class="historyEditMapRow">
              <span class="historyEditMapName">${escapeHtml(mapName)}</span>
              <button type="button" class="historyEditIconBtn historyEditUpBtn" ${index === 0 ? "disabled" : ""}>▲</button>
              <button type="button" class="historyEditIconBtn historyEditDownBtn" ${index === maps.length - 1 ? "disabled" : ""}>▼</button>
              <button type="button" class="historyEditIconBtn historyEditRemoveBtn">✕</button>
            </div>
          `).join("") : `
            <div class="historyEditEmpty">No maps saved for ${getHistoryModeLabel(mode)}.</div>
          `}
        </div>
      </div>
    `;

  }).join("");

  body.querySelectorAll(".historyEditSection").forEach(section => {

    const mode = section.getAttribute("data-mode");
    const select = section.querySelector(".historyEditSelect");
    const customInput = section.querySelector(".historyEditCustomInput");

    section.querySelector(".historyEditAddBtn").onclick = () => {
      addHistoryPlayedMap(state, mode, select.value);
    };

    section.querySelector(".historyEditCustomBtn").onclick = () => {
      addHistoryPlayedMap(state, mode, customInput.value);
    };

    section.querySelectorAll(".historyEditMapRow").forEach((row, index) => {

      const upBtn = row.querySelector(".historyEditUpBtn");
      const downBtn = row.querySelector(".historyEditDownBtn");
      const removeBtn = row.querySelector(".historyEditRemoveBtn");

      if(upBtn){
        upBtn.onclick = () => moveHistoryPlayedMap(state, mode, index, -1);
      }

      if(downBtn){
        downBtn.onclick = () => moveHistoryPlayedMap(state, mode, index, 1);
      }

      if(removeBtn){
        removeBtn.onclick = () => removeHistoryPlayedMap(state, mode, index);
      }

    });

  });

}

function addHistoryPlayedMap(state, mode, mapName){

  const cleanName = String(mapName || "").trim();

  if(!cleanName) return;

  const list = state.session[mode] || [];

  if(!list.includes(cleanName)){
    state.session[mode] = [...list, cleanName];
    markHistoryPlayedMapsDirty();
  }

  renderHistoryPlayedMapsEditor(state);

}

function moveHistoryPlayedMap(state, mode, index, direction){

  const list = [...(state.session[mode] || [])];
  const nextIndex = index + direction;

  if(nextIndex < 0 || nextIndex >= list.length) return;

  const [mapName] = list.splice(index, 1);
  list.splice(nextIndex, 0, mapName);

  state.session[mode] = list;
  markHistoryPlayedMapsDirty();
  renderHistoryPlayedMapsEditor(state);

}

function removeHistoryPlayedMap(state, mode, index){

  const list = [...(state.session[mode] || [])];
  list.splice(index, 1);

  state.session[mode] = list;
  markHistoryPlayedMapsDirty();
  renderHistoryPlayedMapsEditor(state);

}

function markHistoryPlayedMapsDirty(){
  historyPlayedMapsHasUnsavedChanges = true;
}

async function openHistoryPlayedMapsEditor(match){

  if(!isAdminUnlocked()){
    showModal("Unlock admin mode first.", "alert");
    return;
  }

  const modal = ensureHistoryPlayedMapsModal();
  const state = {
    selectedAt: match.selectedAt,
    session: getHistoryPlayedMapsFromMatch(match)
  };

  modal._historyPlayedMapsState = state;
  historyPlayedMapsHasUnsavedChanges = false;
  modal.style.display = "flex";

  renderHistoryPlayedMapsEditor(state);

  document.getElementById("saveHistoryPlayedMapsBtn").onclick = async () => {
    await saveHistoryPlayedMapsEditor(state);
  };

}

async function closeHistoryPlayedMapsEditor(force = false){

  const modal = document.getElementById("historyPlayedMapsModal");

  if(!modal) return;

  if(historyPlayedMapsHasUnsavedChanges && !force){
    const discard = await showModal(
      "You have unsaved played-map changes. Close without saving?",
      "confirm"
    );

    if(!discard) return;
  }

  historyPlayedMapsHasUnsavedChanges = false;
  modal.style.display = "none";

}

async function saveHistoryPlayedMapsEditor(state){

  const pass = await getAdminPassword();
  if(!pass) return;

  showBusy("SAVING PLAYED MAPS");

  try{

    const res = await api({
      action:"updateHistoryPlayedMaps",
      password:pass,
      selectedAt:state.selectedAt,
      session:state.session
    });

    if(!res || !res.ok){
      showModal((res && res.error) || "Could not save played maps.", "alert");
      return;
    }

    sessionStorage.setItem("adminPass", pass);
    updateAdminBar();
    historyPlayedMapsHasUnsavedChanges = false;
    closeHistoryPlayedMapsEditor(true);

    await loadHistoryRange(historyShowingAll);

    showModal(`Played maps saved. ${res.updatedCount || 0} history rows updated.`, "alert");

  }finally{

    hideBusy();

  }

}

function setupHistorySorting(){

  const headers = document.querySelectorAll("#historyTable th");

  headers.forEach(th => {

    th.onclick = () => {

      const key = th.dataset.sort;

      if(!key) return;

      // 🔥 TOGGLE DIRECTION
      if(currentHistorySort.key === key){
        currentHistorySort.direction =
          currentHistorySort.direction === "asc" ? "desc" : "asc";
      }else{
        currentHistorySort.key = key;
        currentHistorySort.direction = "asc";
      }

      // 🔥 RE-RENDER WITH SORT
      renderHistory([...matchHistory]);

      updateSortIndicators();

    };

  });

}

function updateSortIndicators(){

  const headers = document.querySelectorAll("#historyTable th");

  headers.forEach(th => {

    const key = th.dataset.sort;

    if(!key) return;

th.innerHTML = th.innerText
  .replace(" ↑", "")
  .replace(" ↓", "")
  .replace(" ⇅", "")
  .replace(" ▴▾", "")
  .replace(" ▲", "")
  .replace(" ▼", "");

if(key === currentHistorySort.key){

  const arrow = currentHistorySort.direction === "asc" ? " ▲" : " ▼";

  th.innerHTML = th.innerText + arrow;

} else {

  th.innerHTML = th.innerText + " ▴▾";

}

  });

}

function formatDate(date){

  const d = new Date(date);

  if(Number.isNaN(d.getTime())) return "";

  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).format(d);

}

document.getElementById("toggleHistoryRangeBtn").onclick = () => {
  loadHistoryRange(!historyShowingAll);
};

document.getElementById("clearHistoryBtn").onclick = clearHistory;

async function clearHistory(){

const pass = await getAdminPassword();
if(!pass) return;

  /* SHOW CLEARING OVERLAY */

  document.getElementById("clearHistoryOverlay").style.display = "flex";

  const data = await api({

    action:"clearHistory",

    password:pass

  });

if(!data.ok){

  document.getElementById("clearHistoryOverlay").style.display = "none";

  showModal(data.error, "alert");
  return;

}

// 🔥 ADD THIS
sessionStorage.setItem("adminPass", pass);
updateAdminBar();

/* CHANGE OVERLAY TEXT TO CLEARED */

const overlay = document.getElementById("clearHistoryOverlay");

overlay.querySelector("div:last-child").innerHTML = "CLEARED & SESSION RESET ✓";

/* WAIT THEN RESET UI */

setTimeout(async () => {

  overlay.style.display = "none";

  document.getElementById("historyTableBody").innerHTML = `
  <tr><td colspan="5">No match history yet.</td></tr>
`;

  /* 🔥 RESET GENERATOR STATE */
  resetGeneratedMatchups();
  lastSelectedPlayers = [];
  selectedMatchKey = null;

  /* 🔥 RESET MATCH MAKER */
  document.getElementById("matchMakerSelect").selectedIndex = 0;
  sessionStorage.removeItem("selectedMatchMaker");

  /* 🔥 RESET PLAYER CHECKBOXES (all checked) */
  document.querySelectorAll("#playersCheckboxes input").forEach(cb=>{
    cb.checked = true;
  });

  updateSelectedPlayerCount();

  /* 🔥 FORCE MATCHUP REFRESH */
  await loadInitialData();

  /* RESET TEXT BACK */

  overlay.querySelector("div:last-child").innerHTML = "CLEARING HISTORY<span class='dots'></span>";

}, 1000);

}

function startMatchAutoRefresh(){

  setInterval(async ()=>{

    try{

      const data = await api({
        action:"getCurrentMatchupData"
      });

      if(data.ok){

        renderMatchup(data.currentMatchup);

      }

    }catch(e){

      console.log("Auto refresh error");

    }

  },10000);

}

function generateMatchupsLocal(selectedPlayers, filterGap){

  const players = allPlayers.filter(p => selectedPlayers.includes(p.name));

  const size = Math.floor(players.length / 2);

const combos = getCombinationsLocal(players, size);

const results = [];

const seen = new Set();

combos.forEach(red => {

const blue = players.filter(p => !red.includes(p));

const redSkill = normalizeSkillValue(red.reduce((s,p)=>s+normalizeSkillValue(p.skill),0));
const blueSkill = normalizeSkillValue(blue.reduce((s,p)=>s+normalizeSkillValue(p.skill),0));

const gap = normalizeSkillValue(Math.abs(redSkill - blueSkill));

/* Hide matchups with skill gap greater than 4 */

if(gap >= 5) return;

/* Prevent mirrored duplicates */

const redNames = red.map(p=>p.name).sort().join(",");
const blueNames = blue.map(p=>p.name).sort().join(",");

const key1 = redNames + "|" + blueNames;
const key2 = blueNames + "|" + redNames;

if(seen.has(key1) || seen.has(key2)) return;

seen.add(key1);

/* CALCULATE PICK COUNT FROM LIGHTWEIGHT HISTORY COUNTS */

const pickCountKey = getMatchupPickCountKey(
  red.map(p=>p.name),
  blue.map(p=>p.name)
);

let pickCount = matchupPickCounts && matchupPickCounts[pickCountKey]
  ? matchupPickCounts[pickCountKey]
  : 0;

const redSorted = [...red].sort((a,b)=>a.name.localeCompare(b.name));
const blueSorted = [...blue].sort((a,b)=>a.name.localeCompare(b.name));

results.push({
  redTeam:redSorted,
  blueTeam:blueSorted,
  redSkill:redSkill,
  blueSkill:blueSkill,
  skillGap:gap,
  pickCount:pickCount
});

  });

  return results;

}

function getCombinationsLocal(arr,size){

  const result = [];

  function helper(start,combo){

    if(combo.length === size){
      result.push([...combo]);
      return;
    }

    for(let i=start;i<arr.length;i++){

      combo.push(arr[i]);
      helper(i+1,combo);
      combo.pop();

    }

  }

  helper(0,[]);
  return result;

}

function applyGapFilter(){

  const filter = document.querySelector('input[name="gapFilter"]:checked').value;

  let filtered = lastGeneratedMatchups;

  if(filter !== "all"){

    const gapValue = Number(filter);

    filtered = lastGeneratedMatchups.filter(m => getGapBucket(m.skillGap) === gapValue);

  }

/* 🔥 BLITZ FILTER (ONLY SHOW ADVANTAGED SMALL TEAM) */

if(blitzEnabled){

  filtered = filtered.filter(m => {

    const small =
      m.redTeam.length < m.blueTeam.length ? m.redTeam : m.blueTeam;

    const large =
      m.redTeam.length > m.blueTeam.length ? m.redTeam : m.blueTeam;

    /* if equal teams, ignore */
    if(m.redTeam.length === m.blueTeam.length) return false;

    const smallSkill = normalizeSkillValue(small.reduce((s,p)=>s+normalizeSkillValue(p.skill),0));
    const largeSkill = normalizeSkillValue(large.reduce((s,p)=>s+normalizeSkillValue(p.skill),0));

    return smallSkill > largeSkill;

  });

}

/* Restore normal sorting when BLITZ is OFF */

if(!blitzEnabled){

  filtered.sort((a,b)=>a.skillGap - b.skillGap);

}  
  
  renderGeneratedMatchups(filtered);

}

function updateSelectedPlayerCount(){

  const count = document.querySelectorAll("#playersCheckboxes input:checked").length;

  document.getElementById("selectedPlayerCount").innerText = count;

}

function updateGapCounts(){

  const radios = document.querySelectorAll('input[name="gapFilter"]');

// 🔥 USE FILTERED MATCHUPS IF BLITZ IS ENABLED
let source = lastGeneratedMatchups;

if(blitzEnabled){

  source = lastGeneratedMatchups.filter(m => {

    const small =
      m.redTeam.length < m.blueTeam.length ? m.redTeam : m.blueTeam;

    const large =
      m.redTeam.length > m.blueTeam.length ? m.redTeam : m.blueTeam;

    if(m.redTeam.length === m.blueTeam.length) return false;

    const smallSkill = normalizeSkillValue(small.reduce((s,p)=>s+normalizeSkillValue(p.skill),0));
    const largeSkill = normalizeSkillValue(large.reduce((s,p)=>s+normalizeSkillValue(p.skill),0));

    return smallSkill > largeSkill;

  });

}

const counts = {
  all: source.length,
  0: 0,
  1: 0,
  2: 0,
  3: 0,
  4: 0
};

source.forEach(m=>{
  const bucket = getGapBucket(m.skillGap);

  if(counts.hasOwnProperty(bucket)){
    counts[bucket]++;
  }
});

  radios.forEach(radio=>{

    const value = radio.value;

    const label = radio.parentElement;

if(value === "all"){

  label.childNodes[1].nodeValue = ` All options [${counts.all}]`;

  const isDisabled = counts.all === 0;

  radio.disabled = isDisabled;

  if(isDisabled){
    label.classList.add("disabled");
  }else{
    label.classList.remove("disabled");
  }

}else{

  label.childNodes[1].nodeValue = ` Difference ${value} [${counts[value]}]`;

  const isDisabled = counts[value] === 0;

  radio.disabled = isDisabled;

  if(isDisabled){
    label.classList.add("disabled");
  }else{
    label.classList.remove("disabled");
  }

}

  });

}

function resetGeneratedMatchups(){

  // Clear UI
  document.getElementById("generatedMatchups").innerHTML = "";

  // Reset stored data
  lastGeneratedMatchups = [];
  generatedMatchupSelectionPending = false;
  selectedMatchKey = null;

  // Disable radio buttons again
  document.querySelectorAll('input[name="gapFilter"]').forEach(r=>{
    r.disabled = true;
    r.checked = r.value === "all"; // reset to default
    r.parentElement.classList.add("disabled");
  });

/* 🔥 RESET + HIDE BLITZ */

const blitzToggle = document.getElementById("blitzToggle");
const blitzContainer = document.querySelector(".blitzToggle");

if(blitzToggle && blitzContainer){

  blitzToggle.checked = false;
  blitzEnabled = false;

  blitzContainer.classList.remove("show");

  setTimeout(()=>{
    blitzContainer.style.display = "none";
  },300);

}

}

function normalizeSessionData(data = {}){
  return {
    elimination: Array.isArray(data.elimination) ? data.elimination.filter(Boolean) : [],
    blitz: Array.isArray(data.blitz) ? data.blitz.filter(Boolean) : [],
    ctf: Array.isArray(data.ctf) ? data.ctf.filter(Boolean) : [],
    bonus: Array.isArray(data.bonus) ? data.bonus.filter(Boolean) : []
  };
}

function normalizeLastPlayedMaps(data = {}){
  return {
    elimination: data && data.elimination ? data.elimination : "",
    blitz: data && data.blitz ? data.blitz : "",
    ctf: data && data.ctf ? data.ctf : "",
    bonus: data && data.bonus ? data.bonus : ""
  };
}

function syncSessionStateFromResponse(data){
  currentSessionMaps = normalizeSessionData(data);
  currentSessionLastPlayed = normalizeLastPlayedMaps(data && data.lastPlayed);
}

function getActiveSessionMaps(){
  return customSessionActive
    ? normalizeSessionData(customSessionData)
    : normalizeSessionData(currentSessionMaps);
}

function markSessionProgressDirty(){

  if(!sessionProgressSnapshot){
    sessionProgressSnapshot = normalizeSessionData(currentSessionMaps);
  }

  sessionProgressHasUnsavedChanges = true;

}

function clearSessionProgressDirty(){

  sessionProgressHasUnsavedChanges = false;
  sessionProgressSnapshot = null;
  sessionProgressDraftMaps = null;
  sessionProgressSkippedMaps = {
    elimination: [],
    blitz: [],
    ctf: [],
    bonus: []
  };

}

function removeSessionMapLocally(mode, index){

  if(customSessionActive){
    const maps = normalizeSessionData(customSessionData);
    const list = [...(maps[mode] || [])];

    list.splice(index, 1);
    maps[mode] = list;

    customSessionData = maps;
    customSessionHasUnsavedChanges = true;
  }else{
    const maps = normalizeSessionData(sessionProgressDraftMaps || currentSessionMaps);
    const list = [...(maps[mode] || [])];
    const skippedMap = list[index];

    list.splice(index, 1);
    maps[mode] = list;

    if(skippedMap){
      const skippedMode = mode === "bonus" ? "elimination" : mode;

      sessionProgressSkippedMaps[skippedMode] = [
        ...(sessionProgressSkippedMaps[skippedMode] || []),
        skippedMap
      ].filter((mapName, mapIndex, source) => source.indexOf(mapName) === mapIndex);
    }

    sessionProgressDraftMaps = maps;
    markSessionProgressDirty();

    renderSessionMaps(sessionProgressDraftMaps);
    updateCustomMapHighlights();

    setTimeout(()=>{
      handleSessionHighlightUpdate();
    }, 50);

    return;
  }

  renderAllSessionViews();

}

function updateCustomSessionButtons(){

  const buildBtn = document.getElementById("buildCustomSessionBtn");
  const saveBtn = document.getElementById("saveCustomSessionBtn");
  const clearBtn = document.getElementById("clearCustomSessionBtn");
  const generateBtn = document.getElementById("generateSessionMapsBtn");
  const progressBtn = document.getElementById("saveSessionProgressBtn");
  const badge = document.getElementById("customSessionBadge");

  if(!buildBtn || !saveBtn || !clearBtn || !generateBtn || !progressBtn) return;

  if(customSessionActive){
    buildBtn.style.display = "none";
    saveBtn.style.display = "inline-flex";
    clearBtn.style.display = "inline-flex";
    generateBtn.style.display = "none";
    progressBtn.style.display = "none";
    if(badge) badge.classList.add("active");
  }else{
    buildBtn.style.display = "inline-flex";
    saveBtn.style.display = "none";
    clearBtn.style.display = "none";
    generateBtn.style.display = "inline-flex";
    progressBtn.style.display = "inline-flex";
    if(badge) badge.classList.remove("active");
  }

}

function renderAllSessionViews(){
  const activeSession = getActiveSessionMaps();

  renderSessionMaps(activeSession);
  renderUpcomingSessionCard(activeSession);
  updateCustomMapHighlights();

  setTimeout(()=>{
    handleSessionHighlightUpdate();
  }, 50);
}

function getCustomSessionLimit(mode){
  if(mode === "elimination") return 2;
  if(mode === "blitz") return 2;
  if(mode === "ctf") return 5;
  if(mode === "bonus") return 2;
  return 0;
}

function isMapSelectedInCustomSession(mode, mapName){
  if(mode === "elimination"){
    return (
      (customSessionData.elimination || []).includes(mapName) ||
      (customSessionData.bonus || []).includes(mapName)
    );
  }

  const list = customSessionData[mode] || [];
  return list.includes(mapName);
}

async function toggleCustomSessionMap(mode, mapName){

  if(!customSessionActive){
    return;
  }

  let targetMode = mode;

  if(mode === "elimination"){
    if((customSessionData.elimination || []).includes(mapName)){
      targetMode = "elimination";
    }else if((customSessionData.bonus || []).includes(mapName)){
      targetMode = "bonus";
    }else if((customSessionData.elimination || []).length >= getCustomSessionLimit("elimination")){
      targetMode = "bonus";
    }
  }

  const current = [...(customSessionData[targetMode] || [])];
  const existingIndex = current.indexOf(mapName);

  if(existingIndex !== -1){
    current.splice(existingIndex, 1);
  }else{
    const limit = getCustomSessionLimit(targetMode);

    if(current.length >= limit){
      const modeLabel =
        targetMode === "ctf" ? "CTF" :
        targetMode.charAt(0).toUpperCase() + targetMode.slice(1);

      await showModal(`${modeLabel} already has ${limit} maps selected.`, "alert");
      return;
    }

    current.push(mapName);
  }

  customSessionData = {
    ...customSessionData,
    [targetMode]: current
  };
  customSessionHasUnsavedChanges = true;

  renderAllSessionViews();

}

function updateCustomMapHighlights(){

  document.querySelectorAll(".mapMasterRow").forEach(row => {
    const mode = row.getAttribute("data-mode");
    const mapName = row.getAttribute("data-map-name");

    if(!mode || !mapName) return;

    row.classList.toggle("customMapSelectable", customSessionActive);
    row.classList.toggle(
      "customMapSelected",
      customSessionActive && isMapSelectedInCustomSession(mode, mapName)
    );

    row.classList.remove("customSelectedElimination", "customSelectedBlitz", "customSelectedCtf", "customSelectedBonus");

    if(customSessionActive && isMapSelectedInCustomSession(mode, mapName)){
      if(mode === "elimination") row.classList.add("customSelectedElimination");
      if(mode === "blitz") row.classList.add("customSelectedBlitz");
      if(mode === "ctf") row.classList.add("customSelectedCtf");
      if((customSessionData.bonus || []).includes(mapName)) row.classList.add("customSelectedBonus");
    }
  });

}

async function loadCustomSessionState(){

  const res = await api({
    action:"getCustomSession"
  });

  if(!res || !res.ok){
    console.log("Failed loading custom session");
    customSessionActive = false;
    customSessionHasUnsavedChanges = false;
    customSessionData = normalizeSessionData();
    return;
  }

  customSessionActive = false;
  customSessionHasUnsavedChanges = false;
  customSessionData = normalizeSessionData(res.session);

}

// 🔥 LOAD CURRENT SESSION MAPS
async function loadSessionMaps(){

const overlay = document.getElementById("mapListLoadingOverlay");

if(overlay){
  overlay.style.display = "flex";
}

  const sessionData = await api({
    action:"getSessionMaps"
  });

  if(!sessionData.ok){
    console.log("Failed loading session maps");
    return;
  }

  await loadCustomSessionState();
  syncSessionStateFromResponse(sessionData);

updateCustomSessionButtons();
renderAllSessionViews();

// 🔥 HIDE LOADER
if(overlay){
  overlay.style.display = "none";
}

}

// 🔥 RENDER SESSION MAPS
async function loadMapListTabData(){

  if(mapListLoaded || mapListLoadPromise){
    return mapListLoadPromise || Promise.resolve();
  }

  const overlay = document.getElementById("mapListLoadingOverlay");

  if(overlay){
    overlay.style.display = "flex";
  }

  mapListLoadPromise = api({
    action:"getMapListData"
  }).then(data => {

    if(!data || !data.ok){
      throw new Error("Failed loading map list");
    }

    globalMapList = normalizeSessionData(data.mapList || {});
    renderMasterMapList(globalMapList);
    updateCustomMapHighlights();

    setTimeout(()=>{
      handleSessionHighlightUpdate();
    }, 50);

    mapListLoaded = true;

  }).catch(err => {

    console.log(err);
    showModal("Could not load full map list.", "alert");

  }).finally(() => {

    if(overlay){
      overlay.style.display = "none";
    }

    mapListLoadPromise = null;

  });

  return mapListLoadPromise;

}

window.loadMapListTabData = loadMapListTabData;

function renderSessionMaps(data){

  // Keep legacy hidden lists updated for existing highlight logic
  renderModeSessionList("eliminationSessionList", data.elimination || [], "elimination");
  renderModeSessionList("blitzSessionList", data.blitz || [], "blitz");
  renderModeSessionList("ctfSessionList", data.ctf || [], "ctf");
  renderModeSessionList("bonusSessionList", data.bonus || [], "bonus");

  // Render new visible single-card layout
  renderUnifiedSessionMaps(data);

}

function renderUpcomingSessionCard(data){

  buildCopySessionCard(data, globalMapMatchMaker, {
    makerId: "upcomingSessionMaker",
    bodyId: "upcomingSessionBody"
  });

  renderMatchMakerRotationStrip(globalMapMatchMaker, "upcomingSessionMaker");

}

function getShortMatchMakerName(name){

  const clean = (name || "").trim();

  if(!clean) return "--";

  return clean.substring(0, 2).toUpperCase();

}

function renderMatchMakerRotationStrip(currentMaker, makerId = "upcomingSessionMaker"){

  const makerEl = document.getElementById(makerId);

  if(!makerEl) return;

  makerEl.classList.add("matchMakerInlineRow");

  const players = Array.isArray(allPlayers)
    ? allPlayers
      .filter(player => player.matchMaker !== false)
      .slice()
      .sort((a,b)=>a.name.localeCompare(b.name))
    : [];

  makerEl.innerHTML = "";

  if(players.length === 0){
    makerEl.textContent = "Match Maker: Not selected";
    return;
  }

  const label = document.createElement("span");
  label.className = "matchMakerInlineLabel";
  label.textContent = "Match Maker:";

  const strip = document.createElement("div");
  strip.className = "matchMakerRotationStrip";

  makerEl.appendChild(label);
  makerEl.appendChild(strip);

  const currentIndex = players.findIndex(player => player.name === currentMaker);

  players.forEach((player, index) => {

    const item = document.createElement("div");
    item.className = "matchMakerRotationItem";

    if(index === currentIndex){
      item.classList.add("current");
    }

    item.innerHTML = `
      <span class="rotationFullName">${player.name}</span>
      <span class="rotationShortName">${getShortMatchMakerName(player.name)}</span>
    `;

    strip.appendChild(item);

  });

}

// 🔥 RENDER SESSION MAPS
function renderUnifiedSessionMaps(data){

  const container = document.getElementById("sessionMapsUnifiedRows");

  if(!container) return;

  container.innerHTML = "";

  const sections = [
    {
      label: "Elimination",
      mode: "elimination",
      headerClass: "eliminationHeader",
      maps: data.elimination || []
    },
    {
      label: "Blitz",
      mode: "blitz",
      headerClass: "blitzHeader",
      maps: data.blitz || []
    },
    {
      label: "CTF",
      mode: "ctf",
      headerClass: "ctfHeader",
      maps: data.ctf || []
    },
    {
      label: "Bonus",
      mode: "bonus",
      headerClass: "bonusHeader",
      maps: data.bonus || []
    }
  ];

  sections.forEach((section, sectionIndex) => {

    const header = document.createElement("div");
    header.className = `sessionUnifiedHeader ${section.headerClass}`;

    if(sectionIndex === 0){
      header.classList.add("firstHeader");
    }

    header.textContent = section.label;
    container.appendChild(header);

    section.maps.forEach((mapName, index) => {

      if(!mapName) return;

     const row = document.createElement("div");
     row.className = "mapMasterRow sessionUnifiedRow";
      
     const masterMode = section.mode === "bonus" ? "elimination" : section.mode;
     const masterContainer = document.getElementById(masterMode + "MasterList");

let masterIndex = "";

if(masterContainer){
  const masterRows = Array.from(masterContainer.querySelectorAll(".mapMasterRow"));

  const foundIndex = masterRows.findIndex(r => r.innerText.trim() === mapName);

  if(foundIndex !== -1){
    masterIndex = foundIndex + 1;
  }
}

row.setAttribute("data-index", masterIndex);

     row.innerHTML = `
       <span class="sessionUnifiedName">${mapName}</span>
       <button class="mapDeleteMini">✕</button>
     `;

row.querySelector(".mapDeleteMini").onclick = async () => {

  if(!isAdminUnlocked()){
  showModal("Unlock admin mode first.", "alert");
  return;
}

  removeSessionMapLocally(section.mode, index);
  return;

  const pass = await getAdminPassword();
  if(!pass) return;

  showBusy("DELETING MAP");

  try{

  const res = await api({
    action:"deleteSessionMap",
    mode: section.mode,
    slot: index + 1,
    password: pass
  });

  if(!res.ok){
    showModal(res.error || "Delete failed", "alert");
    return;
  }

  // 🔥 ADD THIS
  sessionStorage.setItem("adminPass", pass);
  updateAdminBar();
  sessionProgressHasUnsavedChanges = true;

  renderSessionMaps(res);

  setTimeout(()=>{
    handleSessionHighlightUpdate();
  }, 50);

  }finally{

    hideBusy();

  }

};
      
      container.appendChild(row);

    });

  });

}

// 🔥 RENDER ONE MODE

function renderModeSessionList(containerId, maps, mode){

  const container = document.getElementById(containerId);

  if(!container) return;

  container.innerHTML = "";

  // 🔥 Create ONE compact card
  const card = document.createElement("div");
  card.className = "mapSessionCompactCard";

  maps.forEach((mapName, index) => {

    if(!mapName) return;

    const row = document.createElement("div");
    row.className = "mapSessionCompactRow";

    const masterMode = mode === "bonus" ? "elimination" : mode;
    const masterContainer = document.getElementById(masterMode + "MasterList");

let masterIndex = "";

if(masterContainer){
  const masterRows = Array.from(masterContainer.querySelectorAll(".mapMasterRow"));
  const foundIndex = masterRows.findIndex(row => row.innerText.trim() === mapName);
  
  if(foundIndex !== -1){
    masterIndex = foundIndex + 1;
  }
}
    
    row.innerHTML = `
      <span class="mapSessionName" data-index="${masterIndex}">
      ${mapName}
      </span>
      <button class="mapDeleteMini">✕</button>
    `;

row.querySelector(".mapDeleteMini").onclick = async () => {

  if(!isAdminUnlocked()){
  showModal("Unlock admin mode first.", "alert");
  return;
}

  removeSessionMapLocally(mode, index);
  return;

  const pass = await getAdminPassword();
  if(!pass) return;

  showBusy("DELETING MAP");

  try{

  const res = await api({
    action:"deleteSessionMap",
    mode: mode,
    slot: index + 1,
    password: pass
  });

  if(!res.ok){
    showModal(res.error || "Delete failed", "alert");
    return;
  }

  // 🔥 ADD THIS
  sessionStorage.setItem("adminPass", pass);
  updateAdminBar();
  sessionProgressHasUnsavedChanges = true;

  renderSessionMaps(res);

  setTimeout(()=>{
    handleSessionHighlightUpdate();
  }, 50);

  }finally{

    hideBusy();

  }

};
    
    card.appendChild(row);

  });

  // If empty
  if(card.children.length === 0){
    card.innerHTML = `<div class="mapSessionEmpty">—</div>`;
  }

  container.appendChild(card);

}

// 🔥 RENDER FULL MASTER MAP LIST
function renderMasterMapList(mapList){

  renderMasterModeList("eliminationMasterList", mapList.elimination || [], "elimination");
  renderMasterModeList("blitzMasterList", mapList.blitz || [], "blitz");
  renderMasterModeList("ctfMasterList", mapList.ctf || [], "ctf");

}

// 🔥 RENDER ONE MASTER MODE COLUMN
function renderMasterModeList(containerId, maps, mode){

  const container = document.getElementById(containerId);

  if(!container) return;

  container.innerHTML = "";

  maps.forEach((mapName, index) => {

    const row = document.createElement("div");
    row.className = "mapMasterRow";
    row.textContent = mapName;
    row.setAttribute("data-index", index + 1);
    row.setAttribute("data-mode", mode);
    row.setAttribute("data-map-name", mapName);

    row.onclick = async () => {
      await toggleCustomSessionMap(mode, mapName);
    };

    container.appendChild(row);

  });

}

// 🔥 BUTTON ACTIONS
function setupMapListButtons(){

  const generateBtn = document.getElementById("generateSessionMapsBtn");
  const saveBtn = document.getElementById("saveSessionProgressBtn");
  const clearSessionBtn = document.getElementById("clearSessionMapsBtn");
  const buildCustomBtn = document.getElementById("buildCustomSessionBtn");
  const saveCustomBtn = document.getElementById("saveCustomSessionBtn");
  const clearCustomBtn = document.getElementById("clearCustomSessionBtn");
  const copyBtn = document.getElementById("copySessionMapsBtn");

if(generateBtn){
  generateBtn.onclick = async () => {

    if(!isAdminUnlocked()){
  showModal("Unlock admin mode first.", "alert");
  return;
}

const pass = await getAdminPassword();
if(!pass) return;

    showBusy("GENERATING SESSION MAPS");

    try{

    const res = await api({
      action:"generateSessionMaps",
      password: pass
    });

    if(!res.ok){
      showModal(res.error || "Generate failed", "alert");
      return;
    }

    sessionStorage.setItem("adminPass", pass);
    updateAdminBar();
    clearSessionProgressDirty();
    sessionMapsNeedSelection = false;
    syncSessionStateFromResponse(res);

renderAllSessionViews();

/* 🔥 RE-RUN HIGHLIGHT AFTER GENERATE */
setTimeout(()=>{
  handleSessionHighlightUpdate();
}, 50);

    }finally{

      hideBusy();

    }

  };
}

if(saveBtn){
saveBtn.onclick = async () => {

  if(!isAdminUnlocked()){
  showModal("Unlock admin mode first.", "alert");
  return;
}

  const pass = await getAdminPassword();
  if(!pass) return;

  showBusy("SAVING SESSION PROGRESS");

  try{

  const res = await api({
    action:"saveSessionProgress",
    password: pass,
    session: sessionProgressDraftMaps || currentSessionMaps,
    skippedSessionMaps: sessionProgressSkippedMaps
  });

  if(!res.ok){
    showModal(res.error || "Save failed", "alert");
    return;
  }

  // 🔥 ADD THIS
  sessionStorage.setItem("adminPass", pass);
  updateAdminBar();
  clearSessionProgressDirty();
  syncSessionStateFromResponse(res);

  showModal("Session progress saved", "alert");

  renderAllSessionViews();
  handleSessionHighlightUpdate();

  }finally{

    hideBusy();

  }

};
}

if(clearSessionBtn){
  clearSessionBtn.onclick = async () => {

    if(!isAdminUnlocked()){
      showModal("Unlock admin mode first.", "alert");
      return;
    }

    if(customSessionActive){

      customSessionData = normalizeSessionData({
        elimination: [],
        blitz: [],
        ctf: [],
        bonus: []
      });
      customSessionHasUnsavedChanges = true;

      renderAllSessionViews();
      showModal("Custom session maps cleared", "alert");
      return;

    }

    const pass = await getAdminPassword();
    if(!pass) return;

    showBusy("CLEARING SESSION MAPS");

    try{

    const res = await api({
      action:"clearSessionMaps",
      password: pass
    });

    if(!res || !res.ok){
      showModal(res.error || "Clear session maps failed", "alert");
      return;
    }

    sessionStorage.setItem("adminPass", pass);
    updateAdminBar();
    clearSessionProgressDirty();
    sessionMapsNeedSelection = true;

    syncSessionStateFromResponse(res);
    renderAllSessionViews();

    showModal("Session maps cleared", "alert");

    }finally{

      hideBusy();

    }

  };
}

if(buildCustomBtn){
  buildCustomBtn.onclick = async () => {

    if(!isAdminUnlocked()){
      showModal("Unlock admin mode first.", "alert");
      return;
    }

    customSessionActive = true;
    customSessionHasUnsavedChanges = false;
    customSessionData = normalizeSessionData(currentSessionMaps);

    updateCustomSessionButtons();
    renderAllSessionViews();

    showModal("Custom session mode enabled", "alert");

  };
}

if(saveCustomBtn){
  saveCustomBtn.onclick = async () => {

    if(!isAdminUnlocked()){
      showModal("Unlock admin mode first.", "alert");
      return;
    }

    const pass = await getAdminPassword();
    if(!pass) return;

    showBusy("SAVING CUSTOM SESSION");

    try{

    const res = await api({
      action:"saveCustomSession",
      password: pass,
      session: customSessionData
    });

    if(!res || !res.ok){
      showModal(res.error || "Save custom session failed", "alert");
      return;
    }

    sessionStorage.setItem("adminPass", pass);
    updateAdminBar();

    customSessionActive = !!res.active;
    customSessionHasUnsavedChanges = false;
    clearSessionProgressDirty();
    sessionMapsNeedSelection = false;
    customSessionData = normalizeSessionData(res.session);
    currentSessionMaps = normalizeSessionData(res.sessionMaps || res.session);

    updateCustomSessionButtons();
    renderAllSessionViews();

    showModal("Custom session saved", "alert");

    }catch(err){

      showModal(
        getActionErrorMessage(err, "Save custom session failed."),
        "alert"
      );

    }finally{

      hideBusy();

    }

  };
}

if(clearCustomBtn){
  clearCustomBtn.onclick = async () => {

    if(!isAdminUnlocked()){
      showModal("Unlock admin mode first.", "alert");
      return;
    }

    const pass = await getAdminPassword();
    if(!pass) return;

    showBusy("EXITING CUSTOM SESSION");

    try{

    const res = await api({
      action:"clearCustomSession",
      password: pass
    });

    if(!res || !res.ok){
      showModal(res.error || "Clear custom session failed", "alert");
      return;
    }

    sessionStorage.setItem("adminPass", pass);
    updateAdminBar();

    customSessionActive = false;
    customSessionHasUnsavedChanges = false;
    customSessionData = normalizeSessionData(res.session);
    currentSessionMaps = normalizeSessionData(getActiveSessionMaps());

    updateCustomSessionButtons();
    renderAllSessionViews();

    showModal("Exited custom session", "alert");

    }finally{

      hideBusy();

    }

  };
}
  
if(copyBtn){
  copyBtn.onclick = async () => {

    const matchMaker = globalMapMatchMaker;

    const sessionData = getActiveSessionMaps();

    const copyCard = document.getElementById("copySessionCard");

    if(!copyCard){
      showModal("Copy card not found", "alert");
      return;
    }

    buildCopySessionCard(sessionData, matchMaker);

    copyCard.classList.add("show");
    showBusy("COPYING IMAGE");

    try{

      await new Promise(resolve => requestAnimationFrame(() => resolve()));

      const canvas = await html2canvas(copyCard, {
        backgroundColor: null,
        scale: 4,
        useCORS: true
      });

      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));

      if(!blob){
        throw new Error("Canvas export failed");
      }

      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob })
      ]);

      showModal("Session maps copied as image ✅", "alert");

    }catch(err){

      console.error(err);
      showModal("Copy image failed. Your browser may not support it.", "alert");

    }finally{

      copyCard.classList.remove("show");
      hideBusy();

    }

  };
}


}

function buildCopySessionCard(data, matchMaker, options = {}){

  const makerId = options.makerId || "copySessionMaker";
  const bodyId = options.bodyId || "copySessionBody";

  const makerEl = document.getElementById(makerId);
  const bodyEl = document.getElementById(bodyId);

  if(!makerEl || !bodyEl) return;

  renderMatchMakerRotationStrip(matchMaker, makerId);

  const sections = [
    {
      label: "Elimination",
      className: "eliminationHeader",
      maps: (data.elimination || []).filter(Boolean)
    },
    {
      label: "Blitz",
      className: "blitzHeader",
      maps: (data.blitz || []).filter(Boolean)
    },
    {
      label: "CTF",
      className: "ctfHeader",
      maps: (data.ctf || []).filter(Boolean)
    },
    {
      label: "Bonus",
      className: "bonusHeader",
      maps: (data.bonus || []).filter(Boolean)
    }
  ];

  bodyEl.innerHTML = sections.map(section => {
    const rows = section.maps.length
      ? section.maps.map(mapName => `
        <div class="copySessionRow">
          <span class="copySessionName">${mapName}</span>
        </div>
      `).join("")
      : `
        <div class="copySessionEmpty">-</div>
      `;

    return `
      <div class="copySessionSection">
        <div class="copySessionSectionHeader ${section.className}">${section.label}</div>
        <div class="copySessionRows">${rows}</div>
      </div>
    `;
  }).join("");

}

function handleSessionHighlightUpdate(){

  processMode("elimination", "eliminationSessionList", "eliminationMasterList");
  processMode("blitz", "blitzSessionList", "blitzMasterList");
  processMode("ctf", "ctfSessionList", "ctfMasterList");

}

function processMode(mode, sessionId, masterId){

  const sessionContainer = document.getElementById(sessionId);
  const masterContainer = document.getElementById(masterId);

  if(!sessionContainer || !masterContainer) return;

  // 🔥 get session maps
const sessionContainers = [sessionContainer];

if(mode === "elimination"){
  const bonusContainer = document.getElementById("bonusSessionList");

  if(bonusContainer){
    sessionContainers.push(bonusContainer);
  }
}

const sessionMaps = sessionContainers.flatMap(container =>
  Array.from(container.querySelectorAll(".mapSessionName"))
    .map(el => el.innerText.trim())
);

/* 🔥 ALWAYS CLEAR OLD HIGHLIGHTS FIRST */
masterContainer.querySelectorAll(".mapMasterRow").forEach(row=>{
  row.classList.remove("lastPlayedMap");
});

const savedLastPlayedMap = !customSessionActive && currentSessionLastPlayed
  ? currentSessionLastPlayed[mode]
  : "";

if(savedLastPlayedMap){
  masterContainer.querySelectorAll(".mapMasterRow").forEach(row => {
    if(row.innerText.trim() === savedLastPlayedMap){
      row.classList.add("lastPlayedMap");
    }
  });

  return;
}

/* 🔥 IF NO SESSION MAPS → STOP HERE (NO HIGHLIGHT) */
if(sessionMaps.length === 0) return;

  const firstMap = sessionMaps[0];

  // 🔥 get full map list
  const masterMaps = Array.from(
    masterContainer.querySelectorAll(".mapMasterRow")
  ).map(el => el.innerText.trim());

  const index = masterMaps.indexOf(firstMap);

  if(index === -1){
    return;
  }

  // 🔥 get previous (with wrap-around)
  const prevIndex = (index - 1 + masterMaps.length) % masterMaps.length;

  const prevMap = masterMaps[prevIndex];

  // 🔥 REMOVE OLD HIGHLIGHTS
masterContainer.querySelectorAll(".mapMasterRow").forEach(row=>{
  row.classList.remove("lastPlayedMap");
});

// 🔥 APPLY NEW HIGHLIGHT
const rows = masterContainer.querySelectorAll(".mapMasterRow");

rows.forEach(row => {
  if(row.innerText.trim() === prevMap){
    row.classList.add("lastPlayedMap");
  }
});

}
