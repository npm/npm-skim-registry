var
    assert     = require('assert'),
    async      = require('async'),
    events     = require('events'),
    follow     = require('follow'),
    fs         = require('fs'),
    multifs    = require('multi-fs'),
    parse      = require('parse-json-response'),
    path       = require('path'),
    readmeTrim = require('npm-registry-readme-trim'),
    Request    = require('request'),
    stream     = require('stream'),
    url        = require('url'),
    util       = require('util')
	;

var MultiSkimmer = module.exports = function MultiSkimmer(opts)
{
	if (!(this instanceof MultiSkimmer))
		return new MultiSkimmer(opts);

	assert(opts && (typeof opts === 'object'), 'you must pass an options object');
	assert(opts.source && url.parse(opts.source).protocol, 'you must pass a couch url in the `source` option');
	assert(opts.sequenceFile && (typeof opts.sequenceFile === 'string'), 'you must pass a path in the `sequenceFile` option');
	assert(opts.client && opts.client.constructor.name === 'MultiFS', 'you must pass a multi-fs client in the `client` option');
	if (opts.inactivity_ms)
		assert(typeof opts.inactivity_ms === 'number', 'the `inactivity_ms` option must be a number');
	if (opts.skimdb)
		assert(url.parse(opts.skimdb).protocol, 'you must pass a couch url in the `skimdb` option');
	if (opts.registry)
		assert(url.parse(opts.registry).protocol, 'you must pass a valid url in the `registry` option');

	events.EventEmitter.call(this);

    this.opts          = opts;
    this.sequenceFile  = path.resolve(opts.sequenceFile);
    this.inactivity_ms = opts.inactivity_ms;
    this.delete        = !!opts.delete;

    opts.source   = opts.source.replace(/\/+$/, '');
    var parsed    = url.parse(opts.source);
    this.protocol = (parsed === 'https:') ? require('https') : require('http');
    this.source   = parsed.href;

	if (!opts.skimdb)
		this.skimdb = this.source;
	else
		this.skimdb = url.parse(opts.skimdb).href.replace(/\/+$/, '');

	if (opts.registry)
		this.registry  = url.parse(opts.registry).href.replace(/\/+$/, '');

	this.on('put', this.onPut.bind(this));
};
util.inherits(MultiSkimmer, events.EventEmitter);

MultiSkimmer.prototype.opts         = null;  // store the options for logging
MultiSkimmer.prototype.source       = null;  // couchdb we're watching for changes
MultiSkimmer.prototype.skimdb       = null;  // couchdb where the skimmed documents are put
MultiSkimmer.prototype.registry     = null;  // the registry we're publishing to
MultiSkimmer.prototype.delete       = false; // if couch deletions should turn into data deletions
MultiSkimmer.prototype.sequenceFile = null;  // path to the file where we're storing sequence ids
MultiSkimmer.prototype.following    = false; // true if we're in motion & following a db
MultiSkimmer.prototype.saving       = false; // true if we're mid-save on our sequence file

MultiSkimmer.prototype.start = function start()
{
	if (this.following)
		throw new Error('start() called twice');

	fs.readFile(this.sequenceFile, 'ascii', this.onSequenceFileRead.bind(this));
};

MultiSkimmer.prototype.stop =
MultiSkimmer.prototype.close =
MultiSkimmer.prototype.destroy = function stop()
{
	if (this.client) this.client.close();
	if (this.follow) this.follow.stop();
};

MultiSkimmer.prototype.onSequenceFileRead = function onSequenceFileRead(err, data)
{
	if (err && err.code === 'ENOENT')
		data = 0;
	else if (err)
		return this.emit('error', err);

	if (data === undefined)
		data = 0;

	data = +data;

	if (typeof data !== 'number')
		return this.emit('error', new Error('invalid data in sequence file'));

	this.sequence = data;
	this.emit('log', 'following with sequence number ' + data);

	this.follow = follow(
	{
        db:            this.source,
        since:         this.sequence,
        inactivity_ms: this.inactivity_ms
	}, this.onChange.bind(this));

	this.following = true;
	this.emit('log', 'started');
};

MultiSkimmer.prototype.saveSequence = function saveSequence()
{
	if (this.saving) return;

	this.saving = true;
	var tmp = this.sequenceFile + '.TMP';
	var data = this.sequence + '\n';
	fs.writeFile(tmp, data, 'ascii', function(err)
	{
		if (err) return this.afterSave(err);
		fs.rename(tmp, this.sequenceFile, this.afterSave.bind(this));
	}.bind(this));
};

MultiSkimmer.prototype.afterSave = function afterSave(err)
{
	if (err) this.emit('error', err);
	this.saving = false;
};

MultiSkimmer.prototype.pause = function pause()
{
	this.emit('log', 'pausing');
	this.follow.pause();
};

MultiSkimmer.prototype.resume = function resume()
{
	this.emit('log', 'resuming');
	this.saveSequence();
	this.follow.resume();
};

MultiSkimmer.prototype.onChange = function onChange(err, change)
{
	if (err) return this.emit('error', err);
	this.sequence = change.seq;
	if (!change.id) return;

	if (change.deleted)
		this.handleDeletion(change);
	else
		this.handlePut(change);
};


// ----- deletion

MultiSkimmer.prototype.handleDeletion = function handleDeletion(change)
{
	this.emit('rm', change);
	this.pause();
	this.client.rmr('./' + change.id, this.cleanUpDeletions.bind(this, change));
};

MultiSkimmer.prototype.cleanUpDeletions = function cleanUpDeletions(change, err)
{
	// If the db isn't the same as the skim, then presumably it's already
	// gone, and if the user was just deleting a conflict or something, we
	// don't want to completely delete the entire thing.
	if (err || !change.id || this.source === this.skimdb)
		return this.deletionComplete(change, err);

	// Delete from the other db before moving on. Remove all conflicts by
	// deleting until 404.
	var headcheck =
	{
		uri: this.skimdb + '/' + change.id,
		method: 'HEAD',
	};
	Request(headcheck, function(err, res, body)
	{
		if (res.statusCode === 404)
			return this.deletionComplete(change);

		var rev = res.headers.etag.replace(/^"|"$/g, '');
		var delopts =
		{
			uri: headcheck.uri + '?rev=' + rev,
			method: 'DELETE',
		};
		Request(delopts, function(err, res, body)
		{
			// emit the error and move on
			if (err) return this.deletionComplete(change, err);
			// else recurse
			this.cleanUpDeletions(change);
		}.bind(this));
	}.bind(this));
};

MultiSkimmer.prototype.deletionComplete = function deletionComplete(change, err)
{
	if (err) return this.emit('error', err);

	this.emit('delete', change);
	this.resume();
};

// ----- puts & other changes

MultiSkimmer.prototype.handlePut = function handlePut(change)
{
	if (change.id.match(/^_design\//) && this.source !== this.skimdb)
		return this.putDesign(change);

	if (change.id !== encodeURIComponent(change.id))
	{
		console.error('WARNING: Skipping %j\nWARNING: See %s',
				change.id,
				'https://github.com/joyent/node-manta/issues/157');
		return;
	}

	this.emit('log', 'handling put: ' + change.id);
	this.pause();
	var url = this.source + '/' + this.changeid + '?att_encoding_info=true&revs=true';
	Request.get(url, { json: true }, function(err, res, body)
	{
		if (err) return this.emit('error', err);
		// If we see a 404, move on. The deletion will appear later in the changes feed.
		if (res.statusCode === 404) return this.resume();

		if (!body._attachments) body._attachments = {};
		change.doc = body;
		change.rev = body._rev;

		this.multiball(change);

	}.bind(this));
};

MultiSkimmer.prototype.multiball = function MULTIBALL(change)
{
	// We have a document with all its attachments. Our job now is
	// to copy all those attachments to their final homes using the
	// multi-fs client, but ONLY if they don't already exist.
	this.emit('log', 'MULTIBALL! ' + change.id);
	this.emit('put', change);

	var doc = change.doc;
	var files = Object.keys(doc._attachments || {})
	.reduce(function(s, k)
	{
		var attach = doc._attachments[k];
		// Isaac says all gzip-encoded attachments are Cretans.
		if (attach.encoding === 'gzip')
		{
			delete attach.digest;
			delete attach.length;
		}
		s['_attachments/' + k] = doc._attachments[k];
		return s;
	}, {});

	var json = new Buffer(JSON.stringify(doc) + '\n', 'utf8');
	files['doc.json'] =
	{
        type:   'application/json',
        name:   'doc.json',
        length: json.length,
	};

	var count = Object.keys(files).length;
	if (count === 1 && files['doc.json'])
	{
		this.multiballComplete(change);
		return;
	}

	var iterator = function(fname, cb) { this.skimFile(doc, fname, cb); }.bind(this);
	async.each(files, iterator, function(err, results)
	{
		this.multiballComplete(change);
	}.bind(this));
};


MultiSkimmer.prototype.skimFile = function skimFile(doc, filename, callback)
{
	this.emit('log', 'skimming ' + filename + ' from ' + doc.name);
	// TODO
	// - check to see if it exists in dest; if so, check md5
	// - if not present, copy
	// - emit 'send' for each one sent

	var fpath = path.join(doc.name, filename);
	this.client.stat(fpath, function(err, type, stat)
	{
		// ENOENT means we don't have a file there! push it up
		//

	}.bind(this));



	throw new Error('skimFile() unimplemented');
};


MultiSkimmer.prototype.fetchAttachment = function fetchAttachment(change, json, file, callback)
{
	if (file.match(/\/doc\.json$/))
	{
		var stream = new stream.PassThrough();
		stream.end(json);
		callback(null, stream);
	}
	else
	{
		this.emit('attachment', change, file);
		var opts =
		{
			uri: this.source +
				'/' +
				path.dirname(file.name).replace(/^_attachments/, change.id) +
				'/' +
				encodeURIComponent(path.basename(file)),
			method: 'GET',
			json: true
		};
		Request(opts, function(err, res, body)
		{
			callback(err, body);
		});
	}
};


MultiSkimmer.prototype.putDesign = function putDesign(change)
{
	this.emit('log', 'putting design doc ' + change.id);
	this.pause();
	var docuri = this.source + '/' + change.id + '?revs=true';
	Request.get(docuri, { json: true }, function(err, res, data)
	{
		if (err) return this.emit('error', err);
		// If we get a 404, assume it's been deleted and continue on.
		if (res.statusCode === 404) return this.resume();

		change.doc = data;
		this.putBack(change);
	}.bind(this));
};

MultiSkimmer.prototype.onPut = function onPut(change)
{
	this.emit('log', 'entering onPut');

	// this function seems to clean up the change document and then do nothing with the result.
	// ???????

	// TODO
	throw new Error('onPut() unimplemented');
};

MultiSkimmer.prototype.multiballComplete = function multiballComplete(change)
{
	// TODO
	throw new Error('multiballComplete() unimplemented');
};

MultiSkimmer.prototype.putBack = function(change, results)
{
	this.emit('log', 'entering putBack');

	var doc = change.doc;
	var putUrl = this.skimdb + '/' + encodeURIComponent(doc._id);

	// If this isn't a putBACK, then treat it like a replication job
	// If someone wrote something else, go ahead and be in conflict.
	// If we're putting back to the same db, then there's no need to
	// specify the _revisions, since we're letting Couch manage the
	// revision chain as a new edit on top of the existing one.
	if (this.source !== this.skimdb)
		putUrl += '?new_edits=false';
	else
		delete doc._revisions;

	// Slimmer, less fatty document goes into skimdb now.
	var opts =
	{
        uri:    putUrl,
        method: 'PUT',
        json:   doc,
	};
	Request(opts, function(err, res, body)
	{
		if (err) return this.emit('error', err);
		// We might get a 409 here if skimdb & source are the same, but
		// this will get handled naturally later.
		this.completeAndResume(change, results);
	}.bind(this));
};

MultiSkimmer.prototype.completeAndResume = function completeAndResume(change, results)
{
	this.emit('log', 'completing put & resuming');
	this.emit('complete', change, results);
	this.resume();
};
