// Para a página de fundo

'use strict';

/******************************************************************************/

{
// >>>>> início do escopo local

/******************************************************************************/
/******************************************************************************/

const browser = self.browser;
const manifest = browser.runtime.getManifest();

vAPI.cantWebsocket =
    browser.webRequest.ResourceType instanceof Object === false  ||
    browser.webRequest.ResourceType.WEBSOCKET !== 'websocket';

vAPI.canWASM = vAPI.webextFlavor.soup.has('chromium') === false;
if ( vAPI.canWASM === false ) {
    const csp = manifest.content_security_policy;
    vAPI.canWASM = csp !== undefined && csp.indexOf("'wasm-eval'") !== -1;
}

vAPI.supportsUserStylesheets = vAPI.webextFlavor.soup.has('user_stylesheet');


window.addEventListener('webextFlavor', function() {
    vAPI.supportsUserStylesheets =
        vAPI.webextFlavor.soup.has('user_stylesheet');
}, { once: true });

/******************************************************************************/

vAPI.randomToken = function() {
    const n = Math.random();
    return String.fromCharCode(n * 26 + 97) +
        Math.floor(
            (0.25 + n * 0.75) * Number.MAX_SAFE_INTEGER
        ).toString(36).slice(-8);
};

/******************************************************************************/

vAPI.app = {
    name: manifest.name.replace(/ dev\w+ build/, ''),
    version: (( ) => {
        let version = manifest.version;
        const match = /(\d+\.\d+\.\d+)(?:\.(\d+))?/.exec(version);
        if ( match && match[2] ) {
            const v = parseInt(match[2], 10);
            version = match[1] + (v < 100 ? 'b' + v : 'rc' + (v - 100));
        }
        return version;
    })(),

    intFromVersion: function(s) {
        const parts = s.match(/(?:^|\.|b|rc)\d+/g);
        if ( parts === null ) { return 0; }
        let vint = 0;
        for ( let i = 0; i < 4; i++ ) {
            const pstr = parts[i] || '';
            let pint;
            if ( pstr === '' ) {
                pint = 0;
            } else if ( pstr.startsWith('.') || pstr.startsWith('b') ) {
                pint = parseInt(pstr.slice(1), 10);
            } else if ( pstr.startsWith('rc') ) {
                pint = parseInt(pstr.slice(2), 10) + 100;
            } else {
                pint = parseInt(pstr, 10);
            }
            vint = vint * 1000 + pint;
        }
        return vint;
    },

    restart: function() {
        browser.runtime.reload();
    },
};

/******************************************************************************/
/******************************************************************************/

vAPI.storage = webext.storage.local;

/******************************************************************************/
/******************************************************************************/



vAPI.browserSettings = (( ) => {
    const bp = webext.privacy;
    if ( bp instanceof Object === false ) { return; }

    return {
       
        webRTCSupported: vAPI.webextFlavor.soup.has('chromium') === false || undefined,

        setWebrtcIPAddress: function(setting) {
             // Ainda não sabemos se este navegador é compatível com WebRTC: descubra.
            if ( this.webRTCSupported === undefined ) {
               // Se for solicitado a deixar a configuração WebRTC sozinha neste ponto do
                // código, isso significa que nunca pegamos a configuração no primeiro
                // Lugar, colocar.
                if ( setting ) { return; }
                this.webRTCSupported = { setting: setting };
                let iframe = document.createElement('iframe');
                const messageHandler = ev => {
                    if ( ev.origin !== self.location.origin ) { return; }
                    window.removeEventListener('message', messageHandler);
                    const setting = this.webRTCSupported.setting;
                    this.webRTCSupported = ev.data === 'webRTCSupported';
                    this.setWebrtcIPAddress(setting);
                    iframe.parentNode.removeChild(iframe);
                    iframe = null;
                };
                window.addEventListener('message', messageHandler);
                iframe.src = 'is-webrtc-supported.html';
                document.body.appendChild(iframe);
                return;
            }

            // Estamos aguardando uma resposta de nosso iframe. Isso torna o código
            // seguro para reentrada.
            if ( typeof this.webRTCSupported === 'object' ) {
                this.webRTCSupported.setting = setting;
                return;
            }

            if ( this.webRTCSupported !== true ) { return; }

            const bpn = bp.network;

            if ( setting ) {
                bpn.webRTCIPHandlingPolicy.clear({
                    scope: 'regular',
                });
            } else {
            
                const value =
                    vAPI.webextFlavor.soup.has('firefox') === false ||
                    vAPI.webextFlavor.major < 70
                        ? 'default_public_interface_only'
                        : 'disable_non_proxied_udp';
                bpn.webRTCIPHandlingPolicy.set({ value, scope: 'regular' });
            }
        },

        set: function(details) {
            for ( const setting in details ) {
                if ( details.hasOwnProperty(setting) === false ) { continue; }
                switch ( setting ) {
                case 'prefetching':
                    const enabled = !!details[setting];
                    if ( enabled ) {
                        bp.network.networkPredictionEnabled.clear({
                            scope: 'regular',
                        });
                    } else {
                        bp.network.networkPredictionEnabled.set({
                            value: false,
                            scope: 'regular',
                        });
                    }
                    if ( vAPI.prefetching instanceof Function ) {
                        vAPI.prefetching(enabled);
                    }
                    break;

                case 'hyperlinkAuditing':
                    if ( !!details[setting] ) {
                        bp.websites.hyperlinkAuditingEnabled.clear({
                            scope: 'regular',
                        });
                    } else {
                        bp.websites.hyperlinkAuditingEnabled.set({
                            value: false,
                            scope: 'regular',
                        });
                    }
                    break;

                case 'webrtcIPAddress':
                    this.setWebrtcIPAddress(!!details[setting]);
                    break;

                default:
                    break;
                }
            }
        }
    };
})();

/******************************************************************************/
/******************************************************************************/

vAPI.isBehindTheSceneTabId = function(tabId) {
    return tabId < 0;
};

vAPI.unsetTabId = 0;
vAPI.noTabId = -1;       // definitivamente nenhuma guia existente

// Para garantir que sempre usamos um bom id de guia
const toTabId = function(tabId) {
    return typeof tabId === 'number' && isNaN(tabId) === false
        ? tabId
        : 0;
};

// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webNavigation
// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs

vAPI.Tabs = class {
    constructor() {
        browser.webNavigation.onCreatedNavigationTarget.addListener(details => {
            if ( typeof details.url !== 'string' ) {
                details.url = '';
            }
            if ( /^https?:\/\//.test(details.url) === false ) {
                details.frameId = 0;
                details.url = this.sanitizeURL(details.url);
                this.onNavigation(details);
            }
            this.onCreated(details);
        });

        browser.webNavigation.onCommitted.addListener(details => {
            details.url = this.sanitizeURL(details.url);
            this.onNavigation(details);
        });

        browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if ( typeof changeInfo.url !== 'string' ) {
                changeInfo.url = tab && tab.url;
            }
            if ( changeInfo.url ) {
                changeInfo.url = this.sanitizeURL(changeInfo.url);
            }
            this.onUpdated(tabId, changeInfo, tab);
        });

        browser.tabs.onActivated.addListener(details => {
            this.onActivated(details);
        });

        if ( browser.windows instanceof Object ) {
            browser.windows.onFocusChanged.addListener(async windowId => {
                if ( windowId === browser.windows.WINDOW_ID_NONE ) { return; }
                const tabs = await vAPI.tabs.query({ active: true, windowId });
                if ( tabs.length === 0 ) { return; }
                const tab = tabs[0];
                this.onActivated({ tabId: tab.id, windowId: tab.windowId });
            });
        }

        browser.tabs.onRemoved.addListener((tabId, details) => {
            this.onClosed(tabId, details);
        });
     }

    async executeScript() {
        let result;
        try {
            result = await webext.tabs.executeScript(...arguments);
        }
        catch(reason) {
        }
        return Array.isArray(result) ? result : [];
    }

    async get(tabId) {
        if ( tabId === null ) {
            return this.getCurrent();
        }
        if ( tabId <= 0 ) { return null; }
        let tab;
        try {
            tab = await webext.tabs.get(tabId);
        }
        catch(reason) {
        }
        return tab instanceof Object ? tab : null;
    }

    async getCurrent() {
        const tabs = await this.query({ active: true, currentWindow: true });
        return tabs.length !== 0 ? tabs[0] : null;
    }

    async insertCSS(tabId, details) {
        if ( vAPI.supportsUserStylesheets ) {
            details.cssOrigin = 'user';
        }
        try {
            await webext.tabs.insertCSS(...arguments);
        }
        catch(reason) {
        }
    }

    async query(queryInfo) {
        let tabs;
        try {
            tabs = await webext.tabs.query(queryInfo);
        }
        catch(reason) {
        }
        return Array.isArray(tabs) ? tabs : [];
    }

    async removeCSS(tabId, details) {
        if ( vAPI.supportsUserStylesheets ) {
            details.cssOrigin = 'user';
        }
        try {
            await webext.tabs.removeCSS(...arguments);
        }
        catch(reason) {
        }
    }

    // Propriedades do objeto de detalhes:
    // - url: 'URL', => o endereço que será aberto
    // - índice: -1, => indefinido: fim da lista, -1: guia seguinte,
    // ou depois do índice
    // - ativo: falso, => abre a guia ... em segundo plano: verdadeiro,
    // foreground: undefined
    // - popup: 'popup' => abrir em uma nova janela

    async create(url, details) {
        if ( details.active === undefined ) {
            details.active = true;
        }

        const subWrapper = async ( ) => {
            const updateDetails = {
                url: url,
                active: !!details.active
            };

             // Abrir uma guia em uma janela anônima não focalizará a janela
            // em que a guia foi aberta
            const focusWindow = tab => {
                if ( tab.active && vAPI.windows instanceof Object ) {
                    vAPI.windows.update(tab.windowId, { focused: true });
                }
            };

            if ( !details.tabId ) {
                if ( details.index !== undefined ) {
                    updateDetails.index = details.index;
                }
                browser.tabs.create(updateDetails, focusWindow);
                return;
            }

             // atualização não aceita índice, deve usar mover
            const tab = await vAPI.tabs.update(
                toTabId(details.tabId),
                updateDetails
            );
            // se a guia não existe
            if ( tab === null ) {
                browser.tabs.create(updateDetails, focusWindow);
            } else if ( details.index !== undefined ) {
                browser.tabs.move(tab.id, { index: details.index });
            }
        };

        
        if ( details.popup !== undefined && vAPI.windows instanceof Object ) {
            const createDetails = {
                url: details.url,
                type: details.popup,
            };
            if ( details.box instanceof Object ) {
                Object.assign(createDetails, details.box);
            }
            const win = await vAPI.windows.create(createDetails);
            if ( win === null ) { return; }
            if ( details.box instanceof Object === false ) { return; }
            if (
                win.left === details.box.left &&
                win.top === details.box.top
            ) {
                return;
            }
            vAPI.windows.update(win.id, {
                left: details.box.left,
                top: details.box.top
            });
            return;
        }

        if ( details.index !== -1 ) {
            subWrapper();
            return;
        }

        const tab = await vAPI.tabs.getCurrent();
        if ( tab !== null ) {
            details.index = tab.index + 1;
        } else {
            details.index = undefined;
        }
        subWrapper();
    }

     // Propriedades do objeto de detalhes:
    // - url: 'URL', => o endereço que será aberto
    // - tabId: 1, => a guia é usada se definida, em vez de criar uma nova
    // - índice: -1, => indefinido: fim da lista, -1: guia seguinte ou
    // depois do índice
    // - ativo: falso, => abre a guia em segundo plano - verdadeiro e indefinido:
    //                     foreground
    // - select: true, => se uma guia já estiver aberta com esse url, selecione
    // em vez de abrir um novo
    // - popup: true => abrir em uma nova janela

    async open(details) {
        let targetURL = details.url;
        if ( typeof targetURL !== 'string' || targetURL === '' ) {
            return null;
        }

        // extension pages
        if ( /^[\w-]{2,}:/.test(targetURL) !== true ) {
            targetURL = vAPI.getURL(targetURL);
        }

        if ( !details.select ) {
            this.create(targetURL, details);
            return;
        }

       
        if (
            vAPI.webextFlavor.soup.has('firefox') &&
            vAPI.webextFlavor.major < 56
        ) {
            this.create(targetURL, details);
            return;
        }

        const pos = targetURL.indexOf('#');
        const targetURLWithoutHash = pos === -1
            ? targetURL
            : targetURL.slice(0, pos);

        const tabs = await vAPI.tabs.query({ url: targetURLWithoutHash });
        if ( tabs.length === 0 ) {
            this.create(targetURL, details);
            return;
        }
        let tab = tabs[0];
        const updateDetails = { active: true };
        // https://github.com/uBlockOrigin/uBlock-issues/issues/592
        if ( tab.url.startsWith(targetURL) === false ) {
            updateDetails.url = targetURL;
        }
        tab = await vAPI.tabs.update(tab.id, updateDetails);
        if ( vAPI.windows instanceof Object === false ) { return; }
        vAPI.windows.update(tab.windowId, { focused: true });
    }

    async update() {
        let tab;
        try {
            tab = await webext.tabs.update(...arguments);
        }
        catch (reason) {
        }
        return tab instanceof Object ? tab : null;
    }

    // Substitua o URL de uma guia. Noop se a guia não existe.
    replace(tabId, url) {
        tabId = toTabId(tabId);
        if ( tabId === 0 ) { return; }

        let targetURL = url;

      // páginas de extensão
        if ( /^[\w-]{2,}:/.test(targetURL) !== true ) {
            targetURL = vAPI.getURL(targetURL);
        }

        vAPI.tabs.update(tabId, { url: targetURL });
    }

    async remove(tabId) {
        tabId = toTabId(tabId);
        if ( tabId === 0 ) { return; }
        try {
            await webext.tabs.remove(tabId);
        }
        catch (reason) {
        }
    }

    async reload(tabId, bypassCache = false) {
        tabId = toTabId(tabId);
        if ( tabId === 0 ) { return; }
        try {
            await webext.tabs.reload(
                tabId,
                { bypassCache: bypassCache === true }
            );
        }
        catch (reason) {
        }
    }

    async select(tabId) {
        tabId = toTabId(tabId);
        if ( tabId === 0 ) { return; }
        const tab = await vAPI.tabs.update(tabId, { active: true });
        if ( tab === null ) { return; }
        if ( vAPI.windows instanceof Object === false ) { return; }
        vAPI.windows.update(tab.windowId, { focused: true });
    }

    sanitizeURL(url) {
        if ( url.startsWith('data:') === false ) { return url; }
        const pos = url.indexOf(',');
        if ( pos === -1 ) { return url; }
        const s = url.slice(0, pos);
        if ( s.search(/\s/) === -1 ) { return url; }
        return s.replace(/\s+/, '') + url.slice(pos);
    }

    onActivated(/* details */) {
    }

    onClosed(/* tabId, details */) {
    }

    onCreated(/* details */) {
    }

    onNavigation(/* details */) {
    }

    onUpdated(/* tabId, changeInfo, tab */) {
    }
};

/******************************************************************************/
/******************************************************************************/

if ( webext.windows instanceof Object ) {
    vAPI.windows = {
        get: async function() {
            let win;
            try {
                win = await webext.windows.get(...arguments);
            }
            catch (reason) {
            }
            return win instanceof Object ? win : null;
        },
        create: async function() {
            let win;
            try {
                win = await webext.windows.create(...arguments);
            }
            catch (reason) {
            }
            return win instanceof Object ? win : null;
        },
        update: async function() {
            let win;
            try {
                win = await webext.windows.update(...arguments);
            }
            catch (reason) {
            }
            return win instanceof Object ? win : null;
        },
    };
}

/******************************************************************************/
/******************************************************************************/

if ( webext.browserAction instanceof Object ) {
    vAPI.browserAction = {
        setTitle: async function() {
            try {
                await webext.browserAction.setTitle(...arguments);
            }
            catch (reason) {
            }
        },
    };
  
    if ( webext.browserAction.setIcon ) {
        vAPI.browserAction.setBadgeTextColor = async function() {
            try {
                await webext.browserAction.setBadgeTextColor(...arguments);
            }
            catch (reason) {
            }
        };
        vAPI.browserAction.setBadgeBackgroundColor = async function() {
            try {
                await webext.browserAction.setBadgeBackgroundColor(...arguments);
            }
            catch (reason) {
            }
        };
        vAPI.browserAction.setBadgeText = async function() {
            try {
                await webext.browserAction.setBadgeText(...arguments);
            }
            catch (reason) {
            }
        };
        vAPI.browserAction.setIcon = async function() {
            try {
                await webext.browserAction.setIcon(...arguments);
            }
            catch (reason) {
            }
        };
    }
}

vAPI.setIcon = (( ) => {
    const browserAction = vAPI.browserAction;
    const  titleTemplate =
        browser.runtime.getManifest().browser_action.default_title +
        ' ({badge})';
    const icons = [
        { path: { '16': 'img/icon_16-off.png', '32': 'img/icon_32-off.png' } },
        { path: { '16':     'img/icon_16.png', '32':     'img/icon_32.png' } },
    ];

    (( ) => {
        if ( browserAction.setIcon === undefined ) { return; }

        // The global badge text and background color.
        if ( browserAction.setBadgeBackgroundColor !== undefined ) {
            browserAction.setBadgeBackgroundColor({ color: '#666666' });
        }
        if ( browserAction.setBadgeTextColor !== undefined ) {
            browserAction.setBadgeTextColor({ color: '#FFFFFF' });
        }

      
        if ( vAPI.webextFlavor.soup.has('chromium') === false ) { return; }

        const imgs = [];
        for ( let i = 0; i < icons.length; i++ ) {
            const path = icons[i].path;
            for ( const key in path ) {
                if ( path.hasOwnProperty(key) === false ) { continue; }
                imgs.push({ i: i, p: key });
            }
        }

        // https://github.com/uBlockOrigin/uBlock-issues/issues/296
        const safeGetImageData = function(ctx, w, h) {
            let data;
            try {
                data = ctx.getImageData(0, 0, w, h);
            } catch(ex) {
            }
            return data;
        };

        const onLoaded = function() {
            for ( const img of imgs ) {
                if ( img.r.complete === false ) { return; }
            }
            const ctx = document.createElement('canvas').getContext('2d');
            const iconData = [ null, null ];
            for ( const img of imgs ) {
                const w = img.r.naturalWidth, h = img.r.naturalHeight;
                ctx.width = w; ctx.height = h;
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(img.r, 0, 0);
                if ( iconData[img.i] === null ) { iconData[img.i] = {}; }
                const imgData = safeGetImageData(ctx, w, h);
                if (
                    imgData instanceof Object === false ||
                    imgData.data instanceof Uint8ClampedArray === false ||
                    imgData.data[0] !== 0 ||
                    imgData.data[1] !== 0 ||
                    imgData.data[2] !== 0 ||
                    imgData.data[3] !== 0
                ) {
                    return;
                }
                iconData[img.i][img.p] = imgData;
            }
            for ( let i = 0; i < iconData.length; i++ ) {
                if ( iconData[i] ) {
                    icons[i] = { imageData: iconData[i] };
                }
            }
        };
        for ( const img of imgs ) {
            img.r = new Image();
            img.r.addEventListener('load', onLoaded, { once: true });
            img.r.src = icons[img.i].path[img.p];
        }
    })();

    
    // partes: bit 0 = ícone
    // bit 1 = texto do emblema
    // bit 2 = cor do emblema
    // bit 3 = ocultar emblema

    return async function(tabId, details) {
        tabId = toTabId(tabId);
        if ( tabId === 0 ) { return; }

        const tab = await vAPI.tabs.get(tabId);
        if ( tab === null ) { return; }

        const { parts, state, badge, color } = details;

        if ( browserAction.setIcon !== undefined ) {
            if ( parts === undefined || (parts & 0b0001) !== 0 ) {
                browserAction.setIcon(
                    Object.assign({ tabId: tab.id }, icons[state])
                );
            }
            if ( (parts & 0b0010) !== 0 ) {
                browserAction.setBadgeText({
                    tabId: tab.id,
                    text: (parts & 0b1000) === 0 ? badge : ''
                });
            }
            if ( (parts & 0b0100) !== 0 ) {
                browserAction.setBadgeBackgroundColor({ tabId: tab.id, color });
            }
        }

        // Insira o texto do emblema no título se:
        // - a plataforma não suporta browserAction.setIcon (); OU
        // - a renderização do emblema está desabilitada
        if (
            browserAction.setTitle !== undefined && (
                browserAction.setIcon === undefined || (parts & 0b1000) !== 0
            )
        ) {
            browserAction.setTitle({
                tabId: tab.id,
                title: titleTemplate.replace(
                    '{badge}',
                    state === 1 ? (badge !== '' ? badge : '0') : 'off'
                )
            });
        }

        if ( vAPI.contextMenu instanceof Object ) {
            vAPI.contextMenu.onMustUpdate(tabId);
        }
    };
})();

browser.browserAction.onClicked.addListener(function(tab) {
    vAPI.tabs.open({
        select: true,
        url: 'popup.html?tabId=' + tab.id + '&responsive=1'
    });
});

vAPI.messaging = {
    ports: new Map(),
    listeners: new Map(),
    defaultHandler: null,
    PRIVILEGED_URL: vAPI.getURL(''),
    NOOPFUNC: function(){},
    UNHANDLED: 'vAPI.messaging.notHandled',

    listen: function(details) {
        this.listeners.set(details.name, {
            fn: details.listener,
            privileged: details.privileged === true
        });
    },

    onPortDisconnect: function(port) {
        this.ports.delete(port.name);
    },

    onPortConnect: function(port) {
        port.onDisconnect.addListener(port =>
            this.onPortDisconnect(port)
        );
        port.onMessage.addListener((request, port) =>
            this.onPortMessage(request, port)
        );
        const portDetails = { port };
        const sender = port.sender;
        const { tab, url } = sender;
        portDetails.frameId = sender.frameId;
        portDetails.frameURL = url;
        portDetails.privileged = url.startsWith(this.PRIVILEGED_URL);
        if ( tab ) {
            portDetails.tabId = tab.id;
            portDetails.tabURL = tab.url;
        }
        this.ports.set(port.name, portDetails);
        // https://bugzilla.mozilla.org/show_bug.cgi?id=1652925#c24
        port.sender = undefined;
    },

    setup: function(defaultHandler) {
        if ( this.defaultHandler !== null ) { return; }

        if ( typeof defaultHandler !== 'function' ) {
            defaultHandler = function() {
                return this.UNHANDLED;
            };
        }
        this.defaultHandler = defaultHandler;

        browser.runtime.onConnect.addListener(
            port => this.onPortConnect(port)
        );

        // https://bugzilla.mozilla.org/show_bug.cgi?id=1392067
        // Solução alternativa: remova manualmente as portas que correspondem à guia removida.
        if (
            vAPI.webextFlavor.soup.has('firefox') &&
            vAPI.webextFlavor.major < 61
        ) {
            browser.tabs.onRemoved.addListener(tabId => {
                for ( const { port, tabId: portTabId } of this.ports.values() ) {
                    if ( portTabId !== tabId ) { continue; }
                    this.onPortDisconnect(port);
                }
            });
        }
    },

    broadcast: function(message) {
        const messageWrapper = { broadcast: true, msg: message };
        for ( const { port } of this.ports.values() ) {
            try {
                port.postMessage(messageWrapper);
            } catch(ex) {
                this.onPortDisconnect(port);
            }
        }
    },

    onFrameworkMessage: function(request, port, callback) {
        const portDetails = this.ports.get(port.name) || {};
        const tabId = portDetails.tabId;
        const msg = request.msg;
        switch ( msg.what ) {
        case 'connectionAccepted':
        case 'connectionRefused': {
            const toPort = this.ports.get(msg.fromToken);
            if ( toPort !== undefined ) {
                msg.tabId = tabId;
                toPort.port.postMessage(request);
            } else {
                msg.what = 'connectionBroken';
                port.postMessage(request);
            }
            break;
        }
        case 'connectionRequested':
            msg.tabId = tabId;
            for ( const { port: toPort } of this.ports.values() ) {
                if ( toPort === port ) { continue; }
                try {
                    toPort.postMessage(request);
                } catch (ex) {
                    this.onPortDisconnect(toPort);
                }
            }
            break;
        case 'connectionBroken':
        case 'connectionCheck':
        case 'connectionMessage': {
            const toPort = this.ports.get(
                port.name === msg.fromToken ? msg.toToken : msg.fromToken
            );
            if ( toPort !== undefined ) {
                msg.tabId = tabId;
                toPort.port.postMessage(request);
            } else {
                msg.what = 'connectionBroken';
                port.postMessage(request);
            }
            break;
        }
        case 'extendClient':
            vAPI.tabs.executeScript(tabId, {
                file: '/js/vapi-client-extra.js',
                frameId: portDetails.frameId,
            }).then(( ) => {
                callback();
            });
            break;
        case 'localStorage': {
            if ( portDetails.privileged !== true ) { break; }
            const args = msg.args || [];
            vAPI.localStorage[msg.fn](...args).then(result => {
                callback(result);
            });
            break;
        }
        case 'userCSS':
            if ( tabId === undefined ) { break; }
            const promises = [];
            if ( msg.add ) {
                const details = {
                    code: undefined,
                    frameId: portDetails.frameId,
                    matchAboutBlank: true,
                    runAt: 'document_start',
                };
                for ( const cssText of msg.add ) {
                    details.code = cssText;
                    promises.push(vAPI.tabs.insertCSS(tabId, details));
                }
            }
            if ( msg.remove ) {
                const details = {
                    code: undefined,
                    frameId: portDetails.frameId,
                    matchAboutBlank: true,
                };
                for ( const cssText of msg.remove ) {
                    details.code = cssText;
                    promises.push(vAPI.tabs.removeCSS(tabId, details));
                }
            }
            Promise.all(promises).then(( ) => {
                callback();
            });
            break;
        }
    },

    // Use um invólucro para evitar o fechamento e permitir a reutilização
    CallbackWrapper: class {
        constructor(messaging, port, msgId) {
            this.messaging = messaging;
            this.callback = this.proxy.bind(this); // bind once
            this.init(port, msgId);
        }
        init(port, msgId) {
            this.port = port;
            this.msgId = msgId;
            return this;
        }
        proxy(response) {
            // https://github.com/chrisaljoudi/uBlock/issues/383
            if ( this.messaging.ports.has(this.port.name) ) {
                this.port.postMessage({
                    msgId: this.msgId,
                    msg: response !== undefined ? response : null,
                });
            }
           // Armazene para reutilização
            this.port = null;
            this.messaging.callbackWrapperJunkyard.push(this);
        }
    },

    callbackWrapperJunkyard: [],

    callbackWrapperFactory: function(port, msgId) {
        return this.callbackWrapperJunkyard.length !== 0
            ? this.callbackWrapperJunkyard.pop().init(port, msgId)
            : new this.CallbackWrapper(this, port, msgId);
    },

    onPortMessage: function(request, port) {
      // prepara a resposta
        let callback = this.NOOPFUNC;
        if ( request.msgId !== undefined ) {
            callback = this.callbackWrapperFactory(port, request.msgId).callback;
        }

        // Processo de conteúdo para o processo principal: manipulador de estrutura.
        if ( request.channel === 'vapi' ) {
            this.onFrameworkMessage(request, port, callback);
            return;
        }

         // Processo auxiliar para o processo principal: manipulador específico
        const portDetails = this.ports.get(port.name);
        if ( portDetails === undefined ) { return; }

        const listenerDetails = this.listeners.get(request.channel);
        let r = this.UNHANDLED;
        if (
            (listenerDetails !== undefined) &&
            (listenerDetails.privileged === false || portDetails.privileged)
            
        ) {
            r = listenerDetails.fn(request.msg, portDetails, callback);
        }
        if ( r !== this.UNHANDLED ) { return; }

        // Processo auxiliar para o processo principal: manipulador padrão
        if ( portDetails.privileged ) {
            r = this.defaultHandler(request.msg, portDetails, callback);
            if ( r !== this.UNHANDLED ) { return; }
        }

       // Processo auxiliar para o processo principal: sem manipulador
        log.info(
            `vAPI.messaging.onPortMessage > unhandled request: ${JSON.stringify(request.msg)}`,
            request
        );

        // Precisa ligar de volta de qualquer maneira, caso o chamador esperasse uma resposta, ou
        // senão há um vazamento de memória do lado do chamador
        callback();
    },
};


vAPI.warSecret = (( ) => {
    const generateSecret = ( ) => {
        return Math.floor(Math.random() * 982451653 + 982451653).toString(36);
    };

    const root = vAPI.getURL('/');
    const secrets = [];
    let lastSecretTime = 0;

    const guard = function(details) {
        const url = details.url;
        const pos = secrets.findIndex(secret =>
            url.lastIndexOf(`?secret=${secret}`) !== -1
        );
        if ( pos === -1 ) {
            return { cancel: true };
        }
        secrets.splice(pos, 1);
    };

    browser.webRequest.onBeforeRequest.addListener(
        guard,
        {
            urls: [ root + 'web_accessible_resources/*' ]
        },
        [ 'blocking' ]
    );

    return ( ) => {
        if ( secrets.length !== 0 ) {
            if ( (Date.now() - lastSecretTime) > 5000 ) {
                secrets.splice(0);
            } else if ( secrets.length > 256 ) {
                secrets.splice(0, secrets.length - 192);
            }
        }
        lastSecretTime = Date.now();
        const secret = generateSecret();
        secrets.push(secret);
        return secret;
    };
})();

/******************************************************************************/

vAPI.Net = class {
    constructor() {
        this.validTypes = new Set();
        {
            const wrrt = browser.webRequest.ResourceType;
            for ( const typeKey in wrrt ) {
                if ( wrrt.hasOwnProperty(typeKey) ) {
                    this.validTypes.add(wrrt[typeKey]);
                }
            }
        }
        this.suspendableListener = undefined;
        this.listenerMap = new WeakMap();
        this.suspendDepth = 0;

        browser.webRequest.onBeforeRequest.addListener(
            details => {
                this.normalizeDetails(details);
                if ( this.suspendDepth !== 0 && details.tabId >= 0 ) {
                    return this.suspendOneRequest(details);
                }
                return this.onBeforeSuspendableRequest(details);
            },
            this.denormalizeFilters({ urls: [ 'http://*/*', 'https://*/*' ] }),
            [ 'blocking' ]
        );
    }
    setOptions(/* options */) {
    }
    normalizeDetails(/* details */) {
    }
    denormalizeFilters(filters) {
        const urls = filters.urls || [ '<all_urls>' ];
        let types = filters.types;
        if ( Array.isArray(types) ) {
            types = this.denormalizeTypes(types);
        }
        if (
            (this.validTypes.has('websocket')) &&
            (types === undefined || types.indexOf('websocket') !== -1) &&
            (urls.indexOf('<all_urls>') === -1)
        ) {
            if ( urls.indexOf('ws://*/*') === -1 ) {
                urls.push('ws://*/*');
            }
            if ( urls.indexOf('wss://*/*') === -1 ) {
                urls.push('wss://*/*');
            }
        }
        return { types, urls };
    }
    denormalizeTypes(types) {
        return types;
    }
    canonicalNameFromHostname(/* hn */) {
    }
    addListener(which, clientListener, filters, options) {
        const actualFilters = this.denormalizeFilters(filters);
        const actualListener = this.makeNewListenerProxy(clientListener);
        browser.webRequest[which].addListener(
            actualListener,
            actualFilters,
            options
        );
    }
    onBeforeSuspendableRequest(details) {
        if ( this.suspendableListener === undefined ) { return; }
        return this.suspendableListener(details);
    }
    setSuspendableListener(listener) {
        this.suspendableListener = listener;
    }
    removeListener(which, clientListener) {
        const actualListener = this.listenerMap.get(clientListener);
        if ( actualListener === undefined ) { return; }
        this.listenerMap.delete(clientListener);
        browser.webRequest[which].removeListener(actualListener);
    }
    makeNewListenerProxy(clientListener) {
        const actualListener = details => {
            this.normalizeDetails(details);
            return clientListener(details);
        };
        this.listenerMap.set(clientListener, actualListener);
        return actualListener;
    }
    suspendOneRequest() {
    }
    unsuspendAllRequests() {
    }
    suspend(force = false) {
        if ( this.canSuspend() || force ) {
            this.suspendDepth += 1;
        }
    }
    unsuspend(all = false) {
        if ( this.suspendDepth === 0 ) { return; }
        if ( all ) {
            this.suspendDepth = 0;
        } else {
            this.suspendDepth -= 1;
        }
        if ( this.suspendDepth !== 0 ) { return; }
        this.unsuspendAllRequests();
    }
    canSuspend() {
        return false;
    }
    async benchmark() {
        if ( typeof µBlock !== 'object' ) { return; }
        const requests = await µBlock.loadBenchmarkDataset();
        if ( Array.isArray(requests) === false || requests.length === 0 ) {
            console.info('No requests found to benchmark');
            return;
        }
        const mappedTypes = new Map([
            [ 'document', 'main_frame' ],
            [ 'subdocument', 'sub_frame' ],
        ]);
        console.info('vAPI.net.onBeforeSuspendableRequest()...');
        const t0 = self.performance.now();
        const promises = [];
        const details = {
            documentUrl: '',
            tabId: -1,
            parentFrameId: -1,
            frameId: 0,
            type: '',
            url: '',
        };
        for ( const request of requests ) {
            details.documentUrl = request.frameUrl;
            details.tabId = -1;
            details.parentFrameId = -1;
            details.frameId = 0;
            details.type = mappedTypes.get(request.cpt) || request.cpt;
            details.url = request.url;
            if ( details.type === 'main_frame' ) { continue; }
            promises.push(this.onBeforeSuspendableRequest(details));
        }
        return Promise.all(promises).then(results => {
            let blockCount = 0;
            for ( const r of results ) {
                if ( r !== undefined ) { blockCount += 1; }
            }
            const t1 = self.performance.now();
            const dur = t1 - t0;
            console.info(`Evaluated ${requests.length} requests in ${dur.toFixed(0)} ms`);
            console.info(`\tBlocked ${blockCount} requests`);
            console.info(`\tAverage: ${(dur / requests.length).toFixed(3)} ms per request`);
        });
    }
};



vAPI.contextMenu = webext.menus && {
    _callback: null,
    _entries: [],
    _createEntry: function(entry) {
        webext.menus.create(JSON.parse(JSON.stringify(entry)));
    },
    onMustUpdate: function() {},
    setEntries: function(entries, callback) {
        entries = entries || [];
        let n = Math.max(this._entries.length, entries.length);
        for ( let i = 0; i < n; i++ ) {
            const oldEntryId = this._entries[i];
            const newEntry = entries[i];
            if ( oldEntryId && newEntry ) {
                if ( newEntry.id !== oldEntryId ) {
                    webext.menus.remove(oldEntryId);
                    this._createEntry(newEntry);
                    this._entries[i] = newEntry.id;
                }
            } else if ( oldEntryId && !newEntry ) {
                webext.menus.remove(oldEntryId);
            } else if ( !oldEntryId && newEntry ) {
                this._createEntry(newEntry);
                this._entries[i] = newEntry.id;
            }
        }
        n = this._entries.length = entries.length;
        callback = callback || null;
        if ( callback === this._callback ) {
            return;
        }
        if ( n !== 0 && callback !== null ) {
            webext.menus.onClicked.addListener(callback);
            this._callback = callback;
        } else if ( n === 0 && this._callback !== null ) {
            webext.menus.onClicked.removeListener(this._callback);
            this._callback = null;
        }
    }
};

/******************************************************************************/
/******************************************************************************/

vAPI.commands = browser.commands;

/******************************************************************************/
/******************************************************************************/

vAPI.adminStorage = (( ) => {
    if ( webext.storage.managed instanceof Object === false ) {
        return {
            get: function() {
                return Promise.resolve();
            },
        };
    }
    return {
        get: async function(key) {
            let bin;
            try {
                bin = await webext.storage.managed.get(key);
            } catch(ex) {
            }
            if ( typeof key === 'string' && bin instanceof Object ) {
                return bin[key];
            }
            return bin;
        }
    };
})();

vAPI.localStorage = {
    start: async function() {
        if ( this.cache instanceof Promise ) { return this.cache; }
        if ( this.cache instanceof Object ) { return this.cache; }
        this.cache = webext.storage.local.get('localStorage').then(bin => {
            this.cache = bin instanceof Object &&
                bin.localStorage instanceof Object
                    ? bin.localStorage
                    : {};
        });
        return this.cache;
    },
    clear: function() {
        this.cache = {};
        return webext.storage.local.set({ localStorage: this.cache });
    },
    getItem: function(key) {
        if ( this.cache instanceof Object === false ) {
            console.info(`localStorage.getItem('${key}') not ready`);
            return null;
        }
        const value = this.cache[key];
        return value !== undefined ? value : null;
    },
    getItemAsync: async function(key) {
        await this.start();
        const value = this.cache[key];
        return value !== undefined ? value : null;
    },
    removeItem: async function(key) {
        this.setItem(key);
    },
    setItem: async function(key, value = undefined) {
        await this.start();
        if ( value === this.cache[key] ) { return; }
        this.cache[key] = value;
        return webext.storage.local.set({ localStorage: this.cache });
    },
    cache: undefined,
};

vAPI.localStorage.start();

/******************************************************************************/
/******************************************************************************/

// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync

vAPI.cloud = (( ) => {
   // Nem todas as plataformas suportam `webext.storage.sync`   
    if ( webext.storage.sync instanceof Object === false ) { return; }

     // Atualmente, apenas o Chromium suporte as seguintes constantes - estas
    // os valores serão assumidos para plataformas que não os definem.
    // https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/storage/sync
    //> Você pode armazenar até 100 KB de dados usando esta API
    const MAX_ITEMS =
        webext.storage.sync.MAX_ITEMS || 512;
    const QUOTA_BYTES =
        webext.storage.sync.QUOTA_BYTES || 102400;
    const QUOTA_BYTES_PER_ITEM =
        webext.storage.sync.QUOTA_BYTES_PER_ITEM || 8192;

    const chunkCountPerFetch = 16; // Must be a power of 2
    const maxChunkCountPerItem = Math.floor(MAX_ITEMS * 0.75) & ~(chunkCountPerFetch - 1);

    const evalMaxChunkSize = function() {
        return Math.floor(
            QUOTA_BYTES_PER_ITEM *
            (vAPI.webextFlavor.soup.has('firefox') ? 0.6 : 0.75)
        );
    };

    let maxChunkSize = evalMaxChunkSize();

    // O valor real real do webextFlavor não pode ser definido em pedra, então ouça
    // para possíveis mudanças futuras.
    window.addEventListener('webextFlavor', function() {
        maxChunkSize = evalMaxChunkSize();
    }, { once: true });

    const options = {
        defaultDeviceName: window.navigator.platform,
        deviceName: undefined,
    };

    vAPI.localStorage.getItemAsync('deviceName').then(value => {
        options.deviceName = value;
    });

    // Isso é usado para descobrir uma contagem aproximada de quantos pedaços existem:
    // Nós "pesquisamos" um índice específico para ter uma ideia aproximada de como
    // grande é a string armazenada.
    // Isso permite a leitura de um único item com apenas 2 operações de sincronização - a
    // bom dado chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE
    // e chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR.

    const getCoarseChunkCount = async function(datakey) {
        const keys = {};
        for ( let i = 0; i < maxChunkCountPerItem; i += 16 ) {
            keys[datakey + i.toString()] = '';
        }
        let bin;
        try {
            bin = await webext.storage.sync.get(keys);
        } catch (reason) {
            return reason;
        }
        let chunkCount = 0;
        for ( let i = 0; i < maxChunkCountPerItem; i += 16 ) {
            if ( bin[datakey + i.toString()] === '' ) { break; }
            chunkCount = i + 16;
        }
        return chunkCount;
    };

    const deleteChunks = async function(datakey, start) {
        const keys = [];

        const n = await getCoarseChunkCount(datakey);
        for ( let i = start; i < n; i++ ) {
            keys.push(datakey + i.toString());
        }
        if ( keys.length !== 0 ) {
            webext.storage.sync.remove(keys);
        }
    };

    const push = async function(details) {
        const { datakey, data, encode } = details;
        if (
            data === undefined ||
            typeof data === 'string' && data === ''
        ) {
            return deleteChunks(datakey, 0);
        }
        const item = {
            source: options.deviceName || options.defaultDeviceName,
            tstamp: Date.now(),
            data,
        };
        const json = JSON.stringify(item);
        const encoded = encode instanceof Function
            ? await encode(json)
            : json;

        const bin = {};
        const chunkCount = Math.ceil(encoded.length / maxChunkSize);
        for ( let i = 0; i < chunkCount; i++ ) {
            bin[datakey + i.toString()]
                = encoded.substr(i * maxChunkSize, maxChunkSize);
        }
        bin[datakey + chunkCount.toString()] = ''; // Sentinel

        // Remova os fragmentos finais potencialmente não utilizados antes de armazenar os dados,
        // isso irá liberar espaço de armazenamento que poderia causar o push
        // operação para falhar.
        try {
            await deleteChunks(datakey, chunkCount + 1);
        } catch (reason) {
        }

         // Envie os dados para o armazenamento em nuvem fornecido pelo navegador.
        try {
            await webext.storage.sync.set(bin);
        } catch (reason) {
            return String(reason);
        }
    };

    const pull = async function(details) {
        const { datakey, decode } = details;

        const result = await getCoarseChunkCount(datakey);
        if ( typeof result !== 'number' ) {
            return result;
        }
        const chunkKeys = {};
        for ( let i = 0; i < result; i++ ) {
            chunkKeys[datakey + i.toString()] = '';
        }

        let bin;
        try {
            bin = await webext.storage.sync.get(chunkKeys);
        } catch (reason) {
            return String(reason);
        }
//////////////
        let encoded = [];
        let i = 0;
        for (;;) {
            const slice = bin[datakey + i.toString()];
            if ( slice === '' || slice === undefined ) { break; }
            encoded.push(slice);
            i += 1;
        }
        encoded = encoded.join('');
        const json = decode instanceof Function
            ? await decode(encoded)
            : encoded;
        let entry = null;
        try {
            entry = JSON.parse(json);
        } catch(ex) {
        }
        return entry;
    };

    const used = async function(datakey) {
        if ( webext.storage.sync.getBytesInUse instanceof Function === false ) {
            return;
        }
        const coarseCount = await getCoarseChunkCount(datakey);
        if ( typeof coarseCount !== 'number' ) { return; }
        const keys = [];
        for ( let i = 0; i < coarseCount; i++ ) {
            keys.push(`${datakey}${i}`);
        }
        let results;
        try {
            results = await Promise.all([
                webext.storage.sync.getBytesInUse(keys),
                webext.storage.sync.getBytesInUse(null),
            ]);
        } catch(ex) {
        }
        if ( Array.isArray(results) === false ) { return; }
        return { used: results[0], total: results[1], max: QUOTA_BYTES };
    };

    const getOptions = function(callback) {
        if ( typeof callback !== 'function' ) { return; }
        callback(options);
    };

    const setOptions = function(details, callback) {
        if ( typeof details !== 'object' || details === null ) { return; }

        if ( typeof details.deviceName === 'string' ) {
            vAPI.localStorage.setItem('deviceName', details.deviceName);
            options.deviceName = details.deviceName;
        }

        getOptions(callback);
    };

    return { push, pull, used, getOptions, setOptions };
})();

/******************************************************************************/
/******************************************************************************/

// <<<<< fim do escopo local
}

/******************************************************************************/
