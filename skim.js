// load in mcouch
// change up the appropriate logic
// - set a {skip:true} on any tgz attachment for any version, if missing
// - remove any attachments that are not for published versions
// - remove the attachments and PUT back to this.skim
//   - if this.skim === this.db, then bump the rev
//   - otherwise, treat it like a replication, and ?new_edits=false

var MantaCouch = require('mcouch')
var util = require('util')
var hh = require('http-https')
var parse = require('parse-json-response')
var url = require('url')
var path = require('path')
var readmeTrim = require('npm-registry-readme-trim')

module.exports = Skim

util.inherits(Skim, MantaCouch)

function Skim(opts) {
  if (!(this instanceof Skim))
    return new Skim(opts)

  if (opts.fat && !opts.db)
    opts.db = opts.fat

  MantaCouch.call(this, opts)

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
}

Skim.prototype.put = function(change) {
  if (change.id.match(/^_design\//) && this.db !== this.skim) {
    this.putDesign(change)
  } else {
    return MantaCouch.prototype.put.apply(this, arguments)
  }
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

Skim.prototype.onRm = function(change, er) {
  // If there's an error, or invalid change, just let mcouch handle it
  // If the db isn't the same as the skim, then presumably it's already
  // gone, and if the user was just deleting a conflict or something, we
  // don't want to completely delete the entire thing.
  if (er || !change.id || this.db === this.skim)
    return MantaCouch.prototype.onRm.call(this, change, er)

  // Delete from the other before moving on.
  // To remove all conflicts, keep deleting until 404
  var h = url.parse(this.skim + '/' + change.id)
  h.method = 'HEAD'
  hh.request(h, function(res) {
    // if already gone, then great
    if (res.statusCode === 404)
      return MantaCouch.prototype.onRm.call(this, change, er)

    var rev = res.headers.etag.replace(/^"|"$/g, '')
    var d = url.parse(this.skim + '/' + change.id + '?rev=' + rev)
    d.method = 'DELETE'
    hh.request(d, parse(function(er, data, res) {
      // If we got an error (incl 404) let mcouch handle it
      // otherwise, delete again, until all conflict revs are gone.
      if (er)
        MantaCouch.prototype.onRm.call(this, change, er)
      else
        this.onRm(change, er)
    }.bind(this))).end()
  }.bind(this)).end()
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

Skim.prototype.onCuttleComplete = function(change, results) {
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
    return MantaCouch.prototype.onCuttleComplete.call(this, change, results)
  }

  // It's easier if we always have an _attachments, even if empty
  doc._attachments = {}

  this.putBack(change, results)
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
      MantaCouch.prototype.onCuttleComplete.call(this, change, results)
  }.bind(this))).end(body)
}
