'use strict';

jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;

// this method can be used in asynchronous tests that verify their result by done() / done.fail().
// If there is no expect besides that, you can include this method in the test to avoid warning by jasmine.
function expectNothing() {
    expect(true).toBeTruthy();
}

describe("Cashlink", function() {
	let amountsToTest = [];
	for (var i=1; i<10; ++i) {
		amountsToTest.push(i);
	}
	for (var i=10; i<100; i+=10) {
		amountsToTest.push(i);
	}
	for (var i=888; i<8880; i+=888) {
		amountsToTest.push(i);
	}
	for (var i=1; i<10; ++i) {
		amountsToTest.push(Math.pow(7, i));
	}
	let accounts, blockchain, mempool, senderWallet, transferWallet;
	beforeEach(function(done) {
		async function init() {
			accounts = await Accounts.createVolatile();
			blockchain = await Blockchain.createVolatile(accounts);
			mempool = new Mempool(blockchain, accounts);
			senderWallet = await Wallet.createVolatile(accounts, mempool);
			transferWallet = await Wallet.createVolatile(accounts, mempool);
			// give the sender some money that he can put on the cashlink:
			await accounts._updateBalance(await accounts._tree.transaction(),
				senderWallet.address, 50, (a, b) => a + b);
		}
		init().then(done, done.fail);
	});
		

	describe("fee calculation", function() {
		it('should be able to detect invalid amounts', function() {
			let invalidAmounts = [-8, 8.8];
			for (var i=0; i<invalidAmounts.length; ++i) {
				expect(function() {
					Cashlink.calculateFee(invalidAmounts[i]);
				}).toThrow();
			}
		});


		it("should be able to calculate a fee for an amount", function() {
			expect(Cashlink.calculateFee(0)).toBe(0);
			for (var i=0; i<amountsToTest.length; ++i) {
				let fee = Cashlink.calculateFee(amountsToTest[i]);
				expect(fee).toBeDefined();
				expect(fee).not.toBeNaN();
				expect(fee).toBeGreaterThanOrEqual(0);
				expect(Number.isInteger(fee)).toBe(true);
			}
		});


		it("should be able to calculate a valid fee for an amount already including the fees", function() {
			expect(Cashlink.calculateFee(0)).toBe(0, true);
			for (var i=0; i<amountsToTest.length; ++i) {
				let fee = Cashlink.calculateFee(amountsToTest[i], true);
				expect(fee).toBeDefined();
				expect(fee).not.toBeNaN();
				expect(fee).toBeGreaterThanOrEqual(0);
				expect(Number.isInteger(fee)).toBe(true);
			}
		});


		it("should be able to extract the exact fee from an amount already including the fees", function() {
			for (var i=0; i<amountsToTest.length; ++i) {
				let fee = Cashlink.calculateFee(amountsToTest[i]);
				let extractedFee = Cashlink.calculateFee(amountsToTest[i]+fee, true);
				expect(extractedFee).toBe(fee);
			}
		});
	});



	describe('creation', function() {
		it('can be done by constructor', function(done) {
			async function test() {
				let cashlink = new Cashlink(senderWallet, transferWallet, accounts, mempool);
				expect(cashlink.constructor).toBe(Cashlink);
				expect(cashlink._myWallet).toBe(senderWallet);
				expect(cashlink._transferWallet).toBe(transferWallet);
				expect(cashlink._mempool).toBe(mempool);
			}
			test().then(done, done.fail);
		});

		it('can be done with a given amount', function(done) {
			async function test() {
				let cashlink = await Cashlink.createCashlink(7, senderWallet, accounts, mempool);
				expect(cashlink.constructor).toBe(Cashlink);
				expect(cashlink._myWallet).toBe(senderWallet);
				expect(cashlink._transferWallet).toBeDefined();
				expect(cashlink._mempool).toBe(mempool);
				expect(await cashlink.getAmount(true)).toBe(7);
			}
			test().then(done, done.fail);
		});

		it('can be done from an URL', function(done) {
			async function test() {
				// put some confirmed money on the transfer wallet
				accounts._updateBalance(await accounts._tree.transaction(),
					transferWallet.address, 50, (a, b) => a + b);
				let privateKeyBase64 = BufferUtils.toBase64(await transferWallet.exportPrivate());
				let publicKeyBase64 = BufferUtils.toBase64(transferWallet.publicKey);
				let url = "https://nimiq.com/receive#" + privateKeyBase64 + "#" + publicKeyBase64;
				let recipientWallet = await Wallet.createVolatile(accounts, mempool);
				let cashlink = await Cashlink.cashlinkFromUrl(url, recipientWallet, accounts, mempool);
				expect(cashlink.constructor).toBe(Cashlink);
				expect(cashlink._myWallet).toBe(recipientWallet);
				expect(cashlink._transferWallet).toBeDefined();
				expect(cashlink._mempool).toBe(mempool);
				let importedPrivateKeyBase64 = BufferUtils.toBase64(await cashlink._transferWallet.exportPrivate());
				let importedPublicKeyBase64 = BufferUtils.toBase64(cashlink._transferWallet.publicKey);
				expect(importedPrivateKeyBase64).toBe(privateKeyBase64);
				expect(importedPublicKeyBase64).toBe(publicKeyBase64);
				expect((await cashlink._transferWallet.getBalance()).value).toBe(50);
			}
			test().then(done, done.fail);
		});

		it('can detect invalid URLs', function(done) {
			async function test() {
				let privateKeyBase64 = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgDY59pCeEvCf7oW7pyZ5x4OjbWSbFQ0TfqQhsveOfNoOhRANCAAS9CxXZMwUrLeWg/ftEacd9CSKnA9S4u5xNf826hLClF2e7/BPgjuE6BREV17FtBeT/8Rzp9a0etK6y4if/xt6A";
				let publicKeyBase64 = "BL0LFdkzBSst5aD9+0Rpx30JIqcD1Li7nE1/zbqEsKUXZ7v8E+CO4ToFERXXsW0F5P/xHOn1rR60rrLiJ//G3oA=";
				let invalidUrls = ['https://nimiq.com/receive#'+privateKeyBase64+'#'+publicKeyBase64+'#anotherpart',
					'https://nimiq.com/receive#',
					'www.google.com'];
				let recipientWallet = await Wallet.createVolatile(accounts, mempool);
				for (let i=0, url; url=invalidUrls[i]; ++i) {
					try {
						await Cashlink.cashlinkFromUrl(url, recipientWallet, accounts, mempool);
						done.fail("Shouldn't accept invalid URL: " + url);
					} catch(e) {
						if (e.message === "Not a valid cashlink.") {
							continue;
						} else {
							done.fail(e); // an unexpected exception
						}
					}
				}
			}
			test().then(done, done.fail);
			expectNothing();
		});
	});

	
	describe('amount sending', function() {
		it('should be able to detect invalid amounts', function(done) {
			let invalidAmounts = [0, -8, 8.8];
			let promises = invalidAmounts.map(function(amount) {
				let cashlink = new Cashlink(senderWallet, transferWallet, accounts, mempool);
				return cashlink.setAmount(amount).then(function() {
						return Promise.reject(amount+' is an illegal amount and should throw an exception');
					}, function(e) {
						if (e.message === 'Only non-negative integer amounts allowed.') {
							return Promise.resolve();
						} else {
							throw e; // another unexpected exception
						}
					}, done.fail);
			});
			Promise.all(promises).then(done, done.fail);
			expectNothing();
		});

		it('can detect if you want to spend more coins then you have', function(done) {
			async function test() {
				let cashlink = new Cashlink(senderWallet, transferWallet, accounts, mempool);
				await cashlink.setAmount(100);
			}
			test().then(done.fail, function(e) { // fail if we don't get an exception or not the one we want
				if (e.message === "You can't send more money then you own") {
					done();
				} else {
					done.fail(e);
				}
			});
			expectNothing();
		});

		it('can detect if you want to update the amount', function(done) {
			async function test() {
				let cashlink = new Cashlink(senderWallet, transferWallet, accounts, mempool);
				await cashlink.setAmount(10);
				await cashlink.setAmount(20);
			}
			test().then(done.fail, function(e) { // fail if we don't get an exception or not the one we want
				if (e.message === "Amount can't be updated after it has been set.") {
					done();
				} else {
					done.fail(e);
				}
			});
			expectNothing();
		});

		it('can set an amount', function(done) {
			async function test() {
				let cashlink = new Cashlink(senderWallet, transferWallet, accounts, mempool);
				await cashlink.setAmount(5);
				expect(await cashlink.getAmount(true)).toBe(5);
			}
			test().then(done, done.fail);
		});
	});

	
	describe('amount recieving', function() {
		it('can recieve the correct amount', function(done) {
			async function test() {
				let recipientWallet = await Wallet.createVolatile(accounts, mempool);
				let cashlink = new Cashlink(recipientWallet, transferWallet, accounts, mempool);
				// put some already confirmed money on the transferWallet
				let fee = Cashlink.calculateFee(50);
				await accounts._updateBalance(await accounts._tree.transaction(),
					transferWallet.address, 50+fee, (a, b) => a + b);
				expect((await transferWallet.getBalance()).value).toBe(50+fee);
				expect(await cashlink.getAmount()).toBe(50);
				await cashlink.receiveConfirmedMoney();
				// the money will be sent to the recipientWallet. Check its yet unconfirmed saldo
				let transactions = Object.values(mempool._transactions);
				expect(transactions.length).toBe(1);
				var transaction = transactions[0];
				expect(String(await transaction.senderAddr())).toBe(String(transferWallet.address));
				expect(String(transaction.recipientAddr)).toBe(String(recipientWallet.address));
				expect(transaction.value).toBe(50);
				expect(transaction.fee).toBe(fee);
			}
			test().then(done, done.fail);
		});
	});

	function createEventPromise(target, eventType) {
		return new Promise(function(resolve, reject) {
			target.on(eventType, arg => {
				resolve(arg);
			});
			setTimeout(reject, 30000); // timeout after 30 seconds
		});
	}

	describe('events', function() {
		it('are fired for an unconfirmed transaction', function(done) {
			async function test() {
				let cashlink = new Cashlink(senderWallet, transferWallet, accounts, mempool);
				let eventPromise = createEventPromise(cashlink, 'unconfirmed-amount-changed');
				cashlink.setAmount(10);
				expect(await eventPromise).toBe(10);
			}
			test().then(done, done.fail);
		});

		it('are fired for a confirmed transaction', function(done) {
			async function test() {
				let cashlink = new Cashlink(senderWallet, transferWallet, accounts, mempool);
				let eventPromise = createEventPromise(cashlink, 'confirmed-amount-changed');
				// put some already confirmed money on the transferWallet
				let fee = Cashlink.calculateFee(50);
				accounts._updateBalance(await accounts._tree.transaction(),
					transferWallet.address, 50+fee, (a, b) => a + b);
				expect(await eventPromise).toBe(50);
			}
			test().then(done, done.fail);
		});
	});

	it('can perform a full round trip', function(done) {
		async function test() {
			let amount = 10;
			let senderCashlink = await Cashlink.createCashlink(amount, senderWallet, accounts, mempool);
			let confirmedBalancePromise = createEventPromise(senderCashlink, 'confirmed-amount-changed');
			expect(await senderCashlink.getAmount(true)).toBe(amount);
			// lets mine the block to confirm the transaction
			let miner = new Miner(blockchain, mempool, senderWallet.address);
			spyOn(BlockUtils, 'isProofOfWork').and.returnValue(true);
			miner.startWork();
			expect(await confirmedBalancePromise).toBe(amount);
			miner.stopWork();
			expect(await senderCashlink.getAmount()).toBe(amount);
			// send the cashlink over url
			let url = await senderCashlink.getUrl();
			let recipientWallet = await Wallet.createVolatile(accounts, mempool);
			let recipientCashlink = await Cashlink.cashlinkFromUrl(url, recipientWallet, accounts, mempool);
			expect(await recipientCashlink.getAmount()).toBe(amount);
			// now lets recieve the money
			let unconfirmedBalancePromise = createEventPromise(recipientCashlink, 'unconfirmed-amount-changed');
			confirmedBalancePromise = createEventPromise(recipientCashlink, 'confirmed-amount-changed');
			let recipientBalanceChangedPromise = createEventPromise(accounts, recipientWallet.address);
			recipientCashlink.receiveConfirmedMoney();
			expect(await unconfirmedBalancePromise).toBe(0);
			// mine again to confirm the transaction
			miner.startWork();
			expect(await confirmedBalancePromise).toBe(0);
			miner.stopWork();
			expect(await senderCashlink.getAmount()).toBe(0);
			// check that the recipient got the money
			expect((await recipientBalanceChangedPromise).value).toBe(amount);
		}
		test().then(done, done.fail);
	});
});