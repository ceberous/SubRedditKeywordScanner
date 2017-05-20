var process = require("process");
var FeedParser = require('feedparser');
var request = require("request");
var jsonfile = require("jsonfile");
var emitter = require('events').EventEmitter;
var schedule = require('node-schedule');
var path = require("path");
var jsonfile = require("jsonfile");
var email 	= require("emailjs");

var saveFilePath = path.join( __dirname , "savedSubRedditSearchResults.json" );
var savedResults;
try { savedResults = jsonfile.readFileSync( saveFilePath ); }
catch (err) {
	savedResults = {};
	jsonfile.writeFileSync( saveFilePath , savedResults );
}

var personal = require("./personal.js").data;
var server 	= email.server.connect({
   user:     personal.user, 
   password: personal.password,
   host:     personal.host, 
   ssl:      personal.ssl
});

var wEmitter = null;
var wSM = {

	trackedSubs: [],
	activeJobs: [],

	monitor: function( wSubreddit , wSearchTermArray ) {
		wSM.createCronJob( wSubreddit ,  wSearchTermArray );
	},

	createCronJob: function( wSubreddit , wSearchTermArray ) {

		var wCINX = ( wSM.trackedSubs.length - 1 );
		wCINX = ( wCINX === -1 ) ? 0 : wCINX;
		console.log(wCINX.toString());
		wSM.trackedSubs.push({
			index: wCINX,
			name: wSubreddit,
			urls: { 
				base: "https://www.reddit.com/r/" + wSubreddit + "/.rss",
				top: "https://www.reddit.com/r/" + wSubreddit + "/top/.rss",
				new: "https://www.reddit.com/r/" + wSubreddit + "/new/.rss",
			},
			searchWords: wSearchTermArray,
			foundLinks: [],
			wModel: [],
			cronTop: "*/3* * *", // every 3 hours
			cronNew: "*/59 * * * *", // every 1 hour
		});


		var wTopJob = schedule.scheduleJob( wSM.trackedSubs[ wCINX ].cronTop , function() {
			if ( wEmitter == null ) {
				wSM.enumerateSubRedditDEEP( wCINX , wSM.trackedSubs[wCINX].urls.top );
			}
			else {
				setTimeout( function() {
					wSM.enumerateSubRedditDEEP( wCINX , wSM.trackedSubs[wCINX].urls.top );
				} , 100000 )
			}
		});

		var wNewJob = schedule.scheduleJob( wSM.trackedSubs[ wCINX ].cronNew , function() {
			wSM.enumerateSubRedditDEEP( wCINX , wSM.trackedSubs[wCINX].urls.new );
		});


		wSM.activeJobs.push( wTopJob );
		wSM.activeJobs.push( wNewJob );

		
		/*
		var wKey = process.argv[2] || "new";
		console.log(wKey);
		console.log( wSM.trackedSubs[wCINX].urls[wKey] );
		wSM.enumerateSubRedditDEEP( wCINX , wSM.trackedSubs[wCINX].urls[wKey] );
		*/

	},

	enumerateSubRedditDEEP: function( wIndex , wSortMode ) {

		wEmitter = new emitter;

		console.log( "started enumerating sub comments" );
		wSM.trackedSubs[wIndex].wModel = [];

		wSM.trackedSubs[wIndex].startTime = new Date().getTime();

		var wCLen = 0; // global needed
		var wTitles = null;

		var wSubChildrenLength = 0;
		wSM.fetchXML( wSortMode , "topOfSubComplete" );
		wEmitter.on( "topOfSubComplete" , function( wResults ) {
			wSubChildrenLength = wResults.length - 1;
			wTitles = wResults;
			console.log( "Total Children == " + wSubChildrenLength.toString() );
			for ( var i = 0; i < wSubChildrenLength; ++i ) {
				wSM.fetchXML( wResults[i].link + ".rss" , "topOfChildComplete" );
			}
		});

		var wChildCount = 1;
		wEmitter.on( "topOfChildComplete" , function( wResults ) {
			wChildCount += 1;
			if ( wResults === undefined ) { return; }
			for ( var i = 1; i < wResults.length; ++i ) {
				wSM.trackedSubs[wIndex].wModel.push( wResults[i].link );
			}
			if ( wChildCount === wSubChildrenLength ) {
				wCLen = wSM.trackedSubs[wIndex].wModel.length;
				getEachComment();
			}
		});

		var wCommentCount = 0;
		function getEachComment() {
			console.log( wCommentCount.toString() + " = " + wCLen.toString() );
			if ( wCommentCount < wCLen ) {
				wSM.fetchXML( wSM.trackedSubs[wIndex].wModel[ wCommentCount ] + ".rss" , "commentComplete" );
				wCommentCount += 1;
			}
			else {
				scanTitles( wIndex )
			}

		}
		wEmitter.on( "commentComplete" , function( wResults ) {
			getEachComment();
			scanComment( wResults );
		});

		function scanTitles( wIndex ) {
			console.log("scanning titles");
			var wSTResult;
			for ( var i = 0; i < wTitles.length; ++i ) {
				for ( var j = 0; j < wSM.trackedSubs[wIndex].searchWords.length; ++j ) {

					wSTResult = wTitles[i]["description"].toLowerCase().indexOf( wSM.trackedSubs[wIndex].searchWords[j] );
					if ( wSTResult != -1 ) {
						wSM.trackedSubs[wIndex].foundLinks.push( wTitles[i].link )
					}

				}

			}

			wEmitter.emit( "searchComplete" , wIndex );
		}

		function scanComment( wResults ) {

			var wSTResult;
			for ( var i = 0; i < wResults.length; ++i ) {

				for ( var j = 0; j < wSM.trackedSubs[wIndex].searchWords.length; ++j ) {

					wSTResult = wResults[i]["atom:content"]["#"].toLowerCase().indexOf( wSM.trackedSubs[wIndex].searchWords[j] );
					if ( wSTResult != -1 ) {
						var wtemp = wResults[i].link.split("/");
						if ( wtemp.length === 10 ) {
							wSM.trackedSubs[wIndex].foundLinks.push( wResults[i].link )
						}
					}

				}
			}
		}

		wEmitter.on( "searchComplete" , function( wIndex ) {
			wSM.trackedSubs[wIndex].foundLinks = Array.from( new Set( wSM.trackedSubs[wIndex].foundLinks ) );
			var timeNow = new Date().getTime();
			var wSeconds = ( timeNow - wSM.trackedSubs[wIndex].startTime ) / 1000;
			var wMinutes = Math.floor( wSeconds / 60 );
			var wLeftSec = wSeconds % 60;
			console.log( "Task took " + wMinutes.toString() + " min && " + wLeftSec.toString() + " seconds" );
			compareToSavedResults();
			clearEmitter();
		});

		function clearEmitter() {
			wEmitter = null;
		}

		function compareToSavedResults() {

			var needToEmail = [];

			var wCName = wSM.trackedSubs[wIndex].name;
			var wFresh = true;

			if ( savedResults[ wCName ] === undefined ) { savedResults[ wCName ] = wSM.trackedSubs[wIndex].foundLinks; needToEmail = wSM.trackedSubs[wIndex].foundLinks; wFresh = false; }

			function searchSavedResults() {
				console.log("searching saved results");
				for ( var i = 0; i < wSM.trackedSubs[wIndex].foundLinks.length; ++i ) {
				
					// Skip Already "Saved / Alerted" Results
					var wTest = savedResults[ wCName ].indexOf( wSM.trackedSubs[wIndex].foundLinks[i] );
					if ( wTest != -1 ) { continue; }

					needToEmail.push( wSM.trackedSubs[wIndex].foundLinks[i] );
					savedResults[ wCName ].push( wSM.trackedSubs[wIndex].foundLinks[i] );

				}
			}

			if ( wFresh ) { searchSavedResults(); }

			console.log( needToEmail ); 
			emailResults( needToEmail );
			jsonfile.writeFileSync( saveFilePath , savedResults );

		}

		function emailResults( wNeedToEmailResults ) {

			if ( wNeedToEmailResults.length >= 1 ) {
				var wSB = "";
				for ( var i = 0; i < wNeedToEmailResults.length; ++i ) {
					wSB = wSB + "[" + i.toString() + "]\t \n " + wNeedToEmailResults[i] + "\n\n\n";
				}
				server.send({
				   text:    wSB, 
				   from:    personal.from, 
				   to:      personal.to,
				   subject: "autism word used in /r/science"
				} , function( err , message ) { console.log( err || message ); } );

			}

		}

	},

	fetchXML: function( wURL , wEventFunction ) {

		var wResults = [];

		var wReq = request( wURL );
		var wOptions = {
			"normalize": true,
			"feedurl": wURL
		};

		var feedparser = new FeedParser( [wOptions] );
		
		wReq.on( 'error' , function (error) {
			console.log(error);
			return;
		});

		wReq.on( 'response' , function (res) {
			var stream = this; // `this` is `req`, which is a stream

			if ( res.statusCode !== 200) {
				this.emit('error', new Error('Bad status code'));
			}
			else {
				stream.pipe( feedparser );
			}
		});

		feedparser.on( 'error' , function (error) {
			console.log( error );
		});

		feedparser.on( 'readable' , function () {

			var stream = this; 
			var meta = this.meta;
			var item;

			while ( item = stream.read() ) {
				wResults.push(item);
			}

		});

		feedparser.on( "end" , function() {
			wEmitter.emit( wEventFunction , wResults );
		});

	},


};


wSM.monitor( "science" , [ "autis" ] );