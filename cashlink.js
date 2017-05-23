// TODO perform all computations with guaranteed precision

class Cashlink {
	constructor(myWallet, transferWallet, senderAddress) {
		this._myWallet = myWallet;
		this._transferWallet = transferWallet;
		this._senderAddress = senderAddress;
	}


	static async createCashlink(amount, myWallet, accounts, mempool) {
		if (amount <= 0) {
			throw Error("Can't send an amount <= 0");
		}
		var senderAddress = myWallet.address;
		var transferWallet = await Wallet.createVolatile(accounts, mempool);
		var cashlink = new Cashlink(myWallet, transferWallet, senderAddress);
		await cashlink.setAmount(amount);
		return cashlink;
	}


	static async cashlinkFromUrl(url, myWallet, accounts, mempool) {
		var urlParts = url.split('#');
		if (urlParts.length != 4) {
			throw Error("Not a valid cashlink.");
		}
		var senderAddress = BufferUtils.fromBase64(urlParts[1]);
		var privateKey = BufferUtils.fromBase64(urlParts[2]);
		var publicKey = BufferUtils.fromBase64(urlParts[3]);
		// TODO maybe check that private and public key belong together?
		var keys = await Promise.all(Crypto.importPrivate(privateKey), Crypto.importPublic(publicKey))
			.catch(_ => throw Error("Invalid key"));
		keys = {
			privateKey: keys[0],
			publicKey: keys[1]
		};
		var transferWallet = await new Wallet(keys, accounts, mempool);
		return new Cashlink(myWallet, transferWallet, senderAddress);
	}


	wasCreatedByMe() {
		return this._myWallet.address.equals(this._senderAddress);
	}


	static calculateFee(amount, feeAlreadyIncluded) {
		// Also more complicated fees are supprted, e.g. the percentage of the fees could be based on the amount or
		// the fee could always be at least a minimum value.
		const MAX_FEE = 2;
		const FEE_PERCENTAGE = 0.001;
		if (!feeAlreadyIncluded) {
			return Math.max(MAX_FEE, amount * FEE_PERCENTAGE); // TODO precision
		} else {
			// amount = amountWithoutFee + Math.max(MAX_FEE, amountWithoutFee * FEE_PERCENTAGE)
			var maxFeeReached = (amount - MAX_FEE) * FEE_PERCENTAGE >= MAX_FEE; // TODO precision
			if (maxFeeReached) {
				return MAX_FEE;
			} else {
				// amount = amountWithoutFee + amountWithoutFee * FEE_PERCENTAGE = amountWithoutFee * (1 + FEE_PERCENTAGE)
				var amountWithoutFee = amount / (1+FEE_PERCENTAGE); // TODO precision
				return amount - amountWithoutFee; // TODO precision
			}
		}
	}


	async getAmount(includeFees) {
		var amount = await this._transferWallet.getBalance();
		if (includeFees) {
			return amount;
		} else {
			var fee = calculateFee(amount, true);
			return Math.max(0, amount - fee);
		}
	}


	/** Set the amount to be sent by the cashlink. Can also be changed afterwards, by adding more money or transfering
	money back. Note that by EVERY call of this method a fee applies.
	Returns a promise. */
	async setAmount(newAmount) {
		if (!this.wasCreatedByMe()) {
			throw Error("Only the initial creator of the cashlink is supposed to change the amount.");
		}
		if (newAmount < 0) {
			throw Error("Can't set an amount less then 0");
		}
		if (newAmount == 0) {
			// special case: creator wants to take out all of the money. In this case, the feeToRecipient doesn't
			// matter anymore. Note that we need to handle this special case, as the feeToRecipient does not
			// neccessarily need to be 0 if newAmount is 0.
			return this.receiveMoney();
		}

		// we have to provide the fee that will apply when sending from transferWallet to recipient:
		var feeToRecipient = Cashlink.calculateFee(newAmount);
		var newAmountIncludingFees = newAmount + feeToRecipient; // TODO precision
		var difference = newAmountIncludingFees - await this.getAmount(true); // TODO pecision
		if (difference == 0) {
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
			var fee = Cashlink.calculateFee(difference, true);
			return this._transferWallet.transferFunds(this._myWallet.address, difference-fee, fee); // TODO precision
		}
	}


	async receiveMoney() {
		var amountWithFee = await this.getAmount(true);
		var fee = Cashlink.calculateFee(amountWithFee, true);
		var amountWithoutFee = Math.max(0, amountWithFee - fee);
		if (amountWithoutFee == 0) {
			throw Error("The cashlink does not contain money anymore");
		}
		return this._transferWallet.transferFunds(this._myWallet.address, difference-fee, fee);
	}


	async getUrl() {
		const baseUrl = 'https://nimiq.com/receive#';
		// the url contains the private and public key of the transferWallet and the sender address which will
		// be encoded by Base64. Base 64 contains A-Z,a-z,0-9,+,/,= so we can use # as a separator.
		var senderAddressBase64 = BufferUtils.toBase64(this._senderAddress);
		var privateKeyBase64 =
			await this._transferWallet.exportPrivate().then(privateKey => BufferUtils.toBase64(privateKey));
		var publicKeyBase64 = BufferUtils.toBase64(this._transferWallet.publicKey);
		return baseUrl + senderAddressBase64 + '#' + privateKeyBase64 + '#' + publicKeyBase64;
	}
}
