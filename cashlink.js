class Cashlink extends Observable {
	/** Typically you'll not use the constructor directly, but the static createCashlink methods */
	constructor(myWallet, transferWallet, senderAddress, accounts, mempool) {
		super();
		this._myWallet = myWallet;
		this._transferWallet = transferWallet;
		this._senderAddress = senderAddress;
		this._mempool = mempool;
		mempool.on('transaction-added', this._onTransactionAdded.bind(this));
		accounts.on(transferWallet.address, this._onBalanceChanged.bind(this));
	}


	static async createCashlink(amount, myWallet, accounts, mempool) {
		if (!NumberUtils.isUint64(amount) || amount===0) {
			// all amounts and fees are always integers to ensure floating point precision.
			throw Error("Only can send integer amounts > 0");
		}
		let senderAddress = myWallet.address;
		let transferWallet = await Wallet.createVolatile(accounts, mempool);
		let cashlink = new Cashlink(myWallet, transferWallet, senderAddress, accounts, mempool);
		await cashlink.setAmount(amount);
		// TODO fire the change events
		return cashlink;
	}


	static async cashlinkFromUrl(url, myWallet, accounts, mempool) {
		let urlParts = url.split('#');
		if (urlParts.length != 4) {
			throw Error("Not a valid cashlink.");
		}
		let senderAddress = BufferUtils.fromBase64(urlParts[1]);
		let privateKey = BufferUtils.fromBase64(urlParts[2]);
		let publicKey = BufferUtils.fromBase64(urlParts[3]);
		// TODO check that private and public key belong together
		let keys = await Promise.all([Crypto.importPrivate(privateKey), Crypto.importPublic(publicKey)]);
		keys = {
			privateKey: keys[0],
			publicKey: keys[1]
		};
		let transferWallet = await new Wallet(keys, accounts, mempool);
		return new Cashlink(myWallet, transferWallet, senderAddress, accounts, mempool);
	}


	wasCreatedByMe() {
		return this._myWallet.address.equals(this._senderAddress);
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
		this.fire('confirmed-amount-changed', this._determineAmountWithoutFees(balance));
	}


	/** Set the amount to be sent by the cashlink. Can also be changed afterwards, by adding more money or transfering
	money back. Note that by EVERY call of this method a transaction is performed and a fee applies. */
	async setAmount(newAmount) {
		if (!this.wasCreatedByMe()) {
			throw Error("Only the initial creator of the cashlink is supposed to change the amount.");
		}
		if (!NumberUtils.isUint64(newAmount)) {
			// all amounts and fees are always integers to ensure floating point precision.
			throw Error("Only non-negative integer amounts allowed.");
		}

		// we have to provide the fee that will apply when sending from transferWallet to recipient.
		// Note that in the case that the creator sets the newAmount to 0 to take back his money, there
		// is no transaction to the recipient anymore and feeToRecipient is correctly 0.
		let feeToRecipient = Cashlink.calculateFee(newAmount);
		let newAmountIncludingFees = newAmount + feeToRecipient;
		// the new amount with fees minus the current amount with fees. In the current amount we also consider
		// the unconfirmed transactions to really update upon the most recent value
		let difference = newAmountIncludingFees - await this._getTransferWalletBalance(true);
		if (difference === 0) {
			// nothing to do
			return;
		} else if (difference > 0) {
			// we (the original creator of the cashlink) have to add more money to the transfer wallet.
			let fee = Cashlink.calculateFee(difference);
			if ((await this._myWallet.getBalance()).value < difference+fee) {
				throw Error("You can't send more money then you own");
			}
			await this._myWallet.transferFunds(this._transferWallet.address, difference, fee);
			return;
		} else { // difference < 0
			// return money back from the transferWallet to us (the original creator of the cashlink).
			difference = Math.abs(difference);
			// A fee has to be payed for the transaction from the transferWallet. As we can't take the fee from
			// the money the recipient should get, we take it from the money that should be returned to us.
			let fee = Cashlink.calculateFee(difference, true);
			if (difference <= await this._getTransferWalletBalance(false)) {
				await this._transferWallet.transferFunds(this._myWallet.address, difference-fee, fee);
				return;
			} else {
				// the transfer wallet didn't get the unconfirmed money yet to transfer it back.
				// Wait for the confirmation
				return new Promise(function(resolve, reject) {
					// the nimiq observable unfortunately doesn't have a once or off method so we have a flag
					let executed = false;
					this.on('confirmed-amount-changed', async function() {
						if (executed) {
							return;
						}
						executed = true;
						try {
							if (difference <= await this._getTransferWalletBalance(false)) {
								await this._transferWallet.transferFunds(this._myWallet.address, difference-fee, fee);
								resolve();
							}
						} catch(e) {
							reject();
						}
					});
					setTimeout(function() {
						if (executed) {
							return;
						}
						executed = true;
						reject();
					}, 1000 * 60 * 5); // timeout after 5 minutes
				});
			}
		}
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
		// the url contains the private and public key of the transferWallet and the sender address which will
		// be encoded by Base64. Base 64 contains A-Z,a-z,0-9,+,/,= so we can use # as a separator.
		let senderAddressBase64 = BufferUtils.toBase64(this._senderAddress);
		let privateKeyBase64 =
			await this._transferWallet.exportPrivate().then(privateKey => BufferUtils.toBase64(privateKey));
		let publicKeyBase64 = BufferUtils.toBase64(this._transferWallet.publicKey);
		return baseUrl + senderAddressBase64 + '#' + privateKeyBase64 + '#' + publicKeyBase64;
	}
}
Class.register(Cashlink);