describe("Cashlink", function() {

	describe("fee calculation", function() {
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
				console.log(amountsToTest[i]);
				let fee = Cashlink.calculateFee(amountsToTest[i]);
				let extractedFee = Cashlink.calculateFee(amountsToTest[i]+fee, true);
				expect(extractedFee).toBe(fee);
			}
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