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
	return require(channelListFiles[record.index]).ChannelList();
}

const channelList = getChannelListForToday();

var topLevelDomainList = null;
var play = false;
var intervalID = new Set();
var click = false;
var randomPlayTimeoutID = null;
var endCheckIntervalID = null;
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

function RandomPlay() {
	if (randomPlayTimeoutID !== null) {
		clearTimeout(randomPlayTimeoutID);
	}
	if (endCheckIntervalID !== null) {
		clearInterval(endCheckIntervalID);
		endCheckIntervalID = null;
	}
	clearPlayAllInterval('new cycle');
	play = false;
	click = false;

	const randomIndex = crypto.randomInt(channelList.length);
	const selectedUrl = channelList[randomIndex];
	log(`RandomPlay - index: ${randomIndex}, url: ${selectedUrl}`);

	const webViewTranslation = document.getElementById("webViewTranslation");
	const loadPromise = webViewTranslation.loadURL(selectedUrl);
	if (loadPromise && typeof loadPromise.then === 'function') {
		loadPromise.catch((err) => {
			log(`ERROR RandomPlay loadURL rejected - url: ${selectedUrl}, error: ${err && err.message ? err.message : err}`);
		});
	}

	randomPlayTimeoutID = setTimeout(() => {
		log(`RandomPlay 1-hour timer fired - exitAfterCurrentChannel: ${exitAfterCurrentChannel}`);
		if (exitAfterCurrentChannel) {
			log('quitting as scheduled instead of selecting the next channel');
			ipcRenderer.send('window-close');
			return;
		}
		RandomPlay();
	}, 3600000);
}

// Click a random video from the front portion of the watch-page playlist sidebar.
// divisor controls the slice: 20 = front 5%, 10 = front 10%.
function clickRandomFrontVideo(divisor) {
	const webViewTranslation = document.getElementById("webViewTranslation");
	webViewTranslation.executeJavaScript(
		"var elements = document.getElementsByClassName('yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer'); if (elements.length) { elements[Math.floor(Math.random() * (elements.length / " + divisor + "))].click(); }"
	);
}

// Detect when the first played video reaches its natural end, then pick a random front-5% video.
// Uses the standard HTML5 media API (more stable than YouTube's internal player API). Robust against
// playlist autoplay: a capture-phase 'ended' listener on the main player's <video> sets a sticky flag
// (media events do not bubble, so capture is required, and the flag survives the brief autoplay
// transition before the next video starts). A direct '#movie_player video'.ended read is the fallback
// for the already-ended case. Ad playback is excluded via the '.ad-showing' guard, and the listener is
// scoped to '#movie_player' so hover-preview/mini-player <video> elements do not trigger it. Polled from
// the host since the webview has no preload IPC bridge.
function startFirstVideoEndDetection() {
	const webViewTranslation = document.getElementById("webViewTranslation");
	const pollScript = "(function(){if(!window.__ytEndHook){window.__ytEndHook=true;window.__ytEnded=false;document.addEventListener('ended',function(e){var t=e.target;if(t&&t.tagName==='VIDEO'&&t.closest('#movie_player')&&!document.querySelector('.ad-showing')){window.__ytEnded=true;}},true);}if(window.__ytEnded)return true;var v=document.querySelector('#movie_player video');if(v&&v.ended&&!document.querySelector('.ad-showing'))return true;return false;})()";
	let handled = false;

	endCheckIntervalID = setInterval(() => {
		webViewTranslation.executeJavaScript(pollScript).then((ended) => {
			if (ended && !handled) {
				handled = true;
				if (endCheckIntervalID !== null) {
					clearInterval(endCheckIntervalID);
					endCheckIntervalID = null;
				}
				log('first video ended - selecting random front-5% video');
				clickRandomFrontVideo(20);
			}
		}).catch((err) => {
			log(`ERROR end-detection poll failed - error: ${err && err.message ? err.message : err}`);
		});
	}, 1000);
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

// Handle arrival on a YouTube watch page: stop the play-all click interval and start end detection.
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

	if (click == false) {
		click = true;
		startFirstVideoEndDetection();
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