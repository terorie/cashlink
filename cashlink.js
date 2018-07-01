import Config from '/libraries/secure-utils/config/config.js';

export default class Cashlink {
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

    static async create($) {
        const wallet = await Nimiq.Wallet.generate();
        return new Cashlink($, wallet);
    }

    render() {
        const buf = new Nimiq.SerialBuffer(
            /*key*/ this._wallet.keyPair.privateKey.serializedSize +
            /*value*/ 8 +
            /*message length*/ 1 +
            /*message*/ (this._message ? this._message.length : 0)
        );

        this._wallet.keyPair.privateKey.serialize(buf);
        buf.writeUint64(this._value);
        buf.writeVarLengthString(this.message);

        let result = Nimiq.BufferUtils.toBase64Url(buf);
        // replace trailing . by = because of URL parsing issues on iPhone.
        result = result.replace(/\./g, '=');
        // iPhone also has a problem to parse long words with more then 300 chars in a URL in WhatsApp
        // (and possibly others). Therefore we break the words by adding a ~
        result = result.replace(/[A-Za-z0-9_]{257,}/g, function(match) {
            return match.replace(/.{256}/g,"$&~"); // add a ~ every 256 characters in long words
        });
        return result;
    }

    static parse($, str) {
        try {
            str = str.replace(/~/g, '').replace(/=*$/, function(match) {
                let replacement = '';
                for (let i=0; i<match.length; ++i) {
                    replacement += '.';
                }
                return replacement;
            });
            const buf = Nimiq.BufferUtils.fromBase64Url(str);
            const key = Nimiq.PrivateKey.unserialize(buf);
            const value = buf.readUint64();
            const message = buf.readVarLengthString();

            const keyPair = Nimiq.KeyPair.derive(key);
            const wallet = new Nimiq.Wallet(keyPair);

            return new Cashlink($, wallet, value, message);
        } catch (e) {
            return undefined;
        }
    }

    get value() {
        return this._value;
    }

    set value(value) {
        if (this._immutable) throw 'Cashlink is immutable';
        if (!Nimiq.NumberUtils.isUint64(value) || value === 0) throw 'Malformed value';
        this._value = value;
    }

    get message() {
        return this._message || '';
    }

    set message(message) {
        if (this._immutable) throw 'Cashlink is immutable';
        if (!Nimiq.NumberUtils.isUint8(message.length)) throw 'Message is too long';
        this._message = message;
    }

    get address() {
        return this._wallet.address;
    }

    async _awaitConsensus() {
        if (!this.$.consensus.established) {
            await new Promise((resolve, reject) => {
                this.$.consensus.on('established', resolve);
                setTimeout(() => reject('Current network consensus unknown.'), 60000);
            });
        }
    }


    async _sendTransaction(transaction) {
        await this._awaitConsensus();
        if (this._isNano) {
            try {
                await this.$.consensus.relayTransaction(transaction);
            } catch(e) {
                console.error(e);
                throw 'Failed to forward transaction to the network';
            }
        } else {
            if ((await this.$.mempool.pushTransaction(transaction)) < 0) {
                throw 'Failed to push transaction into mempool';
            }
        }
    }

    async _executeUntilSuccess(fn, args = []) {
        try {
            return await fn.apply(this, args);
        } catch(e) {
            console.error(e);
            return new Promise(resolve => {
                setTimeout(() => {
                    this._executeUntilSuccess(fn, args).then(result => resolve(result));
                }, 5000);
            });
        }
    }


    async fund(accountManager, senderUserFriendlyAddress, fee = 0) {
        // don't apply _executeUntilSuccess to avoid accidental double funding. Rather throw the exception.
        if (!Nimiq.NumberUtils.isUint64(fee)) {
            throw 'Malformed fee';
        }
        if (!this._value) {
            throw 'Unknown value';
        }
        if (fee >= this._value) {
            throw 'Fee higher than value';
        }

        const [account, validityStartHeight] = await Promise.all([
            this._getAccount(Nimiq.Address.fromUserFriendlyAddress(senderUserFriendlyAddress)),
            this._getBlockchainHeight()
        ]);
        if (account.balance < this._value) {
            throw 'Insufficient funds';
        }

        const tx = {
            network: Config.network,
            validityStartHeight: validityStartHeight,
            sender: senderUserFriendlyAddress,
            recipient: this._wallet.address.toUserFriendlyAddress(),
            // The recipient pays the fee, thus send value - fee.
            value: Nimiq.Policy.satoshisToCoins(this._value - fee),
            fee: Nimiq.Policy.satoshisToCoins(fee),
        };
        const signedTx = await accountManager.sign(tx);

        const senderPubKey = Nimiq.PublicKey.unserialize(new Nimiq.SerialBuffer(signedTx.senderPubKey));
        const signature = Nimiq.Signature.unserialize(new Nimiq.SerialBuffer(signedTx.signature));
        const networkId = Nimiq.GenesisConfig.CONFIGS[Config.network].NETWORK_ID;
        const nimiqTx = new Nimiq.BasicTransaction(senderPubKey, this._wallet.address, this._value - fee, fee,
            validityStartHeight, signature, networkId);
        await this._sendTransaction(nimiqTx);
        this._value = this._value - fee;
    }


    async claim(recipientUserFriendlyAddress, fee = 0) {
        // get out the funds. Only the confirmed amount, because we can't request unconfirmed funds.
        const account = await this._getAccount();
        if (account.balance === 0) {
            throw 'There is no confirmed balance in this link';
        }
        const recipient = Nimiq.Address.fromUserFriendlyAddress(recipientUserFriendlyAddress);
        const transaction = await this._wallet.createTransaction(recipient, account.balance - fee, fee,
            await this._getBlockchainHeight());
        await this._executeUntilSuccess(async () => {
            await this._sendTransaction(transaction);
        });
    }


    async _getBlockchainHeight() {
        await this._awaitConsensus();
        return this.$.blockchain.height;
    }


    async _getAccount(address = this._wallet.address) {
        let request = this._accountRequests.get(address);
        if (!request) {
            const headHash = this.$.blockchain.headHash;
            request = this._executeUntilSuccess(async () => {
                await this._awaitConsensus();
                let account;
                if (this._isNano) {
                    account = await this.$.consensus.getAccount(address);
                } else {
                    account = await this.$.accounts.get(address);
                }
                account = account || Nimiq.BasicAccount.INITIAL;
                if (!this.$.blockchain.headHash.equals(headHash) && this._accountRequests.get(address)) {
                    // the head changed and there was a new account request for the new head, so we return
                    // that newer request
                    return this._accountRequests.get(address);
                } else {
                    // the head didn't change (so everything alright) or we don't have a newer request and
                    // just return the result we got for the older head
                    if (address.equals(this._wallet.address)) {
                        this._currentBalance = account.balance;
                    }
                    return account;
                }
            });
            this._accountRequests.set(address, request);
        }
        return request; // a promise
    }


    async getAmount(includeUnconfirmed) {
        let balance = (await this._getAccount()).balance;
        if (includeUnconfirmed) {
            const transferWalletAddress = this._wallet.address;
            for (const transaction of this.$.mempool.getTransactions()) {
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


    async _onTransactionAddedOrExpired(transaction) {
        if (transaction.recipient.equals(this._wallet.address)
            || (transaction.sender).equals(this._wallet.address)) {
            const amount = await this.getAmount(true);
            this.fire('unconfirmed-amount-changed', amount);
        }
    }


    async _onHeadChanged(head, branching) {
        // balances potentially changed
        this._accountRequests.clear();
        if (!branching) {
            // only interested in final balance
            await this._onPotentialBalanceChange();
        }
    }


    async _onPotentialBalanceChange() {
        if (!this.$.consensus.established) {
            // only interested in final balance
            return;
        }
        const oldBalance = this._currentBalance;
        const balance = await this.getAmount();

        if (balance !== oldBalance) {
            this.fire('confirmed-amount-changed', balance);
        }
    }


    async wasEmptied() {
        return this._executeUntilSuccess(async () => {
            await this._awaitConsensus();
            const [transactionReceipts, balance] = await Promise.all([
                this.$.consensus._requestTransactionReceipts(this._wallet.address),
                this.getAmount()
            ]);
            // considered emptied if value is 0 and account has been used
            return balance === 0 && transactionReceipts.length > 0;
        });
    }
}
