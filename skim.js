// load in mcouch
// change up the appropriate logic
// - set a {skip:true} on any tgz attachment for any version, if missing
// - remove any attachments that are not for published versions
// - remove the attachments and PUT back to this.skim
//   - if this.skim === this.db, then bump the rev
//   - otherwise, treat it like a replication, and ?new_edits=false

var assert      = require('assert');
var crypto      = require('crypto');
var EE          = require('events').EventEmitter;
var follow      = require('follow');
var fs          = require('fs');
var hh          = require('http-https');
var multifs     = require('multi-fs');
var parse       = require('parse-json-response');
var PassThrough = require('stream').PassThrough;
var path        = require('path');
var readmeTrim  = require('npm-registry-readme-trim');
var url         = require('url');
var util        = require('util');

module.exports = Skim

function Skim(opts) {
    if (!(this instanceof Skim))
        return new Skim(opts)

    EE.call(this);

    if (!opts || typeof opts !== 'object')
        throw new TypeError('opts object required');

    if (opts.fat && !opts.db)
        opts.db = opts.fat

    this.opts = opts;

    if (!opts.client || opts.client.constructor.name !== 'MultiFS')
        throw new TypeError('opts.client of type MultiFS is required');
    this.client = opts.client;

    if (opts.seqFile && typeof opts.seqFile !== 'string')
        throw new TypeError('opts.seqFile must be of type string');
    this.seqFile = opts.seqFile || null;
    if (this.seqFile)
        this.seqFile = path.resolve(this.seqFile);

    if (!opts.path || typeof opts.path !== 'string')
        throw new TypeError('opts.path is required');
    this.path = opts.path
        .replace(/\/+$/, '')
        .replace(/^~~/, '/' + this.client.user);

    if (!opts.db || !url.parse(opts.db).protocol)
        throw new TypeError('opts.db url is required');
    this.db = opts.db.replace(/\/+$/, '');

    this.http = url.parse(this.db).protocol === 'https:' ?
        require('https') : require('http');

    if (opts.inactivity_ms && typeof opts.inactivity_ms !== 'number')
        throw new TypeError('opts.inactivity_ms must be of type number');
    this.inactivity_ms = opts.inactivity_ms;

    if (opts.seq && typeof opts.seq !== 'number')
        throw new TypeError('opts.seq must be of type number');
    this.seq = opts.seq || 0;

    if (opts.concurrency && typeof opts.concurrency !== 'number')
        throw new TypeError('opts.concurrency must be of type number');
    this.concurrency = opts.concurrency;

    this.delete = !!opts.delete;

    this.following = false;
    this.savingSeq = false;

    this.skim = url.parse(opts.skim || opts.db).href
    this.skim = this.skim.replace(/\/+$/, '')
    this.db = url.parse(this.db).href.replace(/\/+$/, '')
    this.fat = this.db

    this.registry = null
    if (opts.registry) {
        this.registry = url.parse(opts.registry).href
        this.registry = this.registry.replace(/\/+$/, '')
    }

    this.on('put', this.onput)

    this.start();
}
util.inherits(Skim, EE);

Skim.prototype.start = function() {
    if (this.following)
        throw new Error('Cannot read sequence after follow starts');
    if (!this.seqFile) {
        this.seq = 0;
        this.onReadSeq();
    } else
        fs.readFile(this.seqFile, 'ascii', this.onReadSeq.bind(this));
}

Skim.prototype.onReadSeq = function(er, data) {
    if (er && er.code === 'ENOENT')
        data = 0;
    else if (er)
        return this.emit('error', er);

    if (data === undefined)
        data = null
    if (!+data && +data !== 0)
        return this.emit('error', new Error('invalid data in seqFile'));

    data = +data;
    this.seq = +data;
    this.follow = follow({
        db: this.db,
        since: this.seq,
        inactivity_ms: this.inactivity_ms
    }, this.onChange.bind(this));
    this.following = true;
}

Skim.prototype.saveSeq = function(file) {
    file = file || this.seqFile;
    if (!file && !this.seqFile)
        return
    if (!file)
        throw new Error('invalid sequence file: ' + file);
    if (this.savingSeq)
        return

    this.savingSeq = true;
    var t = file + '.TMP'
    var data = this.seq + '\n'
    fs.writeFile(t, data, 'ascii', function(er) {
        if (er)
            return this.afterSave(er)
        fs.rename(t, file, this.afterSave.bind(this))
    }.bind(this))
}

Skim.prototype.afterSave = function(er) {
    if (er)
        this.emit('error', er);
    this.savingSeq = false;
}

Skim.prototype.onChange = function(er, change) {
    if (er)
        return this.emit('error', er);

    this.seq = change.seq;

    // Please don't delete the entire store in Manta, kthx
    if (!change.id)
        return;

    if (change.deleted)
        this.rm(change);
    else
        this.put(change);
}

Skim.prototype.put = function(change) {
    if (change.id.match(/^_design\//) && this.db !== this.skim) {
        return this.putDesign(change)
    }

    if (change.id !== encodeURIComponent(change.id)) {
        console.error('WARNING: Skipping %j\nWARNING: See %s', change.id,
                                 'https://github.com/joyent/node-manta/issues/157')
        return;
    }

    this.pause();
    var query = 'att_encoding_info=true&revs=true';
    var u = url.parse(this.db + '/' + change.id + '?' + query);
    this.http.get(u, parse(function(er, doc, res) {
        if (er)
            return this.emit('error', er);
        change.doc = doc;
        this._put(change);
    }.bind(this)))
}

Skim.prototype._put = function(change) {
    this.emit('put', change);
    var doc = change.doc;

    var files = Object.keys(doc._attachments || {}).reduce(function (s, k) {
        var att = doc._attachments[k];
        // Gzip-encoded attachments are lying liars playing lyres
        if (att.encoding === 'gzip') {
            delete att.digest;
            delete att.length;
        }
        s['_attachments/' + k] = doc._attachments[k];
        return s;
    }, {});

    var json = new Buffer(JSON.stringify(doc) + '\n', 'utf8');
    files['doc.json'] = {
        type: 'application/json',
        name: 'doc.json',
        length: json.length
    };

    var self = this;
    var count = Object.keys(files).length;

    Object.keys(files).forEach(function(fname) {
            fname = path.join(doc.name, fname);
            self.getFile(change, json, fname, function(err, data) {
            var destpath = path.join(self.path, fname);

            self.client.writeFilep(destpath, data, function(err)
            {
                if (err)
                    self.emit('error', err);
                else
                    self.emit('send', change, destpath);

                if (--count === 0)
                    self.onPutFilesComplete(change);
            });
        });
    });

    /*
    .on('send', this.emit.bind(this, 'send', change))
    .on('delete', this.emit.bind(this, 'delete', change))
    .on('error', this.emit.bind(this, 'error'))
    .on('complete', cb);
    */
}

Skim.prototype.putDesign = function(change) {
    this.pause()
    var q = '?revs=true'
    var opt = url.parse(this.db + '/' + change.id + q)
    var req = hh.get(opt, parse(function(er, data, res) {
        // If we get a 404, just assume it's been deleted
        if (er && er.statusCode === 404)
            return this.resume()
        else if (er)
            return this.emit('error', er)
        change.doc = data
        this.putBack(change, null)
    }.bind(this)))
}

Skim.prototype.rm = function(change) {
    if (this.delete) {
        this.emit('rm', change);
        this.pause();
        this.client.rmr(this.path + '/' + change.id, this.onRm.bind(this, change));
    }
}

Skim.prototype.onRm = function(change, er) {
    // If there's an error, or invalid change, just let mcouch handle it
    // If the db isn't the same as the skim, then presumably it's already
    // gone, and if the user was just deleting a conflict or something, we
    // don't want to completely delete the entire thing.
    if (er || !change.id || this.db === this.skim)
        return this._onRm(change, er)

    // Delete from the other before moving on.
    // To remove all conflicts, keep deleting until 404
    var h = url.parse(this.skim + '/' + change.id)
    h.method = 'HEAD'
    hh.request(h, function(res) {
        // if already gone, then great
        if (res.statusCode === 404)
            return this._onRm(change, er)

        var rev = res.headers.etag.replace(/^"|"$/g, '')
        var d = url.parse(this.skim + '/' + change.id + '?rev=' + rev)
        d.method = 'DELETE'
        hh.request(d, parse(function(er, data, res) {
            // If we got an error (incl 404) let mcouch handle it
            // otherwise, delete again, until all conflict revs are gone.
            if (er) {
                this._onRm(change, er)
            }
            else
                this.onRm(change, er)
        }.bind(this))).end()
    }.bind(this)).end()
}

Skim.prototype._onRm = function(change, er) {
    if (!er || er.statusCode === 404)
        this.resume();
    else
        this.emit('error', er);
}


Skim.prototype.onput = function(change) {
    var doc = change.doc
    // remove any attachments that don't belong, and
    // put any previously-vacuumed tgz's with a {skip:true}
    var att = doc._attachments || {}
    var versions = Object.keys(doc.versions || {})

    // keep any that are the tarball for a version
    var keep = versions.reduce(function(set, v) {
        var p = url.parse(doc.versions[v].dist.tarball).pathname
        var f = path.basename(p)
        set[f] = true
        return set
    }, {})

    // Delete any attachments that are not keepers
    Object.keys(att).forEach(function(f) {
        if (!keep[f])
            delete att[f]
    })

    // Don't delete any keepers that were already put into manta
    Object.keys(keep).forEach(function(f) {
        if (!att[f])
            att[f] = { skip: true }
    })

    doc._attachments = att

    // If we have a registry config, make sure that all dist.tarball
    // urls are pointing at the registry url, and not some weird place.
    if (this.registry) {
        versions.forEach(function(v) {
            var version = doc.versions[v]
            var r = url.parse(version.dist.tarball)
            var p = '/' + doc.name + '/-/' + path.basename(r.pathname)
            r = url.parse(this.registry + p)
            version.dist.tarball = r.href
        }, this)
    }

    // Also, remove per-version readmes, and just have a single max-2mb
    // readme at the top-level.
    readmeTrim(doc)
}

Skim.prototype.onPutFilesComplete = function(change, results) {
    var doc = change.doc
    var att = doc._attachments || {}
    var k = Object.keys(att).filter(function (a) {
        // don't do putbacks for {skip:true} attachments
        return !att[a].skip
    })

    var extraReadmes = Object.keys(doc.versions || {}).filter(function(v) {
        return doc.versions[v].readme
    })

    if (!k.length && !extraReadmes.length && this.skim === this.db) {
        // no disallowed attachments, just leave as-is
        return this.completeAndResume(change, results)
    }

    // It's easier if we always have an _attachments, even if empty
    doc._attachments = {}

    this.putBack(change, results)
}

Skim.prototype.completeAndResume = function completeAndResume(change, results) {
    this.emit('complete', change, results);
    this.resume();
};

Skim.prototype.stop =
Skim.prototype.close =
Skim.prototype.destroy = function() {
    if (this.client)
        this.client.close();
    if (this.follow)
        this.follow.stop();
}

Skim.prototype.putBack = function(change, results) {
    var doc = change.doc
    var p = this.skim + '/' + encodeURIComponent(doc._id)

    // If this isn't a putBACK, then treat it like a replication job
    // If someone wrote something else, go ahead and be in conflict.
    // If we're putting back to the same db, then there's no need to
    // specify the _revisions, since we're letting Couch manage the
    // revision chain as a new edit on top of the existing one.
    if (this.db !== this.skim)
        p += '?new_edits=false'
    else
        delete doc._revisions

    p = url.parse(p)

    var body = new Buffer(JSON.stringify(doc), 'utf8')
    p.method = 'PUT'
    p.headers = {
        'content-length': body.length,
        'content-type': 'application/json',
        connection: 'close'
    }

    // put the attachment-free document back to the database url
    hh.request(p, parse(function(er, data, res) {
        // If the db and skim are the same, then a 409 is not a problem,
        // because whatever that other change was, it'll just get skimmed
        // again, and then eventually go in nicely.
        // If they AREN'T the same, then this is super weird, because we PUT
        // with ?new_edits=false, so 409 should be impossible.
        if (er && er.statusCode === 409 && this.skim === this.db)
            er = null

        if (er)
            this.emit('error', er)
        else
            this.completeAndResume(change, results)
    }.bind(this))).end(body)
}

Skim.prototype.getMd5 = function(change, json, file, cb) {
    var md5
    if (file.match(/\/doc\.json$/))
        md5 = crypto.createHash('md5').update(json).digest('base64');
    cb(null, md5);
}

Skim.prototype.getFile = function(change, json, file, cb) {
    if (file.match(/\/doc\.json$/))
        this.streamDoc(json, file, cb)
    else
        this.getAttachment(change, file, cb)
}

Skim.prototype.streamDoc = function(json, file, cb) {
    var s = new PassThrough();
    s.end(json);
    cb(null, s);
}

Skim.prototype.getAttachment = function(change, file, cb) {
    var a = path.dirname(file.name).replace(/^_attachments/, change.id);
    var f = encodeURIComponent(path.basename(file))
    a += '/' + f
    this.emit('attachment', change, file);
    var u = this.db + '/' + a;
    this.http.get(u, function(res) {
        cb(null, res);
    }).on('error', cb);
}

Skim.prototype.pause = function() {
    this.follow.pause();
};

Skim.prototype.resume = function() {
    this.saveSeq();
    this.follow.resume();
}
