class PublicKey extends Primitive {

	static get SERIALIZED_SIZE() {
		return 65;
	}

	constructor(arg) {
		super(arg, PublicKey.SERIALIZED_SIZE);
	}

	static unserialize(buf) {
		return new PublicKey(buf.read(PublicKey.SERIALIZED_SIZE));
	}

	serialize(buf) {
		buf = buf || new SerialBuffer(this.serializedSize);
		buf.write(this);
		return buf;
	}

	get serializedSize() {
		return PublicKey.SERIALIZED_SIZE;
	}

	equals(o) {
		return o instanceof PublicKey
			&& super.equals(o);
	}

	toAddress() {
		return Crypto.publicToAddress(this);
	}
}
Class.register(PublicKey);
