class Cashlink extends Nimiq.Observable {
	/** Typically you'll not use the constructor directly, but the static createCashlink methods */
	constructor($, transferWallet) {
		super();
		this.$ = $;
		this._transferWallet = transferWallet;
		this._value = 0;
		this.$.mempool.on('transaction-added', this._onTransactionAdded.bind(this));
		this.$.accounts.on(transferWallet.address, this._onBalanceChanged.bind(this));
	}

	static createCashlink($) {
		return Nimiq.Wallet.createVolatile().then(transferWallet => {
			return new Cashlink($, transferWallet);
		});
	}

	fund(amount, fee = 0) {
		if (!Nimiq.NumberUtils.isUint64(amount) || amount===0) {
			// all amounts and fees are always integers to ensure floating point precision.
			throw Error("Only positive integer amounts allowed.");
		}
		if (!Nimiq.NumberUtils.isUint64(fee) || fee>=amount) {
			throw Error("Illegal fee.");
		}

		return this.$.accounts.getBalance(this.$.wallet.address).then(balance => {
			if (balance.value < amount) {
				throw Error("You can't send more money than you own");
			}
			// we do amount-fee because the recipient has to pay the fee
			return this.$.wallet.createTransaction(this._transferWallet.address, amount-fee, fee, balance.nonce).then(transaction => {
				return this.$.mempool.pushTransaction(transaction).then(() => {
					this._value = amount - fee;
				});
			});
		});
	}


	static decodeCashlink($, url) {
		let urlParts = url.split('#');
		if (urlParts[0].indexOf(Cashlink.BASE_URL)===-1) {
			throw Error("Not a valid cashlink.");
		}
		let assignments = urlParts[1].split('&');
		let vars = {};
		for (let assignment of assignments) {
			let [key, value] = assignment.split('=', 2);
			vars[key] = value;
		}

		if (!vars.key) {
			throw Error("Not a valid cashlink.");
		}

		let privateKey = Nimiq.PrivateKey.unserialize(BufferUtils.fromBase64(vars.key));
		return Nimiq.KeyPair.derive(privateKey).then(keyPair => {
			return new Nimiq.Wallet(keyPair).then(transferWallet => {
				let cashlink = new Cashlink($, transferWallet);
				cashlink._value = vars.value;
				return cashlink;
			});
		});
	}


	accept(fee = 0) {
		// get out the money. Only the confirmed amount, because we can't request unconfirmed money.
		return this.$.accounts.getBalance(this._transferWallet.address).then(balance => {
			if (balance.value === 0) {
				throw Error('There is no confirmed balance in this link');
			}
			return this._transferWallet.createTransaction(this.$.wallet.address, balance.value-fee, fee, balance.nonce).then(transaction => {
				return this.$.mempool.pushTransaction(transaction);
			});
		});
	}


	getAmount(includeUnconfirmed) {
		return this.$.accounts.getBalance(this._transferWallet.address).then(res => {
			let balance = res.value;
			if (includeUnconfirmed) {
				let transferWalletAddress = this._transferWallet.address;
				return this.$.mempool._evictTransactions().then(() => {
					// ensure that already validated transactions are ignored
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
					return balance;
				});
			}
			return balance;
		});
	}


	_onTransactionAdded(transaction) {
		if (transaction.recipientAddr.equals(this._transferWallet.address)
			|| (transaction.senderPubKey).equals(this._transferWallet.publicKey)) {
			return this.getAmount(true).then(val => {
				this.fire('unconfirmed-amount-changed', val);
			});
		}
	}


	_onBalanceChanged(account) {
		this.fire('confirmed-amount-changed', account.balance.value);
	}


	getUrl() {
		return Cashlink.BASE_URL + '#key=' + Nimiq.BufferUtils.toBase64(this._transferWallet.keyPair.privateKey.serialize()) + '&value=' + this._value;
	}
}
Cashlink.BASE_URL = 'nimiq.com/cashlinks';
