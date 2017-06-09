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
	let $, transferWallet;

	async function fillWallet(wallet, amount) {
		let transaction = await $.accounts._tree.transaction();
		await $.accounts._updateBalance(transaction,
			wallet.address, amount, (a, b) => a + b);
		await transaction.commit();
	}

	beforeEach(function(done) {
		async function init() {
			$ = {};
			$.accounts = await Nimiq.Accounts.createVolatile();
			$.blockchain = await Nimiq.Blockchain.createVolatile($.accounts);
			$.mempool = new Nimiq.Mempool($.blockchain, $.accounts);
			$.wallet = await Nimiq.Wallet.createVolatile();
			transferWallet = await Nimiq.Wallet.createVolatile();
		}
		init().then(done, done.fail);
	});
		



	describe('creation', function() {
		it('can be done by constructor', function() {
			let cashlink = new Cashlink($, transferWallet);
			expect(cashlink.constructor).toBe(Cashlink);
			expect(cashlink.$).toBe($);
			expect(cashlink._transferWallet).toBe(transferWallet);
		});

		it('can be done with a given amount', function(done) {
			async function test() {
				await fillWallet($.wallet, 50);
				let cashlink = await Cashlink.createCashlink($, 7, 1);
				expect(cashlink.constructor).toBe(Cashlink);
				expect(cashlink.$).toBe($);
				expect(cashlink._transferWallet).toBeDefined();
				expect(await cashlink.getAmount(true)).toBe(7-1);
			}
			test().then(done, done.fail);
		});

		it('should be able to detect invalid amounts', function(done) {
			async function test() {
				await fillWallet($.wallet, 50);
				let invalidAmounts = [0, -8, 8.8];
				for (let amount of invalidAmounts) {
					try {
						await Cashlink.createCashlink($, amount, 1);
						done.fail(amount + ' is an illegal amount and should throw an exception');
						return;
					} catch(e) {
						if (e.message === 'Only positive integer amounts allowed.') {
							continue;
						} else {
							done.fail('Unexpected exception.');
							return;
						}
					}
				}
			}
			test().then(done, done.fail);
			expectNothing();
		});

		it('should be able to detect invalid fees', function(done) {
			async function test() {
				await fillWallet($.wallet, 50);
				let invalidFees = [-8, 8.8];
				for (let fee of invalidFees) {
					try {
						await Cashlink.createCashlink($, 7, fee);
						done.fail(fee + ' is an illegal fee and should throw an exception');
						return;
					} catch(e) {
						if (e.message === 'Only non-negative integer fees allowed.') {
							continue;
						} else {
							done.fail('Unexpected exception.');
							return;
						}
					}
				}
			}
			test().then(done, done.fail);
			expectNothing();
		});

		it('can detect if you want to spend more then you have', function(done) {
			async function test() {
				await fillWallet($.wallet, 5);
				await Cashlink.createCashlink($, 7, 1);
			}
			test().then(done.fail, done);
			expectNothing();
		});

		it('can be done from an URL', function(done) {
			async function test() {
				await fillWallet(transferWallet, 50);
				let privateKeyBase64 = Nimiq.BufferUtils.toBase64(transferWallet.keyPair.privateKey.serialize());
				let url = Cashlink.BASE_URL +'#' + privateKeyBase64;
				let recipientWallet = await Nimiq.Wallet.createVolatile();
				let cashlink = await Cashlink.decodeCashlink($, url);
				expect(cashlink.constructor).toBe(Cashlink);
				expect(cashlink.$).toBe($);
				expect(cashlink._transferWallet).toBeDefined();
				expect(cashlink._transferWallet.keyPair.equals(transferWallet.keyPair)).toBeTruthy();
				expect((await $.accounts.getBalance(cashlink._transferWallet.address)).value).toBe(50);
			}
			test().then(done, done.fail);
		});

		it('can detect invalid URLs', function(done) {
			async function test() {
				let invalidUrls = [Cashlink.BASE_URL+'#not$base&64.',
					Cashlink.BASE_URL+'#',
					'www.google.com'];
				let recipientWallet = await Nimiq.Wallet.createVolatile();
				for (let i=0, url; url=invalidUrls[i]; ++i) {
					try {
						await Cashlink.decodeCashlink($, url);
						done.fail("Shouldn't accept invalid URL: " + url);
					} catch(e) {
						continue;
					}
				}
			}
			test().then(done, done.fail);
			expectNothing();
		});
	});

		
	describe('amount recieving', function() {
		it('can recieve the correct amount', function(done) {
			async function test() {
				let cashlink = new Cashlink($, transferWallet);
				// put some already confirmed money on the transferWallet
				await fillWallet(transferWallet, 50);
				expect((await $.accounts.getBalance(transferWallet.address)).value).toBe(50);
				expect(await cashlink.getAmount()).toBe(50);
				await cashlink.accept(3);
				// the money will be sent to the recipientWallet. Check its yet unconfirmed saldo
				let transactions = Object.values($.mempool._transactions);
				expect(transactions.length).toBe(1);
				var transaction = transactions[0];
				expect((await transaction.getSenderAddr()).equals(transferWallet.address)).toBeTruthy();
				expect(transaction.recipientAddr.equals($.wallet.address)).toBeTruthy();
				expect(transaction.value).toBe(50 - 3);
				expect(transaction.fee).toBe(3);
				expect(await cashlink.getAmount(true)).toBe(0);
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
				await fillWallet($.wallet, 50);
				let cashlink = new Cashlink($, transferWallet);
				let eventPromise = createEventPromise(cashlink, 'unconfirmed-amount-changed');
				let balance = await $.accounts.getBalance($.wallet.address);
				let transaction =
					await $.wallet.createTransaction(transferWallet.address, 11-1, 1, balance.nonce);
				$.mempool.pushTransaction(transaction);
				expect(await eventPromise).toBe(10);
			}
			test().then(done, done.fail);
		});

		it('are fired for a confirmed transaction', function(done) {
			async function test() {
				let cashlink = new Cashlink($, transferWallet);
				let eventPromise = createEventPromise(cashlink, 'confirmed-amount-changed');
				// put some already confirmed money on the transferWallet
				await fillWallet(transferWallet, 50);
				expect(await eventPromise).toBe(50);
			}
			test().then(done, done.fail);
		});
	});
});