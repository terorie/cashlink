class Cashlink extends Nimiq.Observable {
	/** Typically you'll not use the constructor directly, but the static createCashlink methods */
	constructor($, transferWallet) {
		super();
		this.$ = $;
		this._transferWallet = transferWallet;
		this.$.mempool.on('transaction-added', this._onTransactionAdded.bind(this));
		this.$.accounts.on(transferWallet.address, this._onBalanceChanged.bind(this));
	}


	static async createCashlink($, amount, fee = 0) {
		let transferWallet = await Nimiq.Wallet.createVolatile();
		let cashlink = new Cashlink($, transferWallet);
		if (!NumberUtils.isUint64(amount) || amount===0) {
			// all amounts and fees are always integers to ensure floating point precision.
			throw Error("Only positive integer amounts allowed.");
		}
		if (!NumberUtils.isUint64(fee) || fee>=amount) {
			throw Error("Illegal fee.");
		}
		let balance = await $.accounts.getBalance($.wallet.address);
		if (balance.value < amount) {
			throw Error("You can't send more money then you own");
		}
		// we do amount-fee because the recipient has to pay the fee
		let transaction = await $.wallet.createTransaction(transferWallet.address, amount-fee, fee, balance.nonce);
		await $.mempool.pushTransaction(transaction);
		return cashlink;
	}


	static async decodeCashlink($, url) {
		let urlParts = url.split('#');
		if (urlParts[0].indexOf(Cashlink.BASE_URL)===-1) {
			throw Error("Not a valid cashlink.");
		}
		let privateKey = Nimiq.PrivateKey.unserialize(BufferUtils.fromBase64(urlParts[1]));
		let keyPair = await Nimiq.KeyPair.derive(privateKey);
		let transferWallet = await new Wallet(keyPair);
		return new Cashlink($, transferWallet);
	}


	async accept(fee = 0) {
		// get out the money. Only the confirmed amount, because we can't request unconfirmed money.
		let balance = await this.$.accounts.getBalance(this._transferWallet.address);
		if (balance.value === 0) {
			throw Error('There is no confirmed balance in this link');
		}
		let transaction = await this._transferWallet.createTransaction(this.$.wallet.address,
			balance.value-fee, fee, balance.nonce);
		await this.$.mempool.pushTransaction(transaction);
	}


	async getAmount(includeUnconfirmed) {
		let balance = (await this.$.accounts.getBalance(this._transferWallet.address)).value;
		if (includeUnconfirmed) {
			let transferWalletAddress = this._transferWallet.address;
			await this.$.mempool._evictTransactions(); // ensure that already validated transactions are ignored
			let transactions = Object.values(this.$.mempool._transactions);
			for (let i=0; i<transactions.length; ++i) {
				let transaction = transactions[i];
				let senderPubKey = transaction.senderPubKey;
				let recipientAddr = transaction.recipientAddr;
				if (recipientAddr.equals(transferWalletAddress)) {
					// money sent to the transfer wallet
					balance += transaction.value;
				} else if (senderPubKey.equals(this._transferWallet.publicKey)) {
					balance -= transaction.value + transaction.fee;
				}
			}
		}
		return balance;
	}


	async _onTransactionAdded(transaction) {
		if (transaction.recipientAddr.equals(this._transferWallet.address)
			|| (transaction.senderPubKey).equals(this._transferWallet.publicKey)) {
			this.fire('unconfirmed-amount-changed', await this.getAmount(true));
		}
	}


	_onBalanceChanged(account) {
		this.fire('confirmed-amount-changed', account.balance.value);
	}


	getUrl() {
		return Cashlink.BASE_URL + '#' + BufferUtils.toBase64(this._transferWallet.keyPair.privateKey.serialize());
	}
}
Cashlink.BASE_URL = 'nimiq.com/receive';