var generateVaribaleName = function() {
	return '_' + Math.random().toString(36).substring(7);
}

var variableNames = {
	exports: "exports",
	canvas: "canvas",
	mouseMoveEvent: "mouseMoveEvent",
	keydown: "keydown",
	keyup: "keyup"
}

function patchAppCode(appCode) {

	var patchRules = [
		{
			name: "Export game scope",
			from: /([a-zA-Z]).scrollDelta=0,([a-zA-Z]).tmpInputs.push\(([a-zA-Z])\),/g,
			to: "window.cheat(L, y, v.getVars(), M, v, N),$1.scrollDelta=0,$2.tmpInputs.push($3),"
		},
		{
			name: "Exports exports scope",
			from: /!function\(([a-z])\){var ([a-z])={};function/g,
			to: '!function($1){var $2={};window["' + variableNames.exports + '"]=$2;function'
		},
		{
			name: "Mousemove",
			from: /;([a-z]).addEventListener\("mousemove"/g,
			to: ';window["' + variableNames.mouseMoveEvent + '"]=$1;$1.addEventListener("mousemove"'
		},
		{
			name: "keydown",
			from: /,window.addEventListener\("keydown",function\(([a-zA-Z])\){/g,
			to: ',window.addEventListener("keydown",function($1){window.keydown($1),'
		},
		{
			name: "keyup",
			from: /,window.addEventListener\("keyup",function\(([a-zA-Z])\){/g,
			to: ',window.addEventListener("keyup",function($1){window.keyup($1),'
		},
		{
			name: "Functions & constants",
			from: /,this.canSee=function\(/,
			to: ",this.getVars=function(){return {funcs: i,constants: a}},this.canSee=function("
		}
	];

	patchRules.forEach(function(item) {
		if(item.from.test(appCode)) {
			appCode = appCode.replace(item.from, item.to);
		} else {
			console.log("Err patching: " + item.name);
		}
	});

	// Add init.js script
	var url = chrome.extension.getURL('init.js');
	return fetch(url)
		.then((response) => response.text())
		.then((text) => { return text + appCode });
}

var codeInjector = (function(){
	var _appCode = null;

	var appCodeUpdating = false;

	// Update only not patching
	function updateAppCode(url, onSuccess, onError) {
		console.log("Executing xhr app request...");
		var xhr = new XMLHttpRequest();
		xhr.open("GET", url, true);
		xhr.send();

		xhr.onreadystatechange = function() {
			if (xhr.readyState != 4) return;
			if (this.status != 200) {
				return onError();
			}

			chrome.storage.local.set({
				'appCode': xhr.responseText,
				'appVer': url.match(/game.js/)[1]
			}, function() {
				return onSuccess(xhr.responseText);
			});
		}
	}

	var setAppCode = function(appCode) {
		_appCode = appCode;
	}

	var handleAppCode = function(appCode, tabId) {
		patchAppCode(appCode).then(function(patchedAppCode) {
			codeInjector.setAppCode(patchedAppCode);
			appCodeUpdating = false;
			codeInjector.tryToInjectCode(tabId);
		});
	}

	var injectCode = function(tabId, code) {
		/* Passing code as string */
		var codeContainer = JSON.stringify({
			code: code
		});
		
		var injectionScript = "(function(){";

		injectionScript += "var code = (";
		injectionScript += codeContainer;
		injectionScript += ").code;";

		injectionScript += "var script = document.createElement('script');";
		injectionScript += "script.innerHTML = code;";
		injectionScript += "document.body.appendChild(script);";

		injectionScript += "})()";

		try {
			chrome.tabs.executeScript(tabId, {
				code: injectionScript
			});
		} catch(e) {};
	};

	var tryToInjectCode = function(tabId) {
		if(_appCode) {
			injectCode(tabId, _appCode);
			
			_appCode = null;

			return;
		}
	}

	var onRequest = function(details, tab) {
		if(details.url.match(/game/)) {

			if(!appCodeUpdating) {
				appCodeUpdating = true;	
			} else {
				return;
			}

			chrome.storage.local.get(['appCode'], function(appCode) {
				if(appCode.appCode === undefined) {
					codeInjector.updateAppCode(details.url, function(appCode) {
						console.log("App code updated.");
						handleAppCode(appCode, tab.id);
					}, function(){
						appCodeUpdating = false;
						console.log("Err update game file. Page will be reloaded after 5 seconds...");
						setTimeout(function(){chrome.tabs.reload(tab.id, null, null)}, 5000);
					});
				} else {
					chrome.storage.local.get(['appVer'], function(appVer) {
						if(appVer.appVer != details.url.match(/game.js/)[1]) {
							codeInjector.updateAppCode(details.url, function(appCode) {
								console.log("App code updated.");
								handleAppCode(appCode, tab.id);
							}, function(){
								appCodeUpdating = false;
								console.log("Err update game file. Page will be reloaded after 5 seconds...");
								setTimeout(function(){chrome.tabs.reload(tab.id, null, null)}, 5000);
							});
						} else {
							handleAppCode(appCode.appCode, tab.id);
						}
					});
				}
			});
		}
	}

	return {
		updateAppCode: updateAppCode,
		setAppCode: setAppCode,
		tryToInjectCode: tryToInjectCode,
		onRequest: onRequest
	}

})();

var onBeforeRequestListener = function(details) {
	chrome.tabs.get(details.tabId, function(tab) {
		if(chrome.runtime.lastError) return;
		
		codeInjector.onRequest(details, tab);

		try {
			extensionManager	
		} catch(e) {
			// Launch default extension
			console.log("Cannot find extensionManager. Launch default extension.");
			return;
		}

		extensionManager.isUpdateNeeded(function(isNeeded) {
			if(isNeeded) {
				extensionManager.updateExtension(function() {
					extensionManager.extension(function(extensionCode) {
						// Reinstall
						chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequestListener);
						chrome.runtime.onMessage.removeListener(onMessageListener);
						extensionManager.install(extensionCode);
						chrome.tabs.update(tab.id, {}, function(tab) {});
						console.log("Updating tab");
						return;
					});
				});
			}
		});

	});

	return {
		cancel: true
	}
}

chrome.webRequest.onBeforeRequest.addListener(
	onBeforeRequestListener,
	// Filters
	{
		urls: [
			"*://krunker.io/js/game.js",
			"https://www.google.com/recaptcha/api.js?onload=captchaCallback&render=explicit"
		],
		types: ["script"]
	},
	["blocking"]
);