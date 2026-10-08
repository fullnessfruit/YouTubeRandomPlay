const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'EventHandler.js'), 'utf8');
const playlistId = 'testPlaylist';
const offlineId = 'offline0001';
const watchUrl = (videoId, listId = playlistId) => `https://www.youtube.com/watch?v=${videoId}&list=${listId}`;

// Run the real host and injected scripts with a delayed sidebar, controlled clock and no Electron.
function createPlayback() {
	let now = 0;
	let nextTimerId = 0;
	const intervals = new Map();
	const playback = {
		url: watchUrl(offlineId),
		response: { videoDetails: { videoId: offlineId, isUpcoming: true }, playabilityStatus: { status: 'LIVE_STREAM_OFFLINE' } },
		slateVisible: true,
		media: { currentTime: 0, paused: true, ended: false },
		sidebar: [],
		clicks: [],
		clickRequests: 0,
		clickFailures: 0,
		slateBackgroundImage: '',
		logs: [],
		loads: [],
		ipc: []
	};
	const guest = vm.createContext({
		window: {},
		URL,
		Math: { ceil: Math.ceil, floor: Math.floor, random: () => 0 },
		document: {
			addEventListener() {},
			getElementById: (id) => id === 'movie_player' ? { getPlayerResponse: () => playback.response } : null,
			querySelector: (selector) => {
				if (selector === '#movie_player video') return playback.media;
				if (selector === '#movie_player .ytp-offline-slate') {
					return {
						getClientRects: () => playback.slateVisible ? [{}] : [],
						querySelector: (selector) => {
							if (selector !== '.ytp-offline-slate-background') return null;
							return { style: { backgroundImage: playback.slateBackgroundImage } };
						}
					};
				}
				return null;
			},
			getElementsByClassName: (classes) => {
				if (classes !== 'yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer') return [];
				return playback.sidebar.map((videoId) => ({
					href: watchUrl(videoId, new URL(playback.url).searchParams.get('list')),
					click: () => playback.clicks.push(videoId)
				}));
			}
		}
	});
	const webview = {
		getURL: () => playback.url,
		loadURL: (url) => { playback.loads.push(url); playback.url = url; return Promise.resolve(); },
		executeJavaScript: (script) => {
			if (script !== playback.pollScript) {
				playback.clickRequests++;
				if (playback.clickFailures > 0) {
					playback.clickFailures--;
					return Promise.reject(new Error('Guest navigation interrupted the click'));
				}
			}
			return Promise.resolve(vm.runInContext(script, guest));
		}
	};
	const host = vm.createContext({
		__dirname: path.join(__dirname, '..'),
		URL,
		Date: class extends Date { static now() { return now; } },
		window: { addEventListener() {} },
		document: { getElementById: (id) => id === 'webViewTranslation' ? webview : { classList: { toggle() {} } } },
		setInterval: (callback) => { const id = ++nextTimerId; intervals.set(id, callback); return id; },
		clearInterval: (id) => intervals.delete(id),
		setTimeout: () => ++nextTimerId,
		clearTimeout() {},
		require: (name) => {
			if (name === 'fs') return { appendFileSync: (file, line) => playback.logs.push(line), readFileSync: () => '{"index":0}' };
			if (name === 'path') return path;
			if (name === 'crypto') return { randomInt: () => 0 };
			if (name === 'dns' || name === 'punycode') return {};
			if (name === 'electron') return { ipcRenderer: { send: (channel) => playback.ipc.push(channel) } };
			if (name === './tlds-alpha-by-domain.js') return { TLDsAlphaByDomain: () => [] };
			if (name === './ChannelList.js') return { ChannelList: () => [`https://www.youtube.com/playlist?list=${playlistId}`] };
			throw new Error(`Unexpected require: ${name}`);
		}
	});
	vm.runInContext(source, host);
	playback.pollScript = vm.runInContext('playbackPollScript', host);
	vm.runInContext(`currentListId = '${playlistId}'; currentEntry = { waitForVideoEnd: false }; startPlaybackMonitor();`, host);
	playback.call = (name) => vm.runInContext(`${name}()`, host);
	playback.endFirstVideo = () => { guest.window.__ytEnded = true; };
	playback.visitVideo = (videoId, upcoming, listId = playlistId) => {
		playback.url = watchUrl(videoId, listId);
		playback.response = {
			videoDetails: { videoId, isUpcoming: upcoming },
			playabilityStatus: { status: upcoming ? 'LIVE_STREAM_OFFLINE' : 'OK' }
		};
		playback.slateVisible = upcoming;
		playback.slateBackgroundImage = upcoming ? `url("https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg")` : '';
		playback.media.currentTime = 0;
		playback.media.ended = false;
		playback.media.paused = upcoming;
	};
	playback.poll = async (elapsed = 1000) => {
		now += elapsed;
		for (const callback of Array.from(intervals.values())) callback();
		await new Promise((resolve) => setImmediate(resolve));
	};
	return playback;
}

const tests = [
	['retry after the offline screen appears before the sidebar', async () => {
		const playback = createPlayback();
		await playback.poll();
		assert.strictEqual(playback.clickRequests, 1);
		assert.deepStrictEqual(playback.clicks, []);
		playback.sidebar = [offlineId, 'playable'];
		await playback.poll();
		assert.deepStrictEqual(playback.clicks, ['playable']);
		await playback.poll();
		assert.strictEqual(playback.clickRequests, 2, 'A successful click must not repeat while navigation is pending');
		assert.strictEqual(playback.logs.filter((line) => line.includes('upcoming live detected')).length, 1);
	}],
	['do not apply a previous video response and slate to the new video', async () => {
		const playback = createPlayback();
		playback.url = watchUrl('playable');
		playback.sidebar = [offlineId, 'playable', 'another'];
		await playback.poll();
		assert.deepStrictEqual(playback.clicks, []);
		assert.strictEqual(playback.logs.filter((line) => line.includes('upcoming live detected')).length, 0);
	}],
	['use the visible offline slate when the player response is unavailable', async () => {
		const playback = createPlayback();
		playback.response = null;
		playback.sidebar = [offlineId, 'playable'];
		await playback.poll();
		assert.deepStrictEqual(playback.clicks, ['playable']);
	}],
	['ignore a hidden slate during normal playback', async () => {
		const playback = createPlayback();
		playback.response.videoDetails.isUpcoming = false;
		playback.response.playabilityStatus.status = 'OK';
		playback.slateVisible = false;
		playback.sidebar = [offlineId, 'playable'];
		await playback.poll();
		assert.deepStrictEqual(playback.clicks, []);
	}],
	['exclude every offline video when several waiting streams are encountered', async () => {
		const playback = createPlayback();
		playback.sidebar = [offlineId, 'secondOffline', 'playable'];
		await playback.poll();
		assert.deepStrictEqual(playback.clicks, ['secondOffline']);
		playback.url = watchUrl('secondOffline');
		playback.response.videoDetails.videoId = 'secondOffline';
		await playback.poll();
		assert.deepStrictEqual(playback.clicks, ['secondOffline', 'playable']);
		playback.visitVideo('playable', false);
		await playback.poll();
		playback.visitVideo(offlineId, true);
		await playback.poll();
		assert.deepStrictEqual(playback.clicks, ['secondOffline', 'playable', 'playable']);
	}],
	['retry a rejected click execution', async () => {
		const playback = createPlayback();
		playback.sidebar = [offlineId, 'playable'];
		playback.clickFailures = 1;
		await playback.poll();
		assert.deepStrictEqual(playback.clicks, []);
		await playback.poll();
		assert.deepStrictEqual(playback.clicks, ['playable']);
	}],
	['failed retries preserve the 60-second stall deadline and limit repeated logs', async () => {
		const playback = createPlayback();
		playback.sidebar = [offlineId];
		for (let i = 0; i < 60; i++) await playback.poll();
		assert.deepStrictEqual(playback.loads, []);
		assert.strictEqual(playback.logs.filter((line) => line.includes('random video click')).length, 3);
		await playback.poll();
		assert.strictEqual(playback.loads.length, 1);
		assert(playback.logs.some((line) => line.includes('playback stalled - switching channel early')));
	}],
	['a scheduled quit holds a stalled channel until the hour elapses', async () => {
		const playback = createPlayback();
		playback.call('OnExitAfterBtnClick');
		await playback.poll();
		await playback.poll(60000);
		await playback.poll();
		assert.deepStrictEqual(playback.loads, []);
		assert.deepStrictEqual(playback.ipc, []);
		assert.strictEqual(playback.logs.filter((line) => line.includes('holding until scheduled quit')).length, 1);
		playback.call('OnChannelHourElapsed');
		assert.deepStrictEqual(playback.ipc, ['window-close']);
	}],
	['retry on a manually opened playlist without switching the channel early', async () => {
		const playback = createPlayback();
		playback.url = watchUrl(offlineId, 'manualPlaylist');
		await playback.poll();
		await playback.poll(60000);
		assert.deepStrictEqual(playback.loads, []);
		playback.sidebar = [offlineId, 'playable'];
		await playback.poll();
		assert.deepStrictEqual(playback.clicks, ['playable']);
	}],
	['do not duplicate an offline retry because an earlier video ended', async () => {
		const playback = createPlayback();
		await playback.poll();
		playback.endFirstVideo();
		await playback.poll();
		assert.strictEqual(playback.clickRequests, 2);
		playback.response.videoDetails.isUpcoming = false;
		playback.response.playabilityStatus.status = 'OK';
		playback.slateVisible = false;
		playback.sidebar = ['playable'];
		await playback.poll();
		assert.deepStrictEqual(playback.clicks, ['playable']);
		await playback.poll();
		assert.strictEqual(playback.clickRequests, 3);
	}],
	['recognize the current slate even when the response still belongs to the previous video', async () => {
		const playback = createPlayback();
		playback.response.videoDetails.videoId = 'previousVideo';
		playback.slateBackgroundImage = `url("https://i.ytimg.com/vi/${offlineId}/maxresdefault.jpg")`;
		playback.sidebar = [offlineId, 'playable'];
		await playback.poll();
		assert.deepStrictEqual(playback.clicks, ['playable']);
	}],
	['ignore the previous slate even after the player response changes to a playable video', async () => {
		const playback = createPlayback();
		playback.url = watchUrl('playable');
		playback.response.videoDetails.videoId = 'playable';
		playback.response.videoDetails.isUpcoming = false;
		playback.response.playabilityStatus.status = 'OK';
		playback.slateBackgroundImage = `url("https://i.ytimg.com/vi/${offlineId}/maxresdefault.jpg")`;
		playback.sidebar = [offlineId, 'playable'];
		await playback.poll();
		assert.deepStrictEqual(playback.clicks, []);
	}],
	['skip a scheduled live stream again after autoplay returns to it with a quit armed', async () => {
		const playback = createPlayback();
		playback.sidebar = ['shortVideo', offlineId, 'playable'];
		await playback.poll();
		assert.deepStrictEqual(playback.clicks, ['shortVideo']);
		playback.visitVideo('shortVideo', false);
		await playback.poll();
		playback.media.currentTime = 21;
		await playback.poll(21000);
		playback.call('OnExitAfterBtnClick');
		playback.visitVideo(offlineId, true);
		await playback.poll();
		assert.deepStrictEqual(playback.clicks, ['shortVideo', 'shortVideo']);
		await playback.poll();
		assert.strictEqual(playback.clickRequests, 2, 'Wait for navigation after the repeat skip');
		const detections = playback.logs.filter((line) => line.includes('upcoming live detected'));
		assert.strictEqual(detections.length, 2);
		assert(detections[1].includes('revisit: true'));
		assert.deepStrictEqual(playback.loads, []);
		assert.deepStrictEqual(playback.ipc, []);
	}],
	['skip the same waiting video again when it is opened in another playlist', async () => {
		const playback = createPlayback();
		playback.sidebar = [offlineId, 'playable'];
		await playback.poll();
		playback.visitVideo(offlineId, true, 'anotherPlaylist');
		await playback.poll();
		assert.deepStrictEqual(playback.clicks, ['playable', 'playable']);
		assert.deepStrictEqual(playback.loads, []);
	}]
];

(async () => {
	for (const [name, test] of tests) {
		await test();
		console.log(`PASS ${name}`);
	}
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
