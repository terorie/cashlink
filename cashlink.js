class CashLink {
	constructor($, wallet, value = undefined, message = undefined) {
		this.$ = $;

		this._wallet = wallet;
		this._value = value;
		this._message = message;

		this._immutable = !!(value || message);
		this._eventListeners = {};

		this.$.mempool.on('transaction-added', this._onTransactionAdded.bind(this));
		this.$.accounts.on(wallet.address, this._onBalanceChanged.bind(this));
	}

	static create($) {
		return Nimiq.Wallet.createVolatile()
            .then(wallet => new CashLink($, wallet));
	}

    static async parse($, str) {
        try {
            const buf = Nimiq.BufferUtils.fromBase64Url(str);
            const key = Nimiq.PrivateKey.unserialize(buf);
            const value = buf.readUint64();
            const message = buf.readVarLengthString();

            const keyPair = await Nimiq.KeyPair.derive(key);
            const wallet = await new Nimiq.Wallet(keyPair);

            return new CashLink($, wallet, value, message);
        } catch (e) {
            return undefined;
        }
    }

    render() {
	    const buf = new Nimiq.SerialBuffer(
	        /*key*/ 96 +
            /*value*/ 8 +
            /*message length*/ 1 +
            /*message*/ (this._message ? this._message.length : 0)
        );

	    this._wallet.keyPair.privateKey.serialize(buf);
	    buf.writeUint64(this._value);
	    buf.writeVarLengthString(this._message);

        return Nimiq.BufferUtils.toBase64Url(buf);
    }

    get value() {
        return this._value;
    }

    set value(value) {
	    if (this._immutable) throw 'CashLink is immutable';
	    if (!Nimiq.NumberUtils.isUint64(value) || value === 0) throw 'Malformed value';
	    this._value = value;
    }

    get message() {
	    return decodeURIComponent(this._message);
    }

    set message(message) {
	    if (this._immutable) throw 'CashLink is immutable';
	    this._message = encodeURIComponent(message);
    }

    async fund(fee = 0) {
        if (!Nimiq.NumberUtils.isUint64(fee)) {
            throw 'Malformed fee';
        }

		if (this._value === 0) {
            throw 'Cannot fund CashLink with zero value';
        }

		const balance = await this.$.accounts.getBalance(this.$.wallet.address);
        if (balance.value < this._value) {
            throw 'Insufficient funds';
        }

        // The recipient pays the fee, thus send value - fee.
        const transaction = await this.$.wallet.createTransaction(this._wallet.address, this._value - fee, fee, balance.nonce);
        if (!await this.$.mempool.pushTransaction(transaction)) {
            throw 'Failed to push transaction into mempool';
        }

        this._value = this._value - fee;
	}

	async claim(fee = 0) {
		// get out the money. Only the confirmed amount, because we can't request unconfirmed money.
		const balance = await this.$.accounts.getBalance(this._wallet.address);
        if (balance.value === 0) {
            throw 'There is no confirmed balance in this link';
        }

		const transaction = await this._wallet.createTransaction(this.$.wallet.address, balance.value - fee, fee, balance.nonce);
        if (!await this.$.mempool.pushTransaction(transaction)) {
            throw 'Failed to push transaction into mempool';
        }
	}


	getAmount(includeUnconfirmed) {
		return this.$.accounts.getBalance(this._wallet.address).then(res => {
			let balance = res.value;
			if (includeUnconfirmed) {
				let transferWalletAddress = this._wallet.address;
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
						} else if (senderPubKey.equals(this._wallet.publicKey)) {
							balance -= transaction.value + transaction.fee;
						}
					}
					return balance;
				});
			}
			return balance;
		});
	}


	on(type, callback) {
		if (!(type in this._eventListeners)) {
			this._eventListeners[type] = [];
		}
		this._eventListeners[type].push(callback);
	}


	off(type, callback) {
		if (!(type in this._eventListeners)) {
			return;
		}
		let index = this._eventListeners[type].indexOf(callback);
		if (index === -1) {
			return;
		}
		this._eventListeners[type].splice(index, 1);
	}


	fire(type, arg) {
		if (!(type in this._eventListeners)) {
			return;
		}
		this._eventListeners[type].forEach(function(callback) {
			callback(arg);
		});
	}


	_onTransactionAdded(transaction) {
		if (transaction.recipientAddr.equals(this._wallet.address)
			|| (transaction.senderPubKey).equals(this._wallet.publicKey)) {
			return this.getAmount(true).then(val => {
				this.fire('unconfirmed-amount-changed', val);
			});
		}
	}


	async _onBalanceChanged(account) {
		let newBalance = account.balance;
		let currentBalance = await this.$.accounts.getBalance(this._wallet.address);
		if (currentBalance.value === newBalance.value) {
			// balance is already updated
			this.fire('confirmed-amount-changed', currentBalance.value);
		} else {
			// TODO. Temporary Workaround for Core Bug #189 - The accounts tree is not yet updated
			// when the event is fired. We can however use the fact that the head-changed event is
			// fired after all updates have finished.
			// We use a promise here to avoid that we fire our event again when the head changes
			// again. (Note that there is no way to remove an even listener in Nimiq.Observable)
			let headChanged = new Promise((resolve, reject) => {
				this.$.blockchain.on('head-changed', resolve);
			});
			headChanged.then(async function() {
				currentBalance = await this.$.accounts.getBalance(this._wallet.address);
				this.fire('confirmed-amount-changed', currentBalance.value);
			}.bind(this));
		}
	}

	wasEmptied() {
		return this.$.accounts.getBalance(this._wallet.address).then(res => {
			// considered emptied if value is 0 and account has been used
			// alternative would be res.value < this._value
			return res.nonce > 0 && res.value === 0;
		});
	}
}
