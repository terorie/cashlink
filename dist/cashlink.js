function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

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

    static create($) {
        return _asyncToGenerator(function* () {
            const wallet = yield Nimiq.Wallet.createVolatile();
            return new CashLink($, wallet);
        })();
    }

    static parse($, str) {
        return _asyncToGenerator(function* () {
            try {
                const buf = Nimiq.BufferUtils.fromBase64Url(str);
                const key = Nimiq.PrivateKey.unserialize(buf);
                const value = buf.readUint64();
                const message = decodeURIComponent(buf.readVarLengthString());

                const keyPair = yield Nimiq.KeyPair.derive(key);
                const wallet = yield new Nimiq.Wallet(keyPair);

                return new CashLink($, wallet, value, message);
            } catch (e) {
                return undefined;
            }
        })();
    }

    render() {
        const buf = new Nimiq.SerialBuffer(
        /*key*/96 +
        /*value*/8 +
        /*message length*/1 + (
        /*message*/this._message ? this._message.length : 0));

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

    fund(fee = 0) {
        var _this = this;

        return _asyncToGenerator(function* () {
            if (!Nimiq.NumberUtils.isUint64(fee)) {
                throw 'Malformed fee';
            }

            if (_this._value === 0) {
                throw 'Cannot fund CashLink with zero value';
            }

            const balance = yield _this._getBalance(_this.$.wallet.address); // the senders balance
            if (balance.value < _this._value) {
                throw 'Insufficient funds';
            }

            // The recipient pays the fee, thus send value - fee.
            const transaction = yield _this.$.wallet.createTransaction(_this._wallet.address, _this._value - fee, fee, balance.nonce);
            if (!(yield _this.$.mempool.pushTransaction(transaction))) {
                throw 'Failed to push transaction into mempool';
            }

            _this._value = _this._value - fee;
        })();
    }

    claim(fee = 0) {
        var _this2 = this;

        return _asyncToGenerator(function* () {
            // get out the money. Only the confirmed amount, because we can't request unconfirmed money.
            const balance = yield _this2._getBalance();
            if (balance.value === 0) {
                throw 'There is no confirmed balance in this link';
            }

            const transaction = yield _this2._wallet.createTransaction(_this2.$.wallet.address, balance.value - fee, fee, balance.nonce);
            if (!(yield _this2.$.mempool.pushTransaction(transaction))) {
                throw 'Failed to push transaction into mempool';
            }
        })();
    }

    _getBalance(address = this._wallet.address) {
        var _this3 = this;

        return _asyncToGenerator(function* () {
            let balance;
            if (_this3._isNano) {
                balance = (yield _this3.$.consensus.getAccount(address)).balance;
            } else {
                balance = yield _this3.$.accounts.getBalance(address);
            }
            if (address.equals(_this3._wallet.address)) {
                _this3._currentBalance = balance.value;
            }
            return balance;
        })();
    }

    getAmount(includeUnconfirmed) {
        var _this4 = this;

        return _asyncToGenerator(function* () {
            let balance = (yield _this4._getBalance()).value;
            if (includeUnconfirmed) {
                const transferWalletAddress = _this4._wallet.address;
                yield _this4.$.mempool._evictTransactions(); // ensure that already validated transactions are ignored
                const transactions = _this4.$.mempool._transactions.values();
                for (const transaction of transactions) {
                    const senderPubKey = transaction.senderPubKey;
                    const recipientAddr = transaction.recipientAddr;
                    if (recipientAddr.equals(transferWalletAddress)) {
                        // money sent to the transfer wallet
                        balance += transaction.value;
                    } else if (senderPubKey.equals(_this4._wallet.publicKey)) {
                        balance -= transaction.value + transaction.fee;
                    }
                }
            }
            return balance;
        })();
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
        this._eventListeners[type].forEach(function (callback) {
            callback(arg);
        });
    }

    _onTransactionAdded(transaction) {
        var _this5 = this;

        return _asyncToGenerator(function* () {
            if (transaction.recipientAddr.equals(_this5._wallet.address) || transaction.senderPubKey.equals(_this5._wallet.publicKey)) {
                const amount = yield _this5.getAmount(true);
                _this5.fire('unconfirmed-amount-changed', amount);
            }
        })();
    }

    _onPotentialBalanceChange() {
        var _this6 = this;

        return _asyncToGenerator(function* () {
            if (!_this6.$.consensus.established) {
                // only mind final balance
                return;
            }
            const oldBalance = _this6._currentBalance;
            const balance = yield _this6.getAmount();

            if (balance !== oldBalance) {
                _this6.fire('confirmed-amount-changed', balance);
            }
        })();
    }

    wasEmptied() {
        var _this7 = this;

        return _asyncToGenerator(function* () {
            const balance = yield _this7._getBalance();
            // considered emptied if value is 0 and account has been used
            return balance.nonce > 0 && balance.value === 0;
        })();
    }
}
