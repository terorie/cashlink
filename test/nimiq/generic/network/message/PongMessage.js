class PongMessage extends Message {
    constructor(nonce) {
        super(Message.Type.PONG);
        this._nonce = nonce;
    }

    static unserialize(buf) {
        Message.unserialize(buf);
        const nonce = buf.readUint32();
        return new PongMessage(nonce);
    }

    serialize(buf) {
        buf = buf || new SerialBuffer(this.serializedSize);
        super.serialize(buf);
        buf.writeUint32(this._nonce);
        return buf;
    }

    get serializedSize() {
        return super.serializedSize
            + /*nonce*/ 4;
    }

    get nonce() {
        return this._nonce;
    }
}
Class.register(PongMessage);
