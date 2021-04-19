// Para página de fundo ou páginas sem fundo
'use strict';

/******************************************************************************/
/******************************************************************************/

vAPI.T0 = Date.now();

/******************************************************************************/

vAPI.setTimeout = vAPI.setTimeout || self.setTimeout.bind(self);

/******************************************************************************/

vAPI.webextFlavor = {
    major: 0,
    soup: new Set()
};

(( ) => {
    const ua = navigator.userAgent;
    const flavor = vAPI.webextFlavor;
    const soup = flavor.soup;
    const dispatch = function() {
        window.dispatchEvent(new CustomEvent('webextFlavor'));
    };

    // This is always true.
    soup.add('ublock').add('webext');

    // Whether this is a dev build.
    if ( /^\d+\.\d+\.\d+\D/.test(browser.runtime.getManifest().version) ) {
        soup.add('devbuild');
    }

    if ( /\bMobile\b/.test(ua) ) {
        soup.add('mobile');
    }

    // Asynchronous
    if (
        browser instanceof Object &&
        typeof browser.runtime.getBrowserInfo === 'function'
    ) {
        browser.runtime.getBrowserInfo().then(info => {
            flavor.major = parseInt(info.version, 10) || 60;
            soup.add(info.vendor.toLowerCase())
                .add(info.name.toLowerCase());
            if ( soup.has('firefox') && flavor.major < 57 ) {
                soup.delete('html_filtering');
            }
            dispatch();
        });
        if ( browser.runtime.getURL('').startsWith('moz-extension://') ) {
            soup.add('firefox')
                .add('user_stylesheet')
                .add('html_filtering');
            flavor.major = 60;
        }
        return;
    }

    // Synchronous -- order of tests is important
    const match = /\bChrom(?:e|ium)\/([\d.]+)/.exec(ua);
    if ( match !== null ) {
        soup.add('chromium');
        flavor.major = parseInt(match[1], 10) || 0;
        // https://github.com/gorhill/uBlock/issues/3588
        if ( flavor.major >= 66 ) {
            soup.add('user_stylesheet');
        }
    }

    // Don't starve potential listeners
    vAPI.setTimeout(dispatch, 97);
})();

/******************************************************************************/

{
    const punycode = self.punycode;
    const reCommonHostnameFromURL  = /^https?:\/\/([0-9a-z_][0-9a-z._-]*[0-9a-z])\//;
    const reAuthorityFromURI       = /^(?:[^:\/?#]+:)?(\/\/[^\/?#]+)/;
    const reHostFromNakedAuthority = /^[0-9a-z._-]+[0-9a-z]$/i;
    const reHostFromAuthority      = /^(?:[^@]*@)?([^:]+)(?::\d*)?$/;
    const reIPv6FromAuthority      = /^(?:[^@]*@)?(\[[0-9a-f:]+\])(?::\d*)?$/i;
    const reMustNormalizeHostname  = /[^0-9a-z._-]/;

    vAPI.hostnameFromURI = function(uri) {
        let matches = reCommonHostnameFromURL.exec(uri);
        if ( matches !== null ) { return matches[1]; }
        matches = reAuthorityFromURI.exec(uri);
        if ( matches === null ) { return ''; }
        const authority = matches[1].slice(2);
        if ( reHostFromNakedAuthority.test(authority) ) {
            return authority.toLowerCase();
        }
        matches = reHostFromAuthority.exec(authority);
        if ( matches === null ) {
            matches = reIPv6FromAuthority.exec(authority);
            if ( matches === null ) { return ''; }
        }
        let hostname = matches[1];
        while ( hostname.endsWith('.') ) {
            hostname = hostname.slice(0, -1);
        }
        if ( reMustNormalizeHostname.test(hostname) ) {
            hostname = punycode.toASCII(hostname.toLowerCase());
        }
        return hostname;
    };

    const reHostnameFromNetworkURL =
        /^(?:http|ws|ftp)s?:\/\/([0-9a-z_][0-9a-z._-]*[0-9a-z])(?::\d+)?\//;

    vAPI.hostnameFromNetworkURL = function(url) {
        const matches = reHostnameFromNetworkURL.exec(url);
        return matches !== null ? matches[1] : '';
    };

    const psl = self.publicSuffixList;
    const reIPAddressNaive = /^\d+\.\d+\.\d+\.\d+$|^\[[\da-zA-Z:]+\]$/;

    vAPI.domainFromHostname = function(hostname) {
        return reIPAddressNaive.test(hostname)
            ? hostname
            : psl.getDomain(hostname);
    };
}

/******************************************************************************/

vAPI.download = function(details) {
    if ( !details.url ) { return; }
    const a = document.createElement('a');
    a.href = details.url;
    a.setAttribute('download', details.filename || '');
    a.setAttribute('type', 'text/plain');
    a.dispatchEvent(new MouseEvent('click'));
};

/******************************************************************************/

vAPI.getURL = browser.runtime.getURL;

/******************************************************************************/

vAPI.i18n = browser.i18n.getMessage;

// http://www.w3.org/International/questions/qa-scripts#directions
document.body.setAttribute(
    'dir',
    ['ar', 'he', 'fa', 'ps', 'ur'].indexOf(vAPI.i18n('@@ui_locale')) !== -1
        ? 'rtl'
        : 'ltr'
);

/******************************************************************************/

vAPI.closePopup = function() {
    if ( vAPI.webextFlavor.soup.has('firefox') ) {
        window.close();
        return;
    }

    
    window.open('', '_self').close();
};

/******************************************************************************/

vAPI.localStorage = {
    clear: function() {
        vAPI.messaging.send('vapi', {
            what: 'localStorage',
            fn: 'clear',
        });
    },
    getItemAsync: function(key) {
        return vAPI.messaging.send('vapi', {
            what: 'localStorage',
            fn: 'getItemAsync',
            args: [ key ],
        });
    },
    removeItem: function(key) {
        return vAPI.messaging.send('vapi', {
            what: 'localStorage',
            fn: 'removeItem',
            args: [ key ],
        });
    },
    setItem: function(key, value = undefined) {
        return vAPI.messaging.send('vapi', {
            what: 'localStorage',
            fn: 'setItem',
            args: [ key, value ]
        });
    },
};

void 0;