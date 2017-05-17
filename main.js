var FeedParser = require('feedparser');
var request = require("request");
var jsonfile = require("jsonfile");
var emitter = require('events').EventEmitter;
var schedule = require('node-schedule');
var path = require("path");
var jsonfile = require("jsonfile");
var email 	= require("emailjs");

var saveFilePath = path.join( __dirname , "savedSubRedditSearchResults.json" );
var savedResults = {};
jsonfile.writeFileSync( saveFilePath , savedResults );

try {
	savedResults = jsonfile.readFileSync( saveFilePath );
}
catch (err) {
	savedResults = {};
	jsonfile.writeFileSync( saveFilePath , savedResults );
}


var server 	= email.server.connect({
   user:    "", 
   password:"", 
   host:    "", 
   ssl:     true
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

		// schedule via node-schedule
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


		wSM.enumerateSubRedditDEEP( wCINX , wSM.trackedSubs[wCINX].urls.new );

	},

	enumerateSubRedditDEEP: function( wIndex , wSortMode ) {

		wEmitter = new emitter;

		console.log( "started enumerating sub comments" );
		wSM.trackedSubs[wIndex].wModel = [];

		wSM.trackedSubs[wIndex].startTime = new Date().getTime();

		var wCLen = 0; // global needed

		var wSubChildrenLength = 0;
		wSM.fetchXML( wSortMode , "topOfSubComplete" );
		wEmitter.on( "topOfSubComplete" , function( wResults ) {
			wSubChildrenLength = wResults.length - 1;
			console.log( "Total Children == " + wSubChildrenLength.toString() );
			for ( var i = 0; i < wSubChildrenLength; ++i ) {
				//console.log( wResults[i].link + ".rss" );
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
				//console.log( wSM.trackedSubs[wIndex].wModel );
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
				wEmitter.emit( "searchComplete" , wIndex );
			}

		}
		wEmitter.on( "commentComplete" , function( wResults ) {
			getEachComment();
			scanComment( wResults );
		});

		function scanComment( wResults ) {

			var wSTResult;
			for ( var i = 0; i < wResults.length; ++i ) {

				for ( var j = 0; j < wSM.trackedSubs[wIndex].searchWords.length; ++j ) {

					wSTResult = wResults[i]["atom:content"]["#"].toLowerCase().indexOf( wSM.trackedSubs[wIndex].searchWords[j] );
					if ( wSTResult != -1 ) {
						var wtemp = wResults[i].link.split("/");
						if ( wtemp.length === 10 ) {
							//console.log( wResults[i].link );
							wSM.trackedSubs[wIndex].foundLinks.push( wResults[i].link )
						}
					}

				}
			}
		}

		wEmitter.on( "searchComplete" , function( wIndex ) {
			wSM.trackedSubs[wIndex].foundLinks = Array.from( new Set( wSM.trackedSubs[wIndex].foundLinks ) );
			//console.log( wSM.trackedSubs[wIndex].foundLinks );
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
			else {  /* console.log( savedResults[ wCName ] ); */ }

			function searchSavedResults() {
				console.log("searching saved results");
				for ( var i = 0; i < wSM.trackedSubs[wIndex].foundLinks.length; ++i ) {
				
					console.log( wSM.trackedSubs[wIndex].foundLinks[i] );

					// Skip Already "Saved / Alerted" Results
					var wTest = savedResults[ wCName ].indexOf( wSM.trackedSubs[wIndex].foundLinks[i] );
					//console.log(wTest);
					if ( wTest != -1 ) { console.log( "coninuing" ); continue; }

					//console.log( "need to do something with +" );
					//console.log( wSM.trackedSubs[wIndex].foundLinks[i] );
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
				//console.log( "we have stuff to alert !!!!" );
				//console.log( wNeedToEmailResults );
				var wSB = "";
				for ( var i = 0; i < wNeedToEmailResults.length; ++i ) {
					wSB = wSB + "[" + i.toString() + "]\t \n " + wNeedToEmailResults[i] + "\n\n\n";
				}
				//console.log(wSB);
				server.send({
				   text:    wSB, 
				   from:    "subreddit.notifier@gmail.com", 
				   to:      "cerbus.collin@gmail.com",
				   subject: "autism word used in /r/science"
				} , function( err , message ) { console.log( err || message ); } );

			}

			//wSM.enumerateSubRedditDEEP(0);

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
			//console.log(error);
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
//wFM.monitor("https://www.reddit.com/r/science/comments/4dvyxy/science_ama_series_im_tristram_smith_phd_of_the/.rss");
