function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

class CashLink {
    constructor($, wallet, value = undefined, message = undefined) {
        this.$ = $;
        this._isNano = $.consensus instanceof Nimiq.NanoConsensus;

        this._wallet = wallet;
        this._accountRequests = new Map(); // for request caching
        if ($.consensus.established) {
            this.getAmount().then(balance => this._currentBalance = balance);
        } else {
            // value will we updated as soon as we have consensus (in _onPotentialBalanceChange)
            // and a confirmed-amount-changed event gets fired
            this._currentBalance = 0;
        }

        if (value) this.value = value;
        if (message) this.message = message;

        this._immutable = !!(value || message);
        this._eventListeners = {};

        this.$.mempool.on('transaction-added', this._onTransactionAddedOrExpired.bind(this));
        this.$.mempool.on('transaction-expired', this._onTransactionAddedOrExpired.bind(this));
        this.$.blockchain.on('head-changed', this._onHeadChanged.bind(this));
        this.$.consensus.on('established', this._onPotentialBalanceChange.bind(this));

        if (this._isNano) {
            this.$.consensus.subscribeAccounts([wallet.address]); // Todo keep track of subscribed accounts
        }
    }

    static create($) {
        return _asyncToGenerator(function* () {
            const wallet = yield Nimiq.Wallet.generate();
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

                const keyPair = Nimiq.KeyPair.derive(key);
                const wallet = new Nimiq.Wallet(keyPair);

                return new CashLink($, wallet, value, message);
            } catch (e) {
                return undefined;
            }
        })();
    }

    render() {
        const buf = new Nimiq.SerialBuffer(
        /*key*/this._wallet.keyPair.privateKey.serializedSize +
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
        if (!Nimiq.NumberUtils.isUint8(message.length)) throw 'Message is too long';
        this._message = message;
    }

    _awaitConsensus() {
        var _this = this;

        return _asyncToGenerator(function* () {
            if (!_this.$.consensus.established) {
                yield new Promise(function (resolve, reject) {
                    _this.$.consensus.on('established', resolve);
                    setTimeout(function () {
                        return reject('Current network consensus unknown.');
                    }, 60000);
                });
            }
        })();
    }

    _sendTransaction(transaction) {
        var _this2 = this;

        return _asyncToGenerator(function* () {
            yield _this2._awaitConsensus();
            if (_this2._isNano) {
                try {
                    yield _this2.$.consensus.relayTransaction(transaction);
                } catch (e) {
                    console.error(e);
                    throw 'Failed to forward transaction to the network';
                }
            } else {
                if ((yield _this2.$.mempool.pushTransaction(transaction)) < 0) {
                    throw 'Failed to push transaction into mempool';
                }
            }
        })();
    }

    _executeUntilSuccess(fn, args = []) {
        var _this3 = this;

        return _asyncToGenerator(function* () {
            try {
                return yield fn.apply(_this3, args);
            } catch (e) {
                console.error(e);
                return new Promise(function (resolve) {
                    setTimeout(function () {
                        _this3._executeUntilSuccess(fn, args).then(function (result) {
                            return resolve(result);
                        });
                    }, 5000);
                });
            }
        })();
    }

    fund(fee = 0) {
        var _this4 = this;

        return _asyncToGenerator(function* () {
            // don't apply _executeUntilSuccess to avoid accidental double funding. Rather throw the exception.
            if (!Nimiq.NumberUtils.isUint64(fee)) {
                throw 'Malformed fee';
            }

            if (!_this4._value) {
                throw 'Unknown value';
            }

            const account = yield _this4._getAccount(_this4.$.wallet.address); // the senders account
            if (account.balance < _this4._value) {
                throw 'Insufficient funds';
            }

            // The recipient pays the fee, thus send value - fee.
            const transaction = yield _this4.$.wallet.createTransaction(_this4._wallet.address, _this4._value - fee, fee, (yield _this4._getBlockchainHeight())); // TODO send via keyguard
            yield _this4._sendTransaction(transaction);

            _this4._value = _this4._value - fee;
        })();
    }

    claim(fee = 0) {
        var _this5 = this;

        return _asyncToGenerator(function* () {
            // get out the funds. Only the confirmed amount, because we can't request unconfirmed funds.
            const account = yield _this5._getAccount();
            if (account.balance === 0) {
                throw 'There is no confirmed balance in this link';
            }
            const transaction = yield _this5._wallet.createTransaction(_this5.$.wallet.address, account.balance - fee, fee, (yield _this5._getBlockchainHeight())); // TODO add possibility to specify wallet address
            yield _this5._executeUntilSuccess(_asyncToGenerator(function* () {
                yield _this5._sendTransaction(transaction);
            }));
        })();
    }

    _getBlockchainHeight() {
        var _this6 = this;

        return _asyncToGenerator(function* () {
            yield _this6._awaitConsensus();
            return _this6.$.blockchain.height;
        })();
    }

    _getAccount(address = this._wallet.address) {
        var _this7 = this;

        return _asyncToGenerator(function* () {
            let request = _this7._accountRequests.get(address);
            if (!request) {
                const headHash = _this7.$.blockchain.headHash;
                request = _this7._executeUntilSuccess(_asyncToGenerator(function* () {
                    yield _this7._awaitConsensus();
                    let account;
                    if (_this7._isNano) {
                        account = yield _this7.$.consensus.getAccount(address);
                    } else {
                        account = yield _this7.$.accounts.get(address);
                    }
                    account = account || Nimiq.BasicAccount.INITIAL;
                    if (!_this7.$.blockchain.headHash.equals(headHash) && _this7._accountRequests.get(address)) {
                        // the head changed and there was a new account request for the new head, so we return
                        // that newer request
                        return _this7._accountRequests.get(address);
                    } else {
                        // the head didn't change (so everything alright) or we don't have a newer request and
                        // just return the result we got for the older head
                        if (address.equals(_this7._wallet.address)) {
                            _this7._currentBalance = account.balance;
                        }
                        return account;
                    }
                }));
                _this7._accountRequests.set(address, request);
            }
            return request; // a promise
        })();
    }

    getAmount(includeUnconfirmed) {
        var _this8 = this;

        return _asyncToGenerator(function* () {
            let balance = (yield _this8._getAccount()).balance;
            if (includeUnconfirmed) {
                const transferWalletAddress = _this8._wallet.address;
                for (const transaction of _this8.$.mempool.getTransactions()) {
                    const sender = transaction.sender;
                    const recipient = transaction.recipient;
                    if (recipient.equals(transferWalletAddress)) {
                        // money sent to the transfer wallet
                        balance += transaction.value;
                    } else if (sender.equals(transferWalletAddress)) {
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

    _onTransactionAddedOrExpired(transaction) {
        var _this9 = this;

        return _asyncToGenerator(function* () {
            if (transaction.recipient.equals(_this9._wallet.address) || transaction.sender.equals(_this9._wallet.address)) {
                const amount = yield _this9.getAmount(true);
                _this9.fire('unconfirmed-amount-changed', amount);
            }
        })();
    }

    _onHeadChanged(head, branching) {
        var _this10 = this;

        return _asyncToGenerator(function* () {
            // balances potentially changed
            _this10._accountRequests.clear();
            if (!branching) {
                // only interested in final balance
                yield _this10._onPotentialBalanceChange();
            }
        })();
    }

    _onPotentialBalanceChange() {
        var _this11 = this;

        return _asyncToGenerator(function* () {
            if (!_this11.$.consensus.established) {
                // only interested in final balance
                return;
            }
            const oldBalance = _this11._currentBalance;
            const balance = yield _this11.getAmount();

            if (balance !== oldBalance) {
                _this11.fire('confirmed-amount-changed', balance);
            }
        })();
    }

    wasEmptied() {
        var _this12 = this;

        return _asyncToGenerator(function* () {
            return _this12._executeUntilSuccess(_asyncToGenerator(function* () {
                yield _this12._awaitConsensus();
                const [transactionReceipts, balance] = yield Promise.all([_this12.$.consensus._requestTransactionReceipts(_this12._wallet.address), _this12.getAmount()]);
                // considered emptied if value is 0 and account has been used
                return balance === 0 && transactionReceipts.length > 0;
            }));
        })();
    }
}
