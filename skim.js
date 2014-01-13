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
  this.fat = this.db

  this.on('put', this.onput)
  if (this.skim !== this.db)
    this.on('rm', this.onrm)
}

Skim.prototype.onrm = function(change) {
  var h = url.parse(this.skim + '/' + change.id)
  h.method = 'HEAD'
  hh.request(h, function(res) {
    // already gone, maybe
    if (res.statusCode === 404)
      return

    var rev = res.headers.etag
    var d = url.parse(this.skim + '/' + change.id + '?rev=' + rev)
    d.method = 'DELETE'
    hh.request(d, parse(function(er, data, res) {
      if (er && er.statusCode !== 404)
        this.emit('error', er)
    }.bind(this)))
  }.bind(this)).end()
}

Skim.prototype.onput = function(doc) {
  // remove any attachments that don't belong, and
  // put any previously-vacuumed tgz's with a {skip:true}
  var att = doc._attachments || {}
  var versions = Object.keys(doc.versions || {})

  // Delete any non-tarball things that are definitely not ok
  Object.keys(att).forEach(function(f) {
    if (f.indexOf(doc.name + '-') !== 0 || !f.match(/\.tgz$/))
      delete att[f]
  })

  // Keep any attachments that are attached to an extant version.
  versions.forEach(function (ver) {
    var f = doc.name + '-' + ver + '.tgz'
    if (!att[f])
      att[f] = { skip: true }

    var f = path.basename(url.parse(versions[ver].dist.tarball).pathname)
    if (!att[f])
      att[f] = { skip: true }
  })

  doc._attachments = att
}

Skim.prototype.onCuttleComplete = function(doc, results) {
  var k = Object.keys(doc._attachments || {})

  if (!k.length && this.skim === this.db) {
    // no disallowed attachments, just leave as-is
    return MantaCouch.prototype.onCuttleComplete.call(this, doc, results)
  }

  delete doc._attachments

  this.putBack(doc, results)
}

Skim.prototype.putBack = function(doc, results) {
  var p = this.skim + '/' + doc.name

  // If this isn't a putBACK, then treat it like a replication job
  // If someone wrote something else, go ahead and be in conflict.
  if (this.db !== this.skim)
    p += '?new_edits=false'

  p = url.parse(p)

  delete doc._json
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
    // because whatever that other change was, it'll just get skimmed again,
    // and then eventually go in nicely.
    if (er && er.statusCode === 409 && this.skim === this.db)
      er = null

    if (er)
      this.emit('error', er)
    else
      MantaCouch.prototype.onCuttleComplete.call(this, doc, results)
  }.bind(this))).end(body)
}
