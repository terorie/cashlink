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

	describe("fee calculation", function() {
		it('should be able to detect invalid amounts', function() {
			let invalidAmounts = [0, -8, 8.8];
			for (var i=0; i<invalidAmounts.length; ++i) {
				expect(function() {
					Cashlink.calculateFee(invalidAmounts[i]);
				}).toThrow();
			}
		});


		it("should be able to calculate a valid fee for an amount", function() {
			for (var i=0; i<amountsToTest.length; ++i) {
				let fee = Cashlink.calculateFee(amountsToTest[i]);
				expect(fee).toBeDefined();
				expect(fee).not.toBeNaN();
				expect(fee).toBeGreaterThanOrEqual(0);
				expect(Number.isInteger(fee)).toBe(true);
			}
		});


		it("should be able to calculate a valid fee for an amount already including the fees", function() {
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



	describe('cashlink creation', function() {
		let accounts, blockchain, mempool, senderWallet;
		beforeEach(function(done) {
			(async function() {
				accounts = await Accounts.createVolatile();
				blockchain = await Blockchain.createVolatile(accounts);
				mempool = new Mempool(blockchain, accounts);
				senderWallet = await Wallet.createVolatile(accounts, mempool);
				// give the sender some money that he can put on the cashlink:
				await accounts._updateBalance(await accounts._tree.transaction(),
					senderWallet.address, 50, (a, b) => a + b);
			})().then(done, done.fail);
		});

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

		it('can be created by constructor', function(done) {
			(async function() {
				let transferWallet = await Wallet.createVolatile(accounts, mempool);
				let cashlink = new Cashlink(senderWallet, transferWallet, senderWallet.address, accounts, mempool);
				expect(cashlink.constructor).toBe(Cashlink);
			})().then(done, done.fail);
		});

		it('can be set an amount', function(done) {
			(async function() {
				let transferWallet = await Wallet.createVolatile(accounts, mempool);
				let cashlink = new Cashlink(senderWallet, transferWallet, senderWallet.address, accounts, mempool);
				await cashlink.setAmount(5);
				expect(await cashlink.getAmount(true)).toBe(5);
			})().then(done, done.fail);
		});
	});

});

/*
describe("Player", function() {
	var player;
	var song;

	beforeEach(function() {
		player = new Player();
		song = new Song();
	});

	it("should be able to play a Song", function() {
		player.play(song);
		expect(player.currentlyPlayingSong).toEqual(song);

		//demonstrates use of custom matcher
		expect(player).toBePlaying(song);
	});

	describe("when song has been paused", function() {
		beforeEach(function() {
			player.play(song);
			player.pause();
		});

		it("should indicate that the song is currently paused", function() {
			expect(player.isPlaying).toBeFalsy();

			// demonstrates use of 'not' with a custom matcher
			expect(player).not.toBePlaying(song);
		});

		it("should be possible to resume", function() {
			player.resume();
			expect(player.isPlaying).toBeTruthy();
			expect(player.currentlyPlayingSong).toEqual(song);
		});
	});

	// demonstrates use of spies to intercept and test method calls
	it("tells the current song if the user has made it a favorite", function() {
		spyOn(song, 'persistFavoriteStatus');

		player.play(song);
		player.makeFavorite();

		expect(song.persistFavoriteStatus).toHaveBeenCalledWith(true);
	});

	//demonstrates use of expected exceptions
	describe("#resume", function() {
		it("should throw an exception if song is already playing", function() {
			player.play(song);

			expect(function() {
				player.resume();
			}).toThrowError("song is already playing");
		});
	});
});
*/