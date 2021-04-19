// Para a página de fundo

'use strict';

/******************************************************************************/

(( ) => {
    // https://github.com/uBlockOrigin/uBlock-issues/issues/407
    if ( vAPI.webextFlavor.soup.has('chromium') === false ) { return; }

    const extToTypeMap = new Map([
        ['eot','font'],['otf','font'],['svg','font'],['ttf','font'],['woff','font'],['woff2','font'],
        ['mp3','media'],['mp4','media'],['webm','media'],
        ['gif','image'],['ico','image'],['jpeg','image'],['jpg','image'],['png','image'],['webp','image']
    ]);

    const headerValue = (headers, name) => {
        let i = headers.length;
        while ( i-- ) {
            if ( headers[i].name.toLowerCase() === name ) {
                return headers[i].value.trim();
            }
        }
        return '';
    };

    const parsedURL = new URL('https://www.example.org/');

    // Estende a classe base para normalizar de acordo com a plataforma.

    vAPI.Net = class extends vAPI.Net {
        constructor() {
            super();
            this.suspendedTabIds = new Set();
        }
        normalizeDetails(details) {
            
            if (
                typeof details.initiator === 'string' &&
                details.initiator !== 'null'
            ) {
                details.documentUrl = details.initiator;
            }

            let type = details.type;

            if ( type === 'imageset' ) {
                details.type = 'image';
                return;
            }

             // O resto do código da função é normalizar o tipo
            if ( type !== 'other' ) { return; }

            // Tente mapear parte da "extensão" conhecida do URL para o tipo de solicitação.
            parsedURL.href = details.url;
            const path = parsedURL.pathname,
                  pos = path.indexOf('.', path.length - 6);
            if ( pos !== -1 && (type = extToTypeMap.get(path.slice(pos + 1))) ) {
                details.type = type;
                return;
            }

            // Tente extrair o tipo dos cabeçalhos de resposta, se houver.
            if ( details.responseHeaders ) {
                type = headerValue(details.responseHeaders, 'content-type');
                if ( type.startsWith('font/') ) {
                    details.type = 'font';
                    return;
                }
                if ( type.startsWith('image/') ) {
                    details.type = 'image';
                    return;
                }
                if ( type.startsWith('audio/') || type.startsWith('video/') ) {
                    details.type = 'media';
                    return;
                }
            }
        }
        
        denormalizeTypes(types) {
            if ( types.length === 0 ) {
                return Array.from(this.validTypes);
            }
            const out = new Set();
            for ( const type of types ) {
                if ( this.validTypes.has(type) ) {
                    out.add(type);
                }
            }
            if ( out.has('other') === false ) {
                for ( const type of extToTypeMap.values() ) {
                    if ( out.has(type) ) {
                        out.add('other');
                        break;
                    }
                }
            }
            return Array.from(out);
        }
        suspendOneRequest(details) {
            this.suspendedTabIds.add(details.tabId);
            return { cancel: true };
        }
        unsuspendAllRequests() {
            for ( const tabId of this.suspendedTabIds ) {
                vAPI.tabs.reload(tabId);
            }
            this.suspendedTabIds.clear();
        }
    };
})();



vAPI.prefetching = (( ) => {
    // https://github.com/uBlockOrigin/uBlock-issues/issues/407
    if ( vAPI.webextFlavor.soup.has('chromium') === false ) { return; }

    let listening = false;

    const onHeadersReceived = function(details) {
        details.responseHeaders.push({
            name: 'X-DNS-Prefetch-Control',
            value: 'off'
        });
        return { responseHeaders: details.responseHeaders };
    };

    return state => {
        const wr = chrome.webRequest;
        if ( state && listening ) {
            wr.onHeadersReceived.removeListener(onHeadersReceived);
            listening = false;
        } else if ( !state && !listening ) {
            wr.onHeadersReceived.addListener(
                onHeadersReceived,
                {
                    urls: [ 'http://*/*', 'https://*/*' ],
                    types: [ 'main_frame', 'sub_frame' ]
                },
                [ 'blocking', 'responseHeaders' ]
            );
            listening = true;
        }
    };
})();

/******************************************************************************/