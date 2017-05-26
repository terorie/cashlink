class Cashlink extends Observable {
	/** Typically you'll not use the constructor directly, but the static createCashlink methods */
	constructor(myWallet, transferWallet, accounts, mempool) {
		super();
		this._myWallet = myWallet;
		this._transferWallet = transferWallet;
		this._mempool = mempool;
		mempool.on('transaction-added', this._onTransactionAdded.bind(this));
		accounts.on(transferWallet.address, this._onBalanceChanged.bind(this));
	}


	static async createCashlink(amount, myWallet, accounts, mempool) {
		let transferWallet = await Wallet.createVolatile(accounts, mempool);
		let cashlink = new Cashlink(myWallet, transferWallet, accounts, mempool);
		await cashlink.setAmount(amount);
		// TODO fire the change events
		return cashlink;
	}


	static async cashlinkFromUrl(url, myWallet, accounts, mempool) {
		let urlParts = url.split('#');
		if (urlParts.length != 3 || urlParts[0].indexOf('nimiq.com/receive')===-1) {
			throw Error("Not a valid cashlink.");
		}
		let privateKey = BufferUtils.fromBase64(urlParts[1]);
		let publicKey = BufferUtils.fromBase64(urlParts[2]);
		// TODO check that private and public key belong together
		let keys = await Promise.all([Crypto.importPrivate(privateKey), Crypto.importPublic(publicKey)]);
		keys = {
			privateKey: keys[0],
			publicKey: keys[1]
		};
		let transferWallet = await new Wallet(keys, accounts, mempool);
		return new Cashlink(myWallet, transferWallet, accounts, mempool);
	}


	static calculateFee(amount, feeAlreadyIncluded) {
		// Also more complicated fees are supprted, e.g. the percentage of the fees could be based on the amount
		if (!NumberUtils.isUint64(amount)) {
			// all amounts and fees are always integers to ensure floating point precision.
			throw Error("Amounts (and fees) are always non-negative integer. Got "+amount);
		}
		if (amount === 0) {
			// actually a transaction over 0 coins is illegal, but it still makes sense to show a fee of 0
			return 0;
		}
		const MIN_FEE = 1;
		const MAX_FEE = Policy.coinsToSatoshis(2);
		const FEE_PERCENTAGE = 0.001;
		if (!feeAlreadyIncluded) {
			return Math.max(MIN_FEE, Math.min(MAX_FEE, Math.floor(amount * FEE_PERCENTAGE)));
		} else {
			let maxFeeReached = (amount - MAX_FEE) * FEE_PERCENTAGE >= MAX_FEE;
			let minFeeNotReached = (amount - MIN_FEE) * FEE_PERCENTAGE <= MIN_FEE;
			if (maxFeeReached) {
				return MAX_FEE;
			} else if (minFeeNotReached) {
				return MIN_FEE;
			} else {
				// without rounding we have:
				// amount = amountWithoutFeeNotRounded + amountWithoutFeeNotRounded * FEE_PERCENTAGE
				// with rounding it is something like:
				// amount = ceil(x) + floor(x * FEE_PERCENTAGE) which can't be directly solved for x.
				let closeAmountWithoutFee = Math.round(amount / (1+FEE_PERCENTAGE));
				// the amountWithoutFeeClose either already is the correct integer amount or should be close.
				// So check the close integer values. Actually testing with an offset in {-1,0,1} should be
				// enough but as we anyways return immediately when we found the correct solution, we just
				// make the interval [-1000,1000]
				let offset=0;
				while (offset<1000) {
					let testAmountWithoutFee = closeAmountWithoutFee+offset;
					if (testAmountWithoutFee + Cashlink.calculateFee(testAmountWithoutFee) === amount) {
						return amount - testAmountWithoutFee;
					}
					offset *= -1;
					if (offset>=0) {
						offset += 1;
					}
				}
				// It shouldn't happen that we don't find the correct value. But in this case return the close value.
				return amount - closeAmountWithoutFee;
			}
		}
	}


	_determineAmountWithoutFees(amountWithFees) {
		let fee = Cashlink.calculateFee(amountWithFees, true);
		return Math.max(0, amountWithFees - fee);
	}


	async _getTransferWalletBalance(includeUnconfirmedTransactions) {
		let balance = (await this._transferWallet.getBalance()).value || 0;
		if (includeUnconfirmedTransactions) {
			let transferWalletAddress = this._transferWallet.address;
			await this._mempool._evictTransactions(); // ensure that already validated transactions are ignored
			let transactions = Object.values(this._mempool._transactions);
			// the senderAddr() returns a promise. So execute all the promises in parallel with Promise.all
			let senderAddresses = await Promise.all(transactions.map(transaction => transaction.senderAddr()));
			for (let i=0; i<transactions.length; ++i) {
				let transaction = transactions[i];
				let senderAddr = senderAddresses[i];
				let recipientAddr = transaction.recipientAddr; // this can be retrieved directly without promise
				if (recipientAddr.equals(transferWalletAddress)) {
					// money sent to the transfer wallet
					balance += transaction.value;
				} else if (senderAddr.equals(transferWalletAddress)) {
					balance -= transaction.value + transaction.fee;
				}
			}
		}
		return balance;
	}


	async getAmount(unconfirmed) {
		let amountWithFee = await this._getTransferWalletBalance(unconfirmed);
		return this._determineAmountWithoutFees(amountWithFee);
	}


	async _onTransactionAdded(transaction) {
		if (transaction.recipientAddr.equals(this._transferWallet.address)
			|| (await transaction.senderAddr()).equals(this._transferWallet.address)) {
			this.fire('unconfirmed-amount-changed', await this.getAmount(true));
		}
	}


	async _onBalanceChanged(balance) {
		balance = balance.value || 0;
		this.fire('confirmed-amount-changed', this._determineAmountWithoutFees(balance));
	}


	/** Set the amount to be sent by the cashlink. */
	async setAmount(amount) {
		if (await this._getTransferWalletBalance(true) !== 0) {
			throw Error("Amount can't be updated after it has been set.");
		}
		if (!NumberUtils.isUint64(amount) || amount===0) {
			// all amounts and fees are always integers to ensure floating point precision.
			throw Error("Only non-negative integer amounts allowed.");
		}
		// we have to provide the fee that will apply when sending from transferWallet to recipient.
		let feeToRecipient = Cashlink.calculateFee(amount);
		let transferWalletBalance = amount + feeToRecipient;
		let feeToTransferWallet = Cashlink.calculateFee(transferWalletBalance);
		if ((await this._myWallet.getBalance()).value < transferWalletBalance+feeToTransferWallet) {
			throw Error("You can't send more money then you own");
		}
		await this._myWallet.transferFunds(this._transferWallet.address, transferWalletBalance, feeToTransferWallet);
	}


	async receiveConfirmedMoney() {
		// get out the money. Only the confirmed amount, because we can't request unconfirmed money.
		let amountWithFee = await this._getTransferWalletBalance(false);
		let amountWithoutFee = this._determineAmountWithoutFees(amountWithFee);
		if (amountWithoutFee === 0) {
			throw Error("The cashlink does not contain confirmed money");
		}
		let fee = amountWithFee - amountWithoutFee;
		return this._transferWallet.transferFunds(this._myWallet.address, amountWithoutFee, fee);
	}


	async getUrl() {
		const baseUrl = 'https://nimiq.com/receive#';
		// the url contains the private and public key of the transferWallet which will
		// be encoded by Base64. Base 64 contains A-Z,a-z,0-9,+,/,= so we can use # as a separator.
		let privateKeyBase64 = BufferUtils.toBase64(await this._transferWallet.exportPrivate());
		let publicKeyBase64 = BufferUtils.toBase64(this._transferWallet.publicKey);
		return baseUrl + privateKeyBase64 + '#' + publicKeyBase64;
	}
}
Class.register(Cashlink);