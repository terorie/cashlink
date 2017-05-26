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
			}
			test().then(done, done.fail);
		});
	});

	
	describe('amount sending', function() {
		it('should be able to detect invalid amounts', function(done) {
			let invalidAmounts = [0, -8, 8.8];
			let promises = invalidAmounts.map(function(amount) {
				return Cashlink.createCashlink(amount, senderWallet, accounts, mempool)
					.then(function() {
						return Promise.reject(amount+' is an illegal amount and should throw an exception');
					}, function(e) {
						if (e.message === 'Only can send integer amounts > 0') {
							return Promise.resolve();
						} else {
							throw e; // another unexpected exception
						}
					});
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

	
	describe('amount sending', function() {
		it('can send the receiver the correct amount', function(done) {
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
});