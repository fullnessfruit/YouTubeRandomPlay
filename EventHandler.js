const punycode = require('punycode');
const crypto = require('crypto');
const channelList = require('./ChannelList.js').ChannelList();
const tlds_alpha_by_domain = require('./tlds-alpha-by-domain.js');

var topLevelDomainList = null;
var play = false;
var click = false;

function OnBodyLoad() {
	document.getElementById("textBoxAddress").addEventListener("keydown", OnTextBoxAddressKeyDown);
	document.getElementById("webViewTranslation").addEventListener("did-navigate", OnWebViewTranslationDidNavigate);
	document.getElementById("webViewTranslation").addEventListener("did-navigate-in-page", OnWebViewTranslationDidNavigateInPage);
	document.getElementById("webViewTranslation").addEventListener("did-frame-finish-load", OnWebViewTranslationDidFrameFinishLoad);

	// top level domain 목록을 매번 직접 다운 받는 것은 왠지 네트워크 자원 낭비 같기도 하고, 굳이 매번 갱신할 필요는 없을 것 같으므로 tlds-alpha-by-domain.js 로 만들었다.
	topLevelDomainList = tlds_alpha_by_domain.TLDsAlphaByDomain();

	setTimeout(() => {
		RandomPlay();
	}, 10);
}

function RandomPlay() {
	play = false;
	click = false;
	webViewTranslation.loadURL(channelList[crypto.randomInt(channelList.length)]);

	setTimeout(() => {
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

	// 아무것도 입력되지 않은 경우
	if (!textBoxAddressValue) {
		return;
	}

	const webViewTranslation = document.getElementById("webViewTranslation");

	try {
		// 온전한 URI 형태로 입력되었다면 성공한다.
		await webViewTranslation.loadURL(textBoxAddressValue);
	}
	catch {
		try {
			// 맨 첫 글자가 ?인 경우에는 그 뒤의 단어를 검색어로 간주하고 구글 일본어 검색을 한다.
			if (textBoxAddressValue.startsWith("?")) {
				await webViewTranslation.loadURL("https://www.google.com/search?q=" + encodeURIComponent(textBoxAddressValue.substring(1).trimStart()));
				return;
			}

			// 입력된 문자열을 프로토콜이 HTTP인 URI라고 간주하고 도메인 부분만 분리한다.
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

			// 호스트가 IPv4 또는 IPv4와 포트로 이루어져 있는 경우를 처리한다.
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

			// 도메인의 맨 마지막이 top level domain 중 하나라면, 입력된 문자열을 프로토콜이 HTTP인 URI로 간주한다. top level domain은 언제라도 추가될 수 있기 때문에 직접 확인한다.
			if (Array.isArray(topLevelDomainList)) {
				// 국제화 도메인일 수도 있으므로 도메인의 맨 마지막을 퓨니코드로 인코딩한다.
				// Javascript 자체에는 퓨니코드를 인코딩하는 라이브러리가 없는 것 같고 https://github.com/bestiejs/punycode.js 이걸 MIT 라이센스로 사용해야 하는 것 같다.
				// var punycodeDomain = punycode.encode(domain[domain.length - 1]);
				var punycodeDomain = domain[domain.length - 1];

				for (var i = 0; i < topLevelDomainList.length; i++) {
					// top level domain 목록의 맨 첫 줄은 무시한다.
					if (topLevelDomainList[i].trimStart().startsWith("#")) {
						continue;
					}

					if (topLevelDomainList[i].toUpperCase() === punycodeDomain.toUpperCase()) {
						await webViewTranslation.loadURL(url.href);
						return;
					}
				}
			}

			// top level domain 목록을 로드하는데 실패했다면 입력된 문자열을 DNS에 질의해 도메인이 존재하는지에 대한 여부를 확인해야 한다. 그리고 top level domain 목록을 로드하는데 성공한 경우, 일반적인 환경에서는 여기까지 왔다면 입력된 문자열이 URI인 경우가 거의 없겠지만, 만약 자체적으로 네임 서버와 도메인을 만들어서 사용하는 환경이라면 URI일 수도 있으므로 DNS 질의는 무조건 할 수밖에 없다. 하지만 입력된 문자열이 URI가 아니라 검색어인 경우, DNS 질의 결과가 온 후에 검색을 진행하면 검색 결과가 나올 때까지 오래 기다리게 된다. 따라서 DNS 질의는 비동기로 하고 질의 결과가 오기 전에 구글 일본어 검색도 동시에 진행한다.
			TryAsURI(url);
			try {
				await webViewTranslation.loadURL("https://www.google.com/search?q=" + encodeURIComponent(textBoxAddressValue));
			}
			catch {
			}
		}
		catch {
			// 입력된 문자열을 프로토콜이 HTTP인 URI로 만드는데 실패했다거나, 빈 문자열을 퓨니코드로 인코딩하려고 시도하다 예외가 발생했다거나 하는 등의 경우에는, 입력된 문자열을 검색어로 간주하고 구글 일본어 검색을 한다.
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
}

function OnWebViewTranslationDidNavigateInPage() {
	const webViewTranslation = document.getElementById("webViewTranslation");

	document.getElementById("textBoxAddress").value = webViewTranslation.getURL();
}

function OnWebViewTranslationDidFrameFinishLoad() {
	const webViewTranslation = document.getElementById("webViewTranslation");

	if (play == false)
	{
		webViewTranslation.executeJavaScript("var elements = document.getElementsByClassName('yt-spec-button-shape-next yt-spec-button-shape-next--filled yt-spec-button-shape-next--overlay yt-spec-button-shape-next--size-m yt-spec-button-shape-next--icon-leading'); for (var i = 0; i < elements.length; i++) { elements[i].click(); }");
		play = true;
	}
	else if (click == false)
	{
		setTimeout(() => {
			webViewTranslation.executeJavaScript("var elements = document.getElementsByClassName('yt-simple-endpoint style-scope ytd-playlist-panel-video-renderer'); elements[Math.floor(Math.random() * (elements.length / 10))].click();");
		}, 60000);
		click = true;
	}
}

// URI의 도메인 부분을 DNS에 질의해 도메인이 존재하는지에 대한 여부를 비동기로 확인한 후 존재하면 해당 웹 페이지를 로드한다.
async function TryAsURI(url) {
	try {
		const webViewTranslation = document.getElementById("webViewTranslation");

		await browser.dns.resolve(uri.host);
		await webViewTranslation.loadURL(url.href);
	}
	catch {
	}
}
