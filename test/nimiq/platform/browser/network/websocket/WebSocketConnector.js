class WebSocketConnector extends Observable {
    constructor() {
        super();
    }

    connect(peerAddress) {
        if (!Services.isWebSocket(peerAddress.services)) throw 'Malformed peerAddress';

        const ws = new WebSocket('wss://' + peerAddress.host + ':' + peerAddress.port);
    	ws.onopen = () => {
            const conn = new PeerConnection(ws, PeerConnection.Protocol.WEBSOCKET, peerAddress.host, peerAddress.port);
            this.fire('connection', conn);
        };
        ws.onerror = e => this.fire('error', peerAddress, e);
    }
}
