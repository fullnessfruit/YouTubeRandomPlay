// Define log() before any require/top-level code so a module-load throw cannot leave later
// references in a TDZ state. `var` is used intentionally for hoist-safety.
var log;
try {
	const _fs = require('fs');
	const _path = require('path');
	const _logFile = _path.join(__dirname, 'debug.log');
	log = (msg) => { _fs.appendFileSync(_logFile, `[${new Date().toISOString()}] ${msg}\n`); };
}
catch (e) {
	log = () => {};
}

// Surface any uncaught renderer errors to debug.log
window.addEventListener('error', (event) => {
	log(`ERROR window error - msg: ${event.message}, src: ${event.filename}:${event.lineno}:${event.colno}, error: ${event.error && event.error.stack ? event.error.stack : event.error}`);
});
window.addEventListener('unhandledrejection', (event) => {
	log(`ERROR window unhandledrejection - reason: ${event.reason && event.reason.stack ? event.reason.stack : event.reason}`);
});

const punycode = require('punycode');
const crypto = require('crypto');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');
const tlds_alpha_by_domain = require('./tlds-alpha-by-domain.js');

const channelListFiles = [
	'./ChannelList.js',
	'./ChannelList_l_h.js',
	'./ChannelList_l_n.js',
	'./ChannelList_l_u.js'
];
const recordFilePath = path.join(__dirname, 'channel_record.json');

// Rotation and package.json identity are owned by main.js; it writes channel_record.json
// before the renderer starts. Here we just read the index it already committed.
function getChannelListForToday() {
	const record = JSON.parse(fs.readFileSync(recordFilePath, 'utf8'));
	return normalizeChannelList(require(channelListFiles[record.index]).ChannelList());
}

// Channel list entries are either a plain URL string or [url, waitForVideoEnd]. A plain string means
// waitForVideoEnd = false. Normalized to { url, waitForVideoEnd } so the rest of the code sees one shape.
function normalizeChannelList(entries) {
	const normalized = [];
	entries.forEach((entry, i) => {
		if (typeof entry === 'string') {
			normalized.push({ url: entry, waitForVideoEnd: false });
		}
		else if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'boolean') {
			normalized.push({ url: entry[0], waitForVideoEnd: entry[1] });
		}
		else {
			log(`WARN invalid channel list entry skipped - index: ${i}, entry: ${JSON.stringify(entry)}`);
		}
	});
	return normalized;
}

const channelList = getChannelListForToday();

// Playback monitor thresholds
const PLAYBACK_MONITOR_INTERVAL_MS = 1000;
const PLAYBACK_STALL_MS = 60000;

var topLevelDomainList = null;
var play = false;
var intervalID = new Set();
var randomPlayTimeoutID = null;
var monitorIntervalID = null;
var currentEntry = null;
var currentListId = null;
var pendingSwitchVideoId = null;
var lastPoll = null;
var lastNavigatedUrl = null;
var sameUrlNavCount = 0;
var exitAfterCurrentChannel = false;

function OnBodyLoad() {
	const webViewTranslation = document.getElementById("webViewTranslation");

	document.getElementById("textBoxAddress").addEventListener("keydown", OnTextBoxAddressKeyDown);
	webViewTranslation.addEventListener("did-navigate", OnWebViewTranslationDidNavigate);
	webViewTranslation.addEventListener("did-navigate-in-page", OnWebViewTranslationDidNavigateInPage);
	webViewTranslation.addEventListener("did-frame-finish-load", OnWebViewTranslationDidFrameFinishLoad);
	webViewTranslation.addEventListener("crashed", () => {
		log('WARN webview crashed - restarting RandomPlay');
		RandomPlay();
	});

	document.getElementById("exitAfterBtn").addEventListener("click", OnExitAfterBtnClick);
	document.getElementById("pipEnterBtn").addEventListener("click", () => { ipcRenderer.send('toggle-pip'); });
	document.getElementById("pipExitBtn").addEventListener("click", () => { ipcRenderer.send('toggle-pip'); });
	document.getElementById("pipCloseBtn").addEventListener("click", () => { ipcRenderer.send('window-close'); });
	document.getElementById("minBtn").addEventListener("click", () => { ipcRenderer.send('window-minimize'); });
	document.getElementById("maxBtn").addEventListener("click", () => { ipcRenderer.send('window-maximize'); });
	document.getElementById("closeBtn").addEventListener("click", () => { ipcRenderer.send('window-close'); });

	ipcRenderer.on('pip-changed', (event, isPip) => {
		document.body.classList.toggle('pip-mode', isPip);
	});

	// TLD list is bundled as tlds-alpha-by-domain.js to avoid fetching it from the network every time
	topLevelDomainList = tlds_alpha_by_domain.TLDsAlphaByDomain();

	setTimeout(() => {
		RandomPlay();
	}, 10);
}

// Arm or disarm a quit for the end of the current channel hour. The flag is only read when the
// RandomPlay 1-hour timer fires, so toggling it never interrupts the channel that is playing, and it
// survives a mid-cycle RandomPlay restart (crash recovery) because RandomPlay does not reset it.
function OnExitAfterBtnClick() {
	exitAfterCurrentChannel = !exitAfterCurrentChannel;
	document.getElementById("exitAfterBtn").classList.toggle('active', exitAfterCurrentChannel);
	log(`exit-after-current-channel toggled - enabled: ${exitAfterCurrentChannel}`);
}

// Clear the play-all click interval. Called both on watch-page arrival (goal reached) and at the start
// of RandomPlay, because a cycle that never reaches a watch page would otherwise leak its interval into
// the next cycle and keep clicking alongside the newly created one.
function clearPlayAllInterval(reason) {
	if (intervalID.size === 0) {
		return;
	}
	log(`play-all interval cleared - reason: ${reason}, intervals: ${intervalID.size}`);
	for (const i of intervalID) {
		clearInterval(i);
	}
	intervalID.clear();
}

function stopPlaybackMonitor() {
	if (monitorIntervalID !== null) {
		clearInterval(monitorIntervalID);
		monitorIntervalID = null;
	}
}

function RandomPlay() {
	if (randomPlayTimeoutID !== null) {
		clearTimeout(randomPlayTimeoutID);
	}
	stopPlaybackMonitor();
	clearPlayAllInterval('new cycle');
	play = false;
	pendingSwitchVideoId = null;
	lastPoll = null;

	const randomIndex = crypto.randomInt(channelList.length);
	currentEntry = channelList[randomIndex];
	const selectedUrl = currentEntry.url;
	try {
		currentListId = new URL(selectedUrl).searchParams.get('list');
	}
	catch {
		currentListId = null;
	}
	log(`RandomPlay - index: ${randomIndex}, url: ${selectedUrl}, waitForVideoEnd: ${currentEntry.waitForVideoEnd}`);

	const webViewTranslation = document.getElementById("webViewTranslation");
	const loadPromise = webViewTranslation.loadURL(selectedUrl);
	if (loadPromise && typeof loadPromise.then === 'function') {
		loadPromise.catch((err) => {
			log(`ERROR RandomPlay loadURL rejected - url: ${selectedUrl}, error: ${err && err.message ? err.message : err}`);
		});
	}

	randomPlayTimeoutID = setTimeout(OnChannelHourElapsed, 3600000);
}

// The channel hour is over. Entries flagged waitForVideoEnd let the video that is playing right now
// finish first; the playback monitor then calls endChannel() once that video id changes or ends.
function OnChannelHourElapsed() {
	randomPlayTimeoutID = null;
	const playingVideoId = lastPoll && lastPoll.onCycleWatch && !lastPoll.ended ? lastPoll.videoId : null;
	log(`RandomPlay 1-hour timer fired - exitAfterCurrentChannel: ${exitAfterCurrentChannel}, waitForVideoEnd: ${currentEntry.waitForVideoEnd}, playingVideoId: ${playingVideoId}`);
	if (currentEntry.waitForVideoEnd && playingVideoId && monitorIntervalID !== null) {
		pendingSwitchVideoId = playingVideoId;
		log(`channel switch deferred until current video ends - videoId: ${playingVideoId}`);
		return;
	}
	endChannel('hour elapsed');
}

// End the current channel at its scheduled point (hour elapsed, or the deferred video ended/stalled):
// quit if armed, otherwise start the next channel.
function endChannel(reason) {
	log(`channel ended - reason: ${reason}, exitAfterCurrentChannel: ${exitAfterCurrentChannel}`);
	if (exitAfterCurrentChannel) {
		stopPlaybackMonitor();
		log('quitting as scheduled instead of selecting the next channel');
		ipcRenderer.send('window-close');
		return;
	}
	RandomPlay();
}

// Click a random video from the front portion of the watch-page playlist sidebar.
// divisor controls the slice: 20 = front 5%, 10 = front 10%. Video ids in excludeVideoIds (optional) are
// never picked; if the front slice holds no other video, the whole panel is used instead.
// Return the click result so callers can retry when the sidebar has not rendered yet. Repeated failures
// are logged on the first attempt and every 30th attempt; successful clicks are always logged.
function clickRandomFrontVideo(divisor, excludeVideoIds, attempt = 1) {
	const exclude = excludeVideoIds || [];
	const webViewTranslation = document.getElementById("webViewTranslation");
	const script = "(function(divisor,exclude){var all=Array.prototype.slice.call(document.getElementsByClassName('yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer'));if(!all.length)return {count:0,href:null};var ok=function(e){try{return exclude.indexOf(new URL(e.href).searchParams.get('v'))<0;}catch(x){return true;}};var c=all.slice(0,Math.ceil(all.length/divisor)).filter(ok);if(!c.length)c=all.filter(ok);if(!c.length)return {count:all.length,href:null};var el=c[Math.floor(Math.random()*c.length)];el.click();return {count:all.length,href:el.href};})(" + divisor + "," + JSON.stringify(exclude) + ")";
	return webViewTranslation.executeJavaScript(script).then((result) => {
		if (attempt === 1 || attempt % 30 === 0 || (result && result.href)) {
			log(`random video click - divisor: ${divisor}, exclude: ${exclude.join('|')}, panelCount: ${result ? result.count : null}, href: ${result ? result.href : null}, attempt: ${attempt}`);
		}
		return result;
	}).catch((err) => {
		if (attempt === 1 || attempt % 30 === 0) {
			log(`ERROR random video click failed - attempt: ${attempt}, error: ${err && err.message ? err.message : err}`);
		}
		return null;
	});
}

// Poll script for the playback monitor. Uses the standard HTML5 media API for progress/end. There is no
// media-API signal for "scheduled live, not started yet", so upcoming-live is detected two ways: the
// player's getPlayerResponse() (videoDetails.isUpcoming or playability status LIVE_STREAM_OFFLINE), and a
// rendered '#movie_player .ytp-offline-slate' (the countdown screen or collapsed offline message).
// The slate is only counted when it has a layout box, since a hidden slate may stay in the DOM.
// First-video end: a capture-phase 'ended' listener on the main player's <video> sets a sticky flag (media
// events do not bubble, so capture is required, and the flag survives the brief autoplay transition). The
// listener is scoped to '#movie_player' so hover-preview/mini-player <video> elements do not trigger it,
// and ad endings are excluded via '.ad-showing'.
const playbackPollScript = "(function(){if(!window.__ytEndHook){window.__ytEndHook=true;window.__ytEnded=false;document.addEventListener('ended',function(e){var t=e.target;if(t&&t.tagName==='VIDEO'&&t.closest('#movie_player')&&!document.querySelector('.ad-showing')){window.__ytEnded=true;}},true);}var p=document.getElementById('movie_player');var v=document.querySelector('#movie_player video');var r=null;try{r=p&&p.getPlayerResponse?p.getPlayerResponse():null;}catch(x){}var vd=r&&r.videoDetails;var ps=r&&r.playabilityStatus;return {endedFlag:!!window.__ytEnded,ended:!!(v&&v.ended),ad:!!document.querySelector('.ad-showing'),time:v?v.currentTime:-1,paused:v?v.paused:null,respVideoId:vd?vd.videoId:null,upcoming:!!(vd&&vd.isUpcoming)||!!(ps&&ps.status==='LIVE_STREAM_OFFLINE'),status:ps?ps.status:null,slate:(function(){var s=document.querySelector('#movie_player .ytp-offline-slate');return !!(s&&s.getClientRects().length);})()};})()";

// Single 1s poller that runs from watch-page arrival until the next RandomPlay. Responsibilities:
// 1. First video reaches its natural end -> random front-5% video (once per cycle).
// 2. Current video is an upcoming/offline live stream on any playlist watch page -> random other video.
//    Exclude every detected id, but mark it handled only after a click succeeds; retry failed picks.
// 3. No playback progress on this cycle's playlist for PLAYBACK_STALL_MS -> next channel early. When a
//    quit is armed, it neither quits nor switches: it holds until the 1-hour timer quits as scheduled.
// 4. Deferred hour-end switch (waitForVideoEnd) -> endChannel once the pending video changes or ends.
// First-video end, stall and deferral only count while the webview is on a watch page of this cycle's
// playlist, so a manual navigation from the address bar never triggers an early channel switch.
function startPlaybackMonitor() {
	const webViewTranslation = document.getElementById("webViewTranslation");
	let firstVideoHandled = false;
	const upcomingVideoIds = new Set();
	const skippedUpcomingVideoIds = new Set();
	let upcomingSkipAttempts = 0;
	let lastProgressAt = Date.now();
	let lastVideoId = null;
	let lastTime = null;
	let stallHoldLogged = false;
	let busy = false;

	const intervalId = setInterval(() => {
		if (busy) {
			return;
		}
		busy = true;
		webViewTranslation.executeJavaScript(playbackPollScript).then(async (state) => {
			if (monitorIntervalID !== intervalId || !state) {
				return;
			}
			const now = Date.now();
			let url = null;
			try {
				url = new URL(webViewTranslation.getURL());
			}
			catch {
			}
			const videoId = url ? url.searchParams.get('v') : null;
			const playlistId = url && url.pathname === '/watch' && videoId ? url.searchParams.get('list') : null;
			const onCycleWatch = !!(playlistId && currentListId && playlistId === currentListId);
			lastPoll = { onCycleWatch: onCycleWatch, videoId: videoId, ended: state.ended };

			if (!onCycleWatch || state.ad || videoId !== lastVideoId || state.time !== lastTime) {
				lastProgressAt = now;
				stallHoldLogged = false;
			}
			if (videoId !== lastVideoId) {
				upcomingSkipAttempts = 0;
			}
			lastVideoId = videoId;
			lastTime = state.time;

			if (pendingSwitchVideoId !== null && (!onCycleWatch || videoId !== pendingSwitchVideoId || state.ended)) {
				log(`deferred channel switch - pendingVideoId: ${pendingSwitchVideoId}, currentVideoId: ${videoId}, ended: ${state.ended}, onCycleWatch: ${onCycleWatch}`);
				pendingSwitchVideoId = null;
				endChannel('deferred video ended');
				return;
			}

			// The slate and player response can both belong to the previous video during SPA navigation.
			// Use the visible slate alone only when the response has no video id to compare.
			const responseMatches = state.respVideoId === videoId;
			const upcoming = (state.upcoming && responseMatches) || (state.slate && (!state.respVideoId || responseMatches));
			// This also applies to manually opened playlists. Keep exclusions separate from successful skips:
			// the offline screen may appear before the sidebar. Failed picks retry without resetting the stall
			// timer, so an empty/unavailable playlist still reaches the existing stall/quit handling.
			if (playlistId && upcoming && !skippedUpcomingVideoIds.has(videoId)) {
				if (!upcomingVideoIds.has(videoId)) {
					upcomingVideoIds.add(videoId);
					lastProgressAt = now;
					log(`upcoming live detected - videoId: ${videoId}, listId: ${playlistId}, onCycleWatch: ${onCycleWatch}, respUpcoming: ${state.upcoming}, respVideoId: ${state.respVideoId}, slate: ${state.slate}, status: ${state.status}, selecting another random video`);
				}
				const result = await clickRandomFrontVideo(20, Array.from(upcomingVideoIds), ++upcomingSkipAttempts);
				if (monitorIntervalID !== intervalId) {
					return;
				}
				if (result && result.href) {
					skippedUpcomingVideoIds.add(videoId);
					return;
				}
				if (webViewTranslation.getURL() !== url.href) {
					return;
				}
			}

			if (!onCycleWatch) {
				return;
			}

			if (!upcoming && !firstVideoHandled && (state.endedFlag || (state.ended && !state.ad))) {
				firstVideoHandled = true;
				log('first video ended - selecting random front-5% video');
				clickRandomFrontVideo(20, Array.from(upcomingVideoIds));
				return;
			}

			if (now - lastProgressAt >= PLAYBACK_STALL_MS) {
				const stallInfo = `videoId: ${videoId}, time: ${state.time}, paused: ${state.paused}, ended: ${state.ended}, status: ${state.status}, upcoming: ${state.upcoming}, slate: ${state.slate}, stalledMs: ${now - lastProgressAt}`;
				if (pendingSwitchVideoId !== null) {
					// The hour is already over; the stall only ends the wait for the current video.
					log(`playback stalled - ending deferred channel - ${stallInfo}`);
					pendingSwitchVideoId = null;
					endChannel('deferred video stalled');
				}
				else if (exitAfterCurrentChannel) {
					// A quit is armed: keep the channel until the 1-hour timer quits on schedule. Logged once per
					// stall episode. If the quit is disarmed while still stalled, the next poll switches channel.
					if (!stallHoldLogged) {
						stallHoldLogged = true;
						log(`playback stalled - holding until scheduled quit - ${stallInfo}`);
					}
				}
				else {
					log(`playback stalled - switching channel early - ${stallInfo}`);
					RandomPlay();
				}
			}
		}).catch((err) => {
			log(`ERROR playback monitor poll failed - error: ${err && err.message ? err.message : err}`);
		}).finally(() => {
			busy = false;
		});
	}, PLAYBACK_MONITOR_INTERVAL_MS);
	monitorIntervalID = intervalId;
	log(`playback monitor started - listId: ${currentListId}, stallMs: ${PLAYBACK_STALL_MS}`);
}

async function OnTextBoxAddressKeyDown(event) {
	const IP_AND_PORT_COUNT = 2;
	const IPv4_NUMBER_COUNT = 4;
	const HTTPS_PORT = 443;

	if (event.keyCode != 13) {
		return;
	}

	const textBoxAddressValue = document.getElementById("textBoxAddress").value.trim();

	// Empty input
	if (!textBoxAddressValue) {
		return;
	}

	const webViewTranslation = document.getElementById("webViewTranslation");

	try {
		// Try loading as a complete URI
		await webViewTranslation.loadURL(textBoxAddressValue);
	}
	catch {
		try {
			// Leading '?' means treat the rest as a Google search query
			if (textBoxAddressValue.startsWith("?")) {
				await webViewTranslation.loadURL("https://www.google.com/search?q=" + encodeURIComponent(textBoxAddressValue.substring(1).trimStart()));
				return;
			}

			// Assume HTTP protocol and extract the domain part
			var url = new URL("http://" + textBoxAddressValue);
			var hostAndPort = url.host.split(':');
			var lastIndexOfColon = url.host.lastIndexOf(':');
			var domain;
			var port = hostAndPort[hostAndPort.length - 1];
			var portValid16BitInteger = false;

			if (lastIndexOfColon == -1)
			{
				domain = url.host.split('.');
			}
			else
			{
				var value = Math.floor(Number(port));
	
				if (value !== Infinity && String(value) === port && value >= 0 && value < 65536)
				{
					if (value == HTTPS_PORT)
					{
						url = new URL("https://" + textBoxAddressValue);
					}
					domain = url.host.substring(0, lastIndexOfColon).split('.');
					portValid16BitInteger = true;
				}
				else
				{
					domain = url.host.split('.');
					portValid16BitInteger = false;
				}
			}

			// Handle host as IPv4 or IPv4:port
			if (hostAndPort.length <= IP_AND_PORT_COUNT)
			{
				var valid16BitInteger = true;

				if (hostAndPort.length == IP_AND_PORT_COUNT)
				{
					if (portValid16BitInteger)
					{
						valid16BitInteger = true;
					}
					else
					{
						valid16BitInteger = false;
					}
				}
				
				if (valid16BitInteger)
				{
					var ip = hostAndPort[0];
					var ipNumberList = ip.split('.');

					if (ipNumberList.length == IPv4_NUMBER_COUNT)
					{
						var allValid8BitInteger = true;

						for (var i = 0; i < ipNumberList.length; i++)
						{
							var value = Math.floor(Number(ipNumberList[i]));

							if (value !== Infinity && String(value) === ipNumberList[i] && value >= 0 && value < 256)
							{
								continue;
							}

							allValid8BitInteger = false;
							break;
						}

						if (allValid8BitInteger)
						{
							await webViewTranslation.loadURL(url.href);
							return;
						}
					}
				}
			}

			// If the last part of the domain matches a known TLD, treat the input as an HTTP URI. TLDs are checked directly since new ones can be added at any time.
			if (Array.isArray(topLevelDomainList)) {
				// Internationalized domains may need Punycode encoding
				// Using https://github.com/bestiejs/punycode.js (MIT license)
				// var punycodeDomain = punycode.encode(domain[domain.length - 1]);
				var punycodeDomain = domain[domain.length - 1];

				for (var i = 0; i < topLevelDomainList.length; i++) {
					// Skip the header line in the TLD list
					if (topLevelDomainList[i].trimStart().startsWith("#")) {
						continue;
					}

					if (topLevelDomainList[i].toUpperCase() === punycodeDomain.toUpperCase()) {
						await webViewTranslation.loadURL(url.href);
						return;
					}
				}
			}

			// Always attempt async DNS lookup (covers custom nameserver/domain setups). Run a Google search concurrently to avoid perceived delay when the input is actually a search query.
			TryAsURI(url);
			try {
				await webViewTranslation.loadURL("https://www.google.com/search?q=" + encodeURIComponent(textBoxAddressValue));
			}
			catch {
			}
		}
		catch {
			// Fallback: URL construction or Punycode encoding failed, so treat input as a search query
			try {
				await webViewTranslation.loadURL("https://www.google.com/search?q=" + encodeURIComponent(textBoxAddressValue));
			}
			catch {
			}
		}
	}
}

// Log each top-level webview navigation to debug.log. Tracks consecutive identical URLs so an
// infinite same-video reload loop shows up as a rising count rather than indistinguishable lines.
function logNavigation(kind) {
	const url = document.getElementById("webViewTranslation").getURL();
	if (url === lastNavigatedUrl) {
		sameUrlNavCount++;
		log(`repeated navigation - kind: ${kind}, count: ${sameUrlNavCount}, url: ${url}`);
	} else {
		lastNavigatedUrl = url;
		sameUrlNavCount = 1;
		log(`navigation - kind: ${kind}, url: ${url}`);
	}
}

// Clicks the play-all button and reports page state back to the host. The returned fields exist purely
// for diagnosing cycles that never reach a watch page: `found` tells whether the button was present at
// all, while readyState / header / videos / title distinguish "page still rendering" from "playlist
// unavailable or empty" (an unavailable playlist shows in the title).
const playAllClickScript = "(function(){var els=document.querySelectorAll('ytd-playlist-header-renderer .play-button a');for(var i=0;i<els.length;i++){els[i].click();}return {found:els.length,ready:document.readyState,header:!!document.querySelector('ytd-playlist-header-renderer'),videos:document.getElementsByTagName('ytd-playlist-video-renderer').length,title:document.title};})()";

function OnWebViewTranslationDidNavigate() {
	const webViewTranslation = document.getElementById("webViewTranslation");

	document.getElementById("textBoxAddress").value = webViewTranslation.getURL();
	logNavigation('did-navigate');
	webViewTranslation.setAudioMuted(true);
	// Match the create button by its localized aria-label to avoid hiding the avatar button area
	webViewTranslation.insertCSS('ytd-topbar-logo-renderer, ytd-masthead button[aria-label="作成"], ytd-masthead button[aria-label="Create"], ytd-masthead button[aria-label="만들기"] { display: none !important; }');

	if (play == false) {
		let attempt = 0;
		intervalID.add(setInterval(() => {
			attempt++;
			// Log the first attempt, the attempt that finds the button, and then every 30th failing
			// attempt. Enough to diagnose a stuck cycle without writing a line every second for hours.
			webViewTranslation.executeJavaScript(playAllClickScript).then((info) => {
				if (!info) {
					log(`WARN play-all attempt returned no info - n: ${attempt}, url: ${webViewTranslation.getURL()}`);
					return;
				}
				if (attempt === 1 || info.found > 0 || attempt % 30 === 0) {
					log(`play-all attempt - n: ${attempt}, found: ${info.found}, ready: ${info.ready}, header: ${info.header}, videos: ${info.videos}, url: ${webViewTranslation.getURL()}, title: ${info.title}`);
				}
			}).catch((err) => {
				log(`ERROR play-all attempt failed - n: ${attempt}, url: ${webViewTranslation.getURL()}, error: ${err && err.message ? err.message : err}`);
			});
		}, 1000));
		play = true;
	}
}

// Handle arrival on a YouTube watch page: stop the play-all click interval and start the playback monitor.
// Must run for in-page (SPA) transitions too. The playlist to watch transition frequently happens as a
// history navigation, which does not fire did-frame-finish-load, so handling it only there left the 1s
// play-all interval running and it kept reloading the same video once per second.
function handleWatchPageReached() {
	const webViewTranslation = document.getElementById("webViewTranslation");

	if (play == false) {
		return;
	}
	if (!webViewTranslation.getURL().startsWith("https://www.youtube.com/watch?")) {
		return;
	}

	clearPlayAllInterval('watch page reached');

	if (monitorIntervalID === null) {
		startPlaybackMonitor();
	}
}

function OnWebViewTranslationDidNavigateInPage() {
	const webViewTranslation = document.getElementById("webViewTranslation");

	document.getElementById("textBoxAddress").value = webViewTranslation.getURL();
	logNavigation('did-navigate-in-page');
	handleWatchPageReached();
}

function OnWebViewTranslationDidFrameFinishLoad() {
	handleWatchPageReached();
}

// Async DNS lookup on the domain; if it resolves, load the page.
// Uses dns.lookup (OS resolver) rather than dns.resolve (direct nameserver query) so the check matches
// what the webview can actually load, including hosts-file entries. url.hostname (not url.host) is used
// because host carries the port, which breaks the lookup.
async function TryAsURI(url) {
	try {
		const webViewTranslation = document.getElementById("webViewTranslation");

		await dns.promises.lookup(url.hostname);
		await webViewTranslation.loadURL(url.href);
	}
	catch (e) {
		log(`TryAsURI lookup failed - host: ${url.hostname}, error: ${e && e.message ? e.message : e}`);
	}
}
