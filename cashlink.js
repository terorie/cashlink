class Cashlink {
	constructor(myWallet, transferWallet, senderAddress) {
		this._myWallet = myWallet;
		this._transferWallet = transferWallet;
		this._senderAddress = senderAddress;
	}


	static async createCashlink(amount, myWallet, accounts, mempool) {
		if (!NumberUtils.isUint64(amount) || amount===0) {
			// all amounts and fees are always integers to ensure floating point precision.
			throw Error("Only can send integer amounts > 0");
		}
		let senderAddress = myWallet.address;
		let transferWallet = await Wallet.createVolatile(accounts, mempool);
		let cashlink = new Cashlink(myWallet, transferWallet, senderAddress);
		await cashlink.setAmount(amount);
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
		return new Cashlink(myWallet, transferWallet, senderAddress);
	}


	wasCreatedByMe() {
		return this._myWallet.address.equals(this._senderAddress);
	}


	static calculateFee(amount, feeAlreadyIncluded) {
		// Also more complicated fees are supprted, e.g. the percentage of the fees could be based on the amount
		if (!NumberUtils.isUint64(amount) || amount===0) {
			// all amounts and fees are always integers to ensure floating point precision.
			throw Error("Only can send integer amounts > 0");
		}
		const MIN_FEE = 1;
		const MAX_FEE = 2e4; // 2 nimiqs
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
				// So check the close integer values:
				let offset=0;
				while (offset<30) {
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


	async getAmount(includeFees) {
		let amount = await this._transferWallet.getBalance();
		if (includeFees) {
			return amount;
		} else {
			let fee = calculateFee(amount, true);
			return Math.max(0, amount - fee);
		}
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
		if (newAmount === 0) {
			// special case: creator wants to take out all of the money. In this case, the feeToRecipient doesn't
			// matter anymore. Note that we need to handle this special case, as the feeToRecipient does not
			// neccessarily need to be 0 if newAmount is 0 (there can be a minimum fee).
			return this.receiveMoney();
		}

		// we have to provide the fee that will apply when sending from transferWallet to recipient:
		let feeToRecipient = Cashlink.calculateFee(newAmount);
		let newAmountIncludingFees = newAmount + feeToRecipient;
		let difference = newAmountIncludingFees - await this.getAmount(true);
		if (difference === 0) {
			// nothing to do
			return Promise.resolve();
		} else if (difference > 0) {
			// we (the original creator of the cashlink) have to add more money to the transfer wallet.
			return this._myWallet.transferFunds(this._transferWallet.address, difference,
				Cashlink.calculateFee(difference));
		} else { // difference < 0
			// return money back from the transferWallet to us (the original creator of the cashlink).
			difference = Math.abs(difference);
			// A fee has to be payed for the transaction from the transferWallet. As we can't take the fee from
			// the money the recipient should get, we take it from the money that should be returned to us.
			let fee = Cashlink.calculateFee(difference, true);
			return this._transferWallet.transferFunds(this._myWallet.address, difference-fee, fee);
		}
	}


	async receiveMoney() {
		let amountWithFee = await this.getAmount(true);
		let fee = Cashlink.calculateFee(amountWithFee, true);
		let amountWithoutFee = Math.max(0, amountWithFee - fee);
		if (amountWithoutFee === 0) {
			throw Error("The cashlink does not contain money anymore");
		}
		return this._transferWallet.transferFunds(this._myWallet.address, difference-fee, fee);
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
