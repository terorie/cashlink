class CashLink {
    constructor($, wallet, value = undefined, message = undefined) {
        this.$ = $;
        this._isNano = $.consensus instanceof NanoConsensus;

        this._wallet = wallet;
        this._currentBalance = 0;
        this.getAmount().then(balance => this._currentBalance = balance);

        if (value) this.value = value;
        if (message) this.message = message;

        this._immutable = !!(value || message);
        this._eventListeners = {};

        this.$.mempool.on('transaction-added', this._onTransactionAdded.bind(this));
        this._onPotentialBalanceChange = this._onPotentialBalanceChange.bind(this);
        this.$.blockchain.on('head-changed', this._onPotentialBalanceChange);
        this.$.consensus.on('established', this._onPotentialBalanceChange);
    }

    static async create($) {
        const wallet = await Nimiq.Wallet.createVolatile()
        return new CashLink($, wallet);
    }

    static async parse($, str) {
        try {
            const buf = Nimiq.BufferUtils.fromBase64Url(str);
            const key = Nimiq.PrivateKey.unserialize(buf);
            const value = buf.readUint64();
            const message = decodeURIComponent(buf.readVarLengthString());

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
        return decodeURIComponent(this._message || '');
    }

    set message(message) {
        if (this._immutable) throw 'CashLink is immutable';
        message = encodeURIComponent(message);
        if (!Nimiq.NumberUtils.isUint8(message.length)) throw 'Message is to long';
        this._message = message;
    }

    async fund(fee = 0) {
        if (!Nimiq.NumberUtils.isUint64(fee)) {
            throw 'Malformed fee';
        }

        if (this._value === 0) {
            throw 'Cannot fund CashLink with zero value';
        }

        const balance = await this._getBalance(this.$.wallet.address); // the senders balance
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
        const balance = await this._getBalance();
        if (balance.value === 0) {
            throw 'There is no confirmed balance in this link';
        }

        const transaction = await this._wallet.createTransaction(this.$.wallet.address, balance.value - fee, fee, balance.nonce);
        if (!await this.$.mempool.pushTransaction(transaction)) {
            throw 'Failed to push transaction into mempool';
        }
    }


    async _getBalance(address = this._wallet.address) {
        let balance;
        if (this._isNano) {
            balance = (await this.$.consensus.getAccount(address)).balance;
        } else {
            balance = await this.$.accounts.getBalance(address);
        }
        if (address.equals(this._wallet.address)) {
            this._currentBalance = balance.value;
        }
        return balance
    }


    async getAmount(includeUnconfirmed) {
        let balance = (await this._getBalance()).value;
        if (includeUnconfirmed) {
            const transferWalletAddress = this._wallet.address;
            await this.$.mempool._evictTransactions(); // ensure that already validated transactions are ignored
            const transactions = this.$.mempool._transactions.values();
            for (const transaction of transactions) {
                const senderPubKey = transaction.senderPubKey;
                const recipientAddr = transaction.recipientAddr;
                if (recipientAddr.equals(transferWalletAddress)) {
                    // money sent to the transfer wallet
                    balance += transaction.value;
                } else if (senderPubKey.equals(this._wallet.publicKey)) {
                    balance -= transaction.value + transaction.fee;
                }
            }
        }
        return balance;
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


    async _onTransactionAdded(transaction) {
        if (transaction.recipientAddr.equals(this._wallet.address)
            || (transaction.senderPubKey).equals(this._wallet.publicKey)) {
            const amount = await this.getAmount(true);
            this.fire('unconfirmed-amount-changed', amount);
        }
    }


    async _onPotentialBalanceChange() {
        if (!this.$.consensus.established) {
            // only mind final balance
            return;
        }
        const oldBalance = this._currentBalance;
        const balance = await this.getAmount();

        if (balance !== oldBalance) {
            this.fire('confirmed-amount-changed', balance);
        }
    }


    async wasEmptied() {
        const balance = await this._getBalance();
        // considered emptied if value is 0 and account has been used
        return balance.nonce > 0 && balance.value === 0;
    }
}
