const punycode = require('punycode');
const crypto = require('crypto');
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

function getChannelListForToday() {
	var record = { date: null, index: -1 };

	try {
		record = JSON.parse(fs.readFileSync(recordFilePath, 'utf8'));
	}
	catch {
	}

	var today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

	if (record.date === today) {
		// Already recorded today — use the same index
		return require(channelListFiles[record.index]).ChannelList();
	}

	// First run today — advance to the next index
	var nextIndex = (record.index + 1) % channelListFiles.length;

	fs.writeFileSync(recordFilePath, JSON.stringify({ date: today, index: nextIndex }), 'utf8');

	return require(channelListFiles[nextIndex]).ChannelList();
}

const channelList = getChannelListForToday();

const logFile = path.join(__dirname, 'debug.log');
function log(msg) {
	fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
}

var topLevelDomainList = null;
var play = false;
var intervalID = new Set();
var click = false;
var randomPlayTimeoutID = null;

function OnBodyLoad() {
	const webViewTranslation = document.getElementById("webViewTranslation");

	document.getElementById("textBoxAddress").addEventListener("keydown", OnTextBoxAddressKeyDown);
	webViewTranslation.addEventListener("did-navigate", OnWebViewTranslationDidNavigate);
	webViewTranslation.addEventListener("did-navigate-in-page", OnWebViewTranslationDidNavigateInPage);
	webViewTranslation.addEventListener("did-frame-finish-load", OnWebViewTranslationDidFrameFinishLoad);
	webViewTranslation.addEventListener("crashed", () => {
		log('⚠️ webview crashed - restarting RandomPlay');
		RandomPlay();
	});

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

function RandomPlay() {
	if (randomPlayTimeoutID !== null) {
		clearTimeout(randomPlayTimeoutID);
	}
	play = false;
	click = false;
	document.getElementById("webViewTranslation").loadURL(channelList[crypto.randomInt(channelList.length)]);

	randomPlayTimeoutID = setTimeout(() => {
		RandomPlay();
	}, 3600000);
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
			// Fallback: URL construction or Punycode encoding failed — treat input as a search query
			try {
				await webViewTranslation.loadURL("https://www.google.com/search?q=" + encodeURIComponent(textBoxAddressValue));
			}
			catch {
			}
		}
	}
}

function OnWebViewTranslationDidNavigate() {
	const webViewTranslation = document.getElementById("webViewTranslation");

	document.getElementById("textBoxAddress").value = webViewTranslation.getURL();
	webViewTranslation.setAudioMuted(true);
	webViewTranslation.insertCSS('ytd-topbar-logo-renderer, ytd-button-renderer.style-scope.ytd-masthead { display: none !important; }');

	if (play == false) {
		intervalID.add(setInterval(() => {
			webViewTranslation.executeJavaScript("var elements = document.getElementsByClassName('yt-spec-button-shape-next yt-spec-button-shape-next--filled yt-spec-button-shape-next--overlay yt-spec-button-shape-next--size-m yt-spec-button-shape-next--icon-leading'); for (var i = 0; i < elements.length; i++) { elements[i].click(); }");
		}, 1000));
		play = true;
	}
	
	if (click == true) {
		for (const i of intervalID) {
			clearInterval(i);
		}
		intervalID.clear();

		if (click == false) {
			setTimeout(() => {
				webViewTranslation.executeJavaScript("var elements = document.getElementsByClassName('yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer'); elements[Math.floor(Math.random() * (elements.length / 10))].click();");
			}, 60000);
			click = true;
		}
	}
}

function OnWebViewTranslationDidNavigateInPage() {
	const webViewTranslation = document.getElementById("webViewTranslation");

	document.getElementById("textBoxAddress").value = webViewTranslation.getURL();
	
	if (click == true) {
		for (const i of intervalID) {
			clearInterval(i);
		}
		intervalID.clear();

		if (click == false) {
			setTimeout(() => {
				webViewTranslation.executeJavaScript("var elements = document.getElementsByClassName('yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer'); elements[Math.floor(Math.random() * (elements.length / 10))].click();");
			}, 60000);
			click = true;
		}
	}
}

function OnWebViewTranslationDidFrameFinishLoad() {
	const webViewTranslation = document.getElementById("webViewTranslation");

	if (play == false) {
		click = true;
		return;
	}
	
	if (webViewTranslation.getURL().startsWith("https://www.youtube.com/watch?")) {
		for (const i of intervalID) {
			clearInterval(i);
		}
		intervalID.clear();

		if (click == false) {
			setTimeout(() => {
				webViewTranslation.executeJavaScript("var elements = document.getElementsByClassName('yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer'); elements[Math.floor(Math.random() * (elements.length / 10))].click();");
			}, 60000);
			click = true;
		}
	}
}

// Async DNS lookup on the domain; if it resolves, load the page
async function TryAsURI(url) {
	try {
		const webViewTranslation = document.getElementById("webViewTranslation");

		await browser.dns.resolve(uri.host);
		await webViewTranslation.loadURL(url.href);
	}
	catch {
	}
}