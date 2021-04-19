// Para página sem fundo

'use strict';

/******************************************************************************/

// >>>>>>>> início do HUGE-IF-BLOCK
if (
    typeof vAPI === 'object' &&
    vAPI.randomToken instanceof Function === false
) {

/******************************************************************************/
/******************************************************************************/

vAPI.randomToken = function() {
    const n = Math.random();
    return String.fromCharCode(n * 26 + 97) +
        Math.floor(
            (0.25 + n * 0.75) * Number.MAX_SAFE_INTEGER
        ).toString(36).slice(-8);
};

vAPI.sessionId = vAPI.randomToken();
vAPI.setTimeout = vAPI.setTimeout || self.setTimeout.bind(self);

/******************************************************************************/

vAPI.shutdown = {
    jobs: [],
    add: function(job) {
        this.jobs.push(job);
    },
    exec: function() {
        // Desligue de forma assíncrona, para garantir que os trabalhos de desligamento sejam chamados de
        // o contexto principal.
        self.requestIdleCallback(( ) => {
            const jobs = this.jobs.slice();
            this.jobs.length = 0;
            while ( jobs.length !== 0 ) {
                (jobs.pop())();
            }
        });
    },
    remove: function(job) {
        let pos;
        while ( (pos = this.jobs.indexOf(job)) !== -1 ) {
            this.jobs.splice(pos, 1);
        }
    }
};

/******************************************************************************/

vAPI.messaging = {
    port: null,
    portTimer: null,
    portTimerDelay: 10000,
    extended: undefined,
    extensions: [],
    msgIdGenerator: 1,
    pending: new Map(),
    shuttingDown: false,

    shutdown: function() {
        this.shuttingDown = true;
        this.destroyPort();
    },


    disconnectListener: function() {
        this.port = null;
        if ( window !== window.top ) {
            vAPI.shutdown.exec();
        }
    },
    disconnectListenerBound: null,

    
    messageListener: function(details) {
        if ( typeof details !== 'object' || details === null ) { return; }

         // Resposta a mensagem específica enviada anteriormente
        if ( details.msgId !== undefined ) {
            const resolver = this.pending.get(details.msgId);
            if ( resolver !== undefined ) {
                this.pending.delete(details.msgId);
                resolver(details.msg);
                return;
            }
        }

        // Mensagens não tratadas
        this.extensions.every(ext => ext.canProcessMessage(details) !== true);
    },
    messageListenerBound: null,

    canDestroyPort: function() {
        return this.pending.size === 0 &&
            (
                this.extensions.length === 0 ||
                this.extensions.every(e => e.canDestroyPort())
            );
    },

    mustDestroyPort: function() {
        if ( this.extensions.length === 0 ) { return; }
        this.extensions.forEach(e => e.mustDestroyPort());
        this.extensions.length = 0;
    },

    portPoller: function() {
        this.portTimer = null;
        if ( this.port !== null && this.canDestroyPort() ) {
            return this.destroyPort();
        }
        this.portTimer = vAPI.setTimeout(this.portPollerBound, this.portTimerDelay);
        this.portTimerDelay = Math.min(this.portTimerDelay * 2, 60 * 60 * 1000);
    },
    portPollerBound: null,

    destroyPort: function() {
        if ( this.portTimer !== null ) {
            clearTimeout(this.portTimer);
            this.portTimer = null;
        }
        const port = this.port;
        if ( port !== null ) {
            port.disconnect();
            port.onMessage.removeListener(this.messageListenerBound);
            port.onDisconnect.removeListener(this.disconnectListenerBound);
            this.port = null;
        }
        this.mustDestroyPort();
         // serviço de callbacks pendentes
        if ( this.pending.size !== 0 ) {
            const pending = this.pending;
            this.pending = new Map();
            for ( const resolver of pending.values() ) {
                resolver();
            }
        }
    },

    createPort: function() {
        if ( this.shuttingDown ) { return null; }
        if ( this.messageListenerBound === null ) {
            this.messageListenerBound = this.messageListener.bind(this);
            this.disconnectListenerBound = this.disconnectListener.bind(this);
            this.portPollerBound = this.portPoller.bind(this);
        }
        try {
            this.port = browser.runtime.connect({name: vAPI.sessionId}) || null;
        } catch (ex) {
            this.port = null;
        }
        // Não ter uma porta válida neste momento significa que o processo principal é
        // não disponível: não adianta manter os scripts de conteúdo ativos.
        if ( this.port === null ) {
            vAPI.shutdown.exec();
            return null;
        }
        this.port.onMessage.addListener(this.messageListenerBound);
        this.port.onDisconnect.addListener(this.disconnectListenerBound);
        this.portTimerDelay = 10000;
        if ( this.portTimer === null ) {
            this.portTimer = vAPI.setTimeout(
                this.portPollerBound,
                this.portTimerDelay
            );
        }
        return this.port;
    },

    getPort: function() {
        return this.port !== null ? this.port : this.createPort();
    },

    send: function(channel, msg) {
         // Uma lacuna muito grande entre a última solicitação e a última resposta significa
        // o processo principal não está mais acessível: vazamentos de memória e problemas
        // desempenho torna-se um risco - especialmente para vida longa e dinâmica
        // Páginas. Proteja-se contra isso.
        if ( this.pending.size > 50 ) {
            vAPI.shutdown.exec();
        }
        const port = this.getPort();
        if ( port === null ) {
            return Promise.resolve();
        }
        const msgId = this.msgIdGenerator++;
        const promise = new Promise(resolve => {
            this.pending.set(msgId, resolve);
        });
        port.postMessage({ channel, msgId, msg });
        return promise;
    },

    // Dynamically extend capabilities.
    extend: function() {
        if ( this.extended === undefined ) {
            this.extended = vAPI.messaging.send('vapi', {
                what: 'extendClient'
            }).then(( ) => {
                return self.vAPI instanceof Object &&
                       this.extensions.length !== 0;
            }).catch(( ) => {
            });
        }
        return this.extended;
    },
};

vAPI.shutdown.add(( ) => {
    vAPI.messaging.shutdown();
    window.vAPI = undefined;
});

void 0;
}